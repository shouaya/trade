# Weekly Rolling Strategy Spec

## Purpose

This document defines a weekly rolling optimization and execution framework for an FX strategy.
It is written for implementation-oriented coding agents such as Codex / Claude Code.

Primary goals:

- Re-optimize parameters every week using recent data
- Use net performance after fees as the primary decision basis
- Avoid overfitting to a single recent winner
- Detect whether the market is still in the fast H10 regime or should fall back to H25/H30
- Support gradual scaling only after repeated stability

---

## Core Idea

Use a walk-forward style weekly process:

- Main training window: last 3 months
- Auxiliary training window: last 1 month
- Execution window: next 1 week

Decision logic:

- 3-month rolling = primary regime detector
- 1-month rolling = short-term confirmation / warning signal
- Do not switch just because one parameter set is rank #1
- Prefer stable parameter regions over single-point winners
- Only switch when improvement is meaningful after costs

---

## Baseline Parameter Interpretation

Current baseline from prior analysis:

- Primary fast regime family: `H10`
- Stable stop anchor: `ATRSL4`
- TP should not be overfit; practical zone: `ATRTP3 ~ ATRTP4`
- Slow fallback family: `H25` / `H30` with `ATRSL4`

Recommended default live baseline:

```text
H10 + ATRSL4 + ATRTP4
```

Allowed nearby variants:

```text
H10 + ATRSL3.5 + ATRTP3
H10 + ATRSL3.5 + ATRTP4
H10 + ATRSL4 + ATRTP3
```

Fallback:

```text
H25/H30 + ATRSL4
```

---

## Required Inputs

### Market / Backtest Data

- Historical candles for at least the last 3 months
- Signal inputs required by the strategy
- Trade execution assumptions
- Instrument metadata
- Trading session metadata if relevant

### Cost Model

All optimization must use **net** results, not gross results.

Required costs:

- commission / API fee
- spread
- optional slippage
- optional overnight / swap if applicable

### Account / Risk Inputs

- account capital
- current leverage setting
- lot size
- position sizing rules
- max drawdown threshold
- pause threshold
- fallback threshold

---

## Weekly Execution Cycle

Run once per week, ideally after the market closes for the strategy's operational week.

### Step 1: Build Two Training Windows

Create two training datasets:

1. `window_3m`
   - start = now - 3 months
   - end = current weekly cutoff

2. `window_1m`
   - start = now - 1 month
   - end = current weekly cutoff

### Step 2: Run Parameter Search on Both Windows

For each window, search the candidate parameter space.

Each candidate result must contain at least:

- parameter set
- net pnl
- gross pnl
- max drawdown
- trade count
- avg net pnl per trade
- profit factor after cost
- win rate
- longest losing streak
- monthly or weekly distribution if available

### Step 3: Select Top Candidates

For each window, keep top N candidates.
Recommended:

```text
top_n = 5
```

Important:

- Do not treat rank #1 as an automatic production choice
- Top candidates are used to derive **consensus**, not just a single winner

---

## Consensus Extraction

For both 3-month and 1-month windows, inspect the top candidates and extract consensus in these dimensions:

### 1. Hold Family

Examples:

- `H10`
- `H25`
- `H30`

### 2. ATR Stop Loss Band

Examples:

- `ATRSL3`
- `ATRSL3.5`
- `ATRSL4`

### 3. ATR Take Profit Band

Examples:

- `ATRTP3`
- `ATRTP4`
- `ATRTP5`

### Goal

Determine whether top candidates cluster around a stable zone.

Preferred interpretation:

- stable zone > single exact winner
- repeated family > isolated outlier
- cost-adjusted robustness > raw gross return

---

## Decision Rules

### Scenario A: Strong Agreement

Condition:

- 3-month and 1-month windows both point to the same family
- stop-loss band is similar
- TP band is similar
- net results are clearly positive after cost

Action:

- use the shared consensus for next week
- normal position size allowed

Example:

```text
3m => H10 + ATRSL4 + ATRTP3/4
1m => H10 + ATRSL3.5/4 + ATRTP3/4
```

