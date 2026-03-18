# ETHJPY Fixed Vs Rolling Comparison Report

## Scope

This report compares three ETHJPY strategy lines under the current corrected metric logic.

Compared lines:

1. `2024 fixed`
2. `2025 fixed`
3. `rolling`

Source reports:

- `train/reports/2024_training_and_2025_2026_validation_summary.md`
- `train/reports/2025_training_and_2024_2026_validation_summary.md`
- `train/reports/rolling_training_and_validation_summary.md`

Execution assumptions:

- `tradingSchedule = ALWAYS`
- `tradingTimeRestriction = null`
- commission model: `GMOCOIN`, `notional x 0.002%` on entry and exit
- ranking is based on corrected `score -> return_pct -> total_pnl`

Metric note:

- the current engine is already symbol-aware for `ETHJPY`
- `PnL` is calculated in quote currency `JPY`
- `return_pct` and `max_drawdown_pct` are normalized using the current `1,000,000 JPY` capital baseline

Scope note:

- all `2026` fixed-window results in this report are only `2026-01-01` to `2026-03-18`
- rolling `2026-03` is also month-to-date through `2026-03-18`
- rolling aggregate results are not a strict apples-to-apples substitute for full-year fixed validation, because rolling re-trains every month

## Executive Conclusion

The three lines answer different questions.

- `2024 fixed` is the best static cross-period baseline
- `2025 fixed` is the strongest single-year winner, but it is too regime-sensitive to be the primary baseline
- `rolling` is the best operational framework if the goal is ongoing adaptation

If one static strategy must be kept as the baseline today, use:

- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL3.5-ATRTP4`

If the goal is live operation with periodic retraining, use:

- the monthly rolling workflow

## Line 1: 2024 Fixed

Selected winner:

- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL3.5-ATRTP4`

Training result:

- Trades: `817`
- Win rate: `53.61%`
- Total PnL: `4391.49`
- Return %: `0.4391%`
- Max drawdown %: `-0.4940%`
- Score: `0.0200`

Cross-period validation:

| Window | Trades | Win Rate | Total PnL | Return % | Max DD % | Score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `2025` | 883 | 51.30% | 5948.43 | 0.5948% | -0.3960% | 0.0350 |
| `2026-01-01` to `2026-03-18` | 166 | 47.59% | 334.52 | 0.0335% | -0.1167% | 0.0006 |

Reading:

- this line remains positive in both later windows
- `2025` validation is stronger than its own training year
- `2026` is much weaker, but still positive

Conclusion:

- `2024 fixed` is the strongest robustness baseline among the three choices

## Line 2: 2025 Fixed

Selected winner:

- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H15-ATRSL3-ATRTP4`

Training result:

- Trades: `881`
- Win rate: `49.15%`
- Total PnL: `7257.04`
- Return %: `0.7257%`
- Max drawdown %: `-0.4007%`
- Score: `0.0513`

Cross-period validation:

| Window | Trades | Win Rate | Total PnL | Return % | Max DD % | Score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `2024` | 818 | 51.10% | 2803.30 | 0.2803% | -0.6043% | 0.0073 |
| `2026-01-01` to `2026-03-18` | 166 | 45.78% | -117.19 | -0.0117% | -0.1646% | 0.0000 |

Reading:

- this is the strongest in-sample winner across the fixed annual runs
- it still works on `2024`, but it is weaker than the true `2024` winner
- by `2026-03-18`, it has already slipped slightly negative

Conclusion:

- `2025 fixed` is a useful regime marker, but not the best production baseline

## Line 3: Rolling

Rolling execution summary:

- Execution months: `2025-01` to `2026-03`
- Positive months: `11/15`
- Negative months: `4/15`
- Total validation PnL: `5689.90`
- Average monthly validation return: `0.0379%`

Selected family evolution:

- `2025-01`: `H10-ATRSL3.5-ATRTP4`
- `2025-02` to `2026-01`: mostly `H15`
- `2026-02` and `2026-03`: `H5-ATRSL4-ATRTP4`

Rolling strengths:

- it captures regime movement that the fixed lines miss
- it stayed positive in aggregate across the whole executed history
- it adapts mainly through hold time first, then `ATRSL/ATRTP`

Rolling weaknesses:

- month-to-month dispersion is real
- it does not remove losing months, it only improves adaptability
- its aggregate result is built from repeated retraining, so it should not be treated as the same object as a single fixed-strategy backtest

Conclusion:

- rolling is the best adaptive framework

## Direct Comparison

### Best At What

| Line | Main Strength | Main Weakness |
| --- | --- | --- |
| `2024 fixed` | best cross-period robustness | weaker edge in `2026` |
| `2025 fixed` | strongest in-sample peak | weakest robustness |
| `rolling` | best adaptability to regime change | month-to-month variability |

### Strategy Shape

| Line | Dominant Hold | Dominant ATRSL | Dominant ATRTP | Best Interpretation |
| --- | --- | --- | --- | --- |
| `2024 fixed` | `H10` | `3.5` | `4` | robust static baseline |
| `2025 fixed` | `H15` | `3` | `4` | strong same-regime candidate |
| `rolling` | `H15` in most of `2025`, then `H5` in latest months | mostly `3.5/4` | mostly `3/4` | adaptive operating process |

### Robustness Ranking

Current ranking by robustness:

1. `2024 fixed`
2. `rolling`
3. `2025 fixed`

Reason:

- `2024 fixed` stays positive in both later windows without changing parameters
- `rolling` adapts and stays positive overall, but it does so by changing the winner each month
- `2025 fixed` has the highest peak, but the weakest transfer into other regimes

### Adaptation Ranking

Current ranking by adaptation usefulness:

1. `rolling`
2. `2025 fixed`
3. `2024 fixed`

Reason:

- rolling directly tracks the evolving market state
- `2025 fixed` correctly captured the stronger `H15` regime in its own year
- `2024 fixed` is stable, but it is not the best detector of newer shifts

## Practical Recommendation

Use two layers rather than one.

Static reference baseline:

- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL3.5-ATRTP4`

Adaptive live framework:

- monthly rolling retraining and validation

Operational reading:

- when rolling stays near `H10/H15` with `ATRSL3.5/4` and `ATRTP3/4`, the system is still operating inside the known ETHJPY family
- when rolling shifts materially, as it did into `H5` by `2026-02`, that should be treated as a real market-state update rather than noise

## Final Takeaway

The current ETHJPY evidence does not support using the `2025` fixed winner alone as the default strategy.

The cleaner reading is:

- `2024 fixed` is still the best static baseline
- `rolling` is the best live operating model
- `2025 fixed` is important evidence of regime change, but not the best standalone deployment choice
