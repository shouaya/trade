# Latest Training Snapshot Comparison

Date: 2026-03-07

Sources:
- `configs/top-strategies/2024_v3_atr_top3.snapshot.json`
- `configs/top-strategies/2025_v3_atr_top3.snapshot.json`
- `configs/top-strategies/2026_02_rolling_top3.snapshot.json`

## Executive Summary

The latest `2024`, `2025`, and `rolling` training snapshots point to two different market regimes.

- `2024` favors a slower, higher-win-rate setup with wider stop loss and longer holding time.
- `2025` shifts to a faster setup with shorter holding time, tighter stop loss, better PnL efficiency, and much smaller drawdown.
- Latest `rolling` confirms the `2025` direction rather than reverting to the `2024` style. It keeps the short holding time and improves risk-adjusted performance further.

Practical conclusion:

- `2024` is useful as a historical reference, not as the current default trading style.
- `2025` is the first strong signal that the preferred strategy regime changed.
- Latest `rolling` is the best current reference for production selection because it is both recent and structurally consistent with `2025`.

## Top 1 Comparison

| Snapshot | Strategy | Hold | ATR SL | ATR TP | Trades | Win Rate | Total PnL | Avg PnL | Sharpe | Profit Factor | Max DD | Score |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2024 | `RSI-P14-OS30-OB70-MP1-LOT0.1-H25-ATRSL4-ATRTP5` | 25 | 4.0 | 5 | 679 | 65.54% | 2073.0 | 3.05 | 0.0685 | 1.2069 | -1114.5 | 84.6057 |
| 2025 | `RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL3-ATRTP5` | 10 | 3.0 | 5 | 663 | 55.20% | 3458.5 | 5.22 | 0.1475 | 1.4926 | -358.5 | 255.9977 |
| Rolling (`2026_02`) | `RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL3.5-ATRTP5` | 10 | 3.5 | 5 | 653 | 54.52% | 3519.0 | 5.39 | 0.1538 | 1.5202 | -320.0 | 268.1736 |

## What Changed

### 1. Holding time collapsed from `25` to `10`

This is the clearest structural shift.

- `2024` prefers `H25`
- `2025` prefers `H10`
- latest `rolling` still prefers `H10`

Interpretation:

The edge now comes from faster trade resolution. The market no longer rewards the older, slower mean-reversion hold as efficiently as before.

### 2. Stop loss became tighter

- `2024`: `ATRSL4`
- `2025`: `ATRSL3`
- latest `rolling`: `ATRSL3.5`

Interpretation:

Recent windows still want a tighter risk envelope than `2024`, but the latest rolling result slightly relaxes the `2025` stop from `3.0` to `3.5`. That looks like a fine-tuning move, not a regime reversal.

### 3. Win rate dropped, but quality improved

The newer strategies win less often but make more money per trade and carry risk much better.

- `2024` has the highest win rate, but also the worst drawdown by far
- `2025` and `rolling` trade off win rate for stronger expectancy
- `rolling` is the best balance among the three

This is an important reminder: higher win rate is not the same thing as better strategy quality.

## Regime Interpretation

### 2024

The `2024` winner is a classic high-hit-rate, lower-efficiency profile:

- long hold (`25`)
- wide stop (`4.0`)
- modest average profit per trade (`3.05`)
- weak Sharpe (`0.0685`)
- large drawdown (`-1114.5`)

This setup still works, but it works expensively. It needs more room, tolerates more heat, and produces weaker capital efficiency.

### 2025

The `2025` winner is a different profile:

- short hold (`10`)
- tighter stop (`3.0`)
- much higher average trade value (`5.22`)
- much stronger Sharpe (`0.1475`)
- much lower drawdown (`-358.5`)

This is the first strong indication that the market moved toward a faster and cleaner trade structure.

### Latest rolling

The latest rolling winner is the most relevant current signal:

- same short hold (`10`) as `2025`
- SL moved from `3.0` to `3.5`
- PnL improved again to `3519.0`
- Sharpe improved again to `0.1538`
- drawdown improved again to `-320.0`

That suggests the `2025` style is still correct, and the rolling model is refining it rather than replacing it.

## Top 3 Shape Matters

Each snapshot shows a plateau in the top 3:

- `2024`: top 3 differ mainly in `ATRTP4/5/6`
- `2025`: top 3 differ mainly in `ATRTP5/6/7`
- latest `rolling`: top 3 differ mainly in `ATRTP5/6/7`

Observation:

The main driver is probably not `TP` anymore. The stronger determinants appear to be:

- `maxHoldMinutes`
- `slMultiplier`
- exit logic before hard take profit is reached

This means the search space could likely be simplified without losing much signal:

- keep `H10` in the current regime
- focus on `ATRSL 3.0` to `3.5`
- reduce redundant `TP` variants if they continue producing identical outcomes

## Recommendation

For current deployment or forward validation, prefer the latest rolling family over both fixed-year winners.

Suggested priority:

1. Use the latest rolling winner as the main candidate
2. Keep the `2025` winner as the fallback benchmark
3. Keep the `2024` winner only as an older-regime reference, not as the default choice

If one production candidate must be selected today, the best choice is:

`RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL3.5-ATRTP5`

Reason:

- most recent regime fit
- best PnL of the three leaders
- best Sharpe of the three leaders
- best drawdown profile of the three leaders
- consistent with the 2025 structural shift rather than contradicting it

## Final Comment

The comparison does not show random optimizer noise. It shows a stable directional change:

- old regime: slower, wider, higher hit rate
- new regime: faster, tighter, lower hit rate, better expectancy

That is the main takeaway. The model is not just picking different parameters; it is selecting a different trading style.