Decision:

```text
Next week = H10 + ATRSL4 + ATRTP4
```

---

### Scenario B: Mild Conflict

Condition:

- both windows still point to the same broad family
- but differ slightly on ATRSL or ATRTP

Action:

- keep family unchanged
- allow only small parameter adjustment
- do not make a regime-level switch

Example:

```text
3m => H10 + ATRSL4 + ATRTP4
1m => H10 + ATRSL3.5 + ATRTP3
```

Decision:

- keep `H10`
- choose safer middle ground
- prefer `ATRSL4`
- choose `ATRTP3` or `ATRTP4` depending on stability

---

### Scenario C: Major Conflict

Condition:

- 3-month window suggests slow family (`H25/H30`)
- 1-month window suggests fast family (`H10`)
- or vice versa

Action:

- do not aggressively switch full regime
- prioritize 3-month result
- reduce size
- enter observation mode

Reason:

- 1-month signal may be noise
- 3-month regime read is more reliable for production

---

### Scenario D: No Clear Edge

Condition:

- top candidates are dispersed
- no clustering around one family
- net pnl is weak or negative across most candidates
- avg net pnl per trade is too small versus cost

Action:

- keep previous parameters
- or reduce size
- or pause
- do not force a switch

---

## Switch Threshold Rules

A new parameter set should not replace the current one unless improvement is meaningful.

Recommended switch conditions:

- net pnl improves by at least 20%
- or max drawdown materially improves
- or avg net pnl per trade materially improves
- and trade count does not increase excessively
- and 3-month / 1-month windows are at least partially aligned

Suggested decision rule:

```text
switch only if:
(new_net_pnl >= current_net_pnl * 1.20)
AND
(new_avg_net_per_trade > current_avg_net_per_trade)
AND
(new_trade_count is not materially inflated)
```

If not satisfied:

- keep current production parameters

---

## Primary Evaluation Metrics

Must use:

- net pnl
- max drawdown
- trade count
- avg net pnl per trade
- profit factor after cost
- win rate
- longest losing streak
- positive-week ratio / positive-month ratio if available

Should not be used alone as the main criterion:

- gross pnl
- raw top-1 rank
- raw win rate without cost context

---

## Cost-Aware Safety Rules

Because prior analysis showed that fees can materially reduce edge, add these guards:

### Minimum Edge Rule

A candidate should be considered weak if:

- avg net pnl per trade is close to zero
- or only slightly above estimated per-trade cost

### Trade Inflation Rule

Reject candidates if:

- net pnl improves only because trade count jumps sharply
- or strategy becomes much noisier with little improvement in avg net per trade

### Negative Consensus Rule

If most top candidates are still net negative after cost:

- do not deploy a newly optimized variant
- consider fallback or pause

---

## Fallback Logic

Do not remove the slow family.
It must remain available as a fallback regime.

Fallback family:

```text
H25/H30 + ATRSL4
```

### Trigger Conditions for Fallback Consideration

Consider fallback when:

- both 3-month and 1-month windows begin favoring `H25` or `H30`
- `H10` underperforms for multiple consecutive weeks
- trade count remains high but avg net pnl per trade declines
- drawdown expands while fast regime edge weakens
- market behavior appears slower / less explosive

---

## Position Sizing Rules

Parameter updates and size changes must be separate decisions.

### Rule 1: Do Not Increase Size During Instability

If weekly optimized parameters change frequently across families:

- keep conservative size
- do not scale up

### Rule 2: Increase Size Only After Repeated Stability

Scale only when all of the following hold across multiple weeks:

- same family repeatedly appears
- ATRSL stays in stable band
- ATRTP stays in stable band
- net pnl remains positive after cost
- drawdown stays controlled
- avg net pnl per trade remains healthy

### Rule 3: Gradual Scaling Only

Example progression:

```text
0.1 lot -> 0.2 lot -> 0.3 lot
```

Do not jump directly to a large size.

### Rule 4: Scale Based on Net Metrics, Not Optimism

Only scale if the strategy already survives after fees and costs.

---

## Reduce / Pause Rules

### Reduce Size

Reduce size when one or more occur:

- 2 consecutive losing weeks
- significant drop in avg net pnl per trade
- 3-month and 1-month windows diverge strongly
- top candidates remain only marginally profitable

### Pause

Pause when one or more occur:

- repeated weekly conflict with no stable consensus
- all top candidates are near zero or negative after cost
- drawdown exceeds the predefined hard threshold
- regime is unclear and no fallback has convincing net edge

---

## Recommended Weekly Output Structure

Each weekly run should generate a machine-readable result.

Suggested output keys:

```json
{
  "runDate": "YYYY-MM-DD",
  "trainWindow3m": {
    "start": "YYYY-MM-DD",
    "end": "YYYY-MM-DD",
    "topCandidates": []
  },
  "trainWindow1m": {
    "start": "YYYY-MM-DD",
    "end": "YYYY-MM-DD",
    "topCandidates": []
  },
  "consensus": {
    "family3m": "H10",
    "family1m": "H10",
    "atrslBand": ["3.5", "4.0"],
    "atrtpBand": ["3", "4"],
    "agreementLevel": "strong"
  },
  "decision": {
    "action": "keep|switch|fallback|reduce|pause",
    "selectedParams": {
      "hold": "H10",
      "atrsl": 4,
      "atrtp": 4
    },
    "sizePolicy": "normal|reduced|unchanged",
    "reason": "..."
  }
}
```

---

## Recommended Engineering Modules

Suggested module boundaries for implementation:

### 1. Data Loader
Responsibilities:

- fetch candles
- fetch signals
- construct rolling windows

### 2. Cost Model
Responsibilities:

- commission calculation
- spread application
- optional slippage model
- net trade result calculation

### 3. Backtest Engine
Responsibilities:

- simulate trades for a given parameter set
- output net performance metrics

### 4. Optimizer
Responsibilities:

- enumerate candidate parameter sets
- rank them by net metrics
- return top N

### 5. Consensus Analyzer
Responsibilities:

- inspect top candidates
- extract family / ATRSL / ATRTP clustering
- compute agreement level

### 6. Decision Engine
Responsibilities:

- compare new consensus versus current production config
- apply switch thresholds
- decide keep / switch / fallback / reduce / pause

### 7. Weekly Reporter
Responsibilities:

- persist results
- output markdown / json summaries
- compare this week versus prior week

---

## Suggested Default Production Policy

Start with this default:

```text
Primary = H10 + ATRSL4 + ATRTP4
```

Allow small nearby adjustments only:

```text
ATRSL in [3.5, 4.0]
ATRTP in [3, 4]
```

Fallback:

```text
H25/H30 + ATRSL4
```

Weekly cadence:

- re-run every week
- no switch unless improvement is meaningful
- no scale-up unless repeated stability is confirmed
- reduce or pause when net edge becomes too thin

---

## Pseudocode

```pseudo
weekly_run():
    data_3m = build_window(months=3)
    data_1m = build_window(months=1)

    top_3m = optimize(data_3m, top_n=5, use_net_metrics=true)
    top_1m = optimize(data_1m, top_n=5, use_net_metrics=true)

    consensus_3m = analyze_consensus(top_3m)
    consensus_1m = analyze_consensus(top_1m)

    merged = merge_consensus(consensus_3m, consensus_1m)

    decision = decide_next_week(
        merged_consensus=merged,
        current_params=current_live_params,
        current_size=current_size,
        switch_threshold=0.20,
        fallback_enabled=true
    )

    save_weekly_result({
        top_3m,
        top_1m,
        consensus_3m,
        consensus_1m,
        merged,
        decision
    })

    return decision
```

---

## Final Principle

Update every week, but do not chase weekly champions.

Use:

- 3-month rolling as the main regime anchor
- 1-month rolling as confirmation / warning
- net performance after cost as the primary truth
- stable parameter zones instead of single-point winners
- controlled switching and gradual size changes

This framework is intended to maximize survivability under real trading costs, not just maximize gross backtest performance.
