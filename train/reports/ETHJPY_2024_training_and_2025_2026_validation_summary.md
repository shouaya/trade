# 2024 Training And 2025/2026 Validation Summary

## Scope

This summary covers the corrected `ETHJPY` fixed-window `2024` training cycle and single-best out-of-sample validation.

- Instrument: `ETHJPY`
- Interval: `1min`
- Training window: `2024-01-01` to `2024-12-31`
- Forward validation window 1: `2025-01-01` to `2025-12-31`
- Forward validation window 2: `2026-01-01` to `2026-03-18`

Configs used:
- Training: `train/configs/training/2024_ethjpy_atr.json`
- Validation 2025: `train/configs/validation/2024_ethjpy_best_2025_validation.json`
- Validation 2026: `train/configs/validation/2024_ethjpy_best_2026_validation.json`

Execution assumptions:
- `tradingSchedule = ALWAYS`
- `tradingTimeRestriction = null`
- commission model: `GMOCOIN`, `notional x 0.002%` on entry and exit
- ranking is based on corrected `score -> return_pct -> total_pnl`

Metric note:
- current engine is already symbol-aware for `ETHJPY`
- `PnL` is calculated in quote currency `JPY`
- `return_pct` and `max_drawdown_pct` are normalized using the current `1,000,000 JPY` capital baseline

## Training Result: 2024

Result table:
- `backtest_results_2024_ethjpy_v3_atr`

Run summary:
- Strategies tested: `150`
- Valid strategies: `150`
- Total simulated trades: `124555`
- Runtime: about `6.0 minutes`

Top training strategies:

| Rank | Strategy | Trades | Win Rate | Total PnL | Return % | Max Drawdown | Max DD % | Score |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL3.5-ATRTP4` | 817 | 53.61% | 4391.49 | 0.4391% | -4949.35 | -0.4940% | 0.0200 |
| 2 | `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL4-ATRTP4` | 815 | 53.87% | 4333.27 | 0.4333% | -4986.78 | -0.4976% | 0.0191 |
| 3 | `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H15-ATRSL4-ATRTP4` | 805 | 52.30% | 4425.38 | 0.4425% | -6054.73 | -0.6044% | 0.0190 |
| 4 | `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL3.5-ATRTP5` | 817 | 53.61% | 4117.49 | 0.4117% | -4949.35 | -0.4941% | 0.0174 |
| 5 | `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL3.5-ATRTP6` | 817 | 53.61% | 4117.49 | 0.4117% | -4949.35 | -0.4941% | 0.0174 |

Training interpretation:
- the `2024` best point is `H10 + ATRSL3.5 + ATRTP4`
- `H10` is the clear center of gravity
- `ATRSL3.5` and `ATRSL4` are both competitive, but `ATRTP4` is the cleanest center

## Best-Strategy Validation: 2025

Validated strategy:
- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL3.5-ATRTP4`

Result table:
- `backtest_results_2025_ethjpy_v3_best_validation`

Validation result:
- Valid strategies: `1/1`
- Total trades: `883`
- Win rate: `51.30%`
- Total PnL: `5948.43`
- Return %: `0.5948%`
- Max drawdown: `-3997.29`
- Max drawdown %: `-0.3960%`
- Score: `0.0350`

Interpretation:
- the `2024` winner generalizes well into `2025`
- compared with its own training year, `2025` delivers stronger normalized return and lower drawdown
- this is a good sign that the `2024` winner is not just an in-sample artifact

## Best-Strategy Validation: 2026 YTD

Validated strategy:
- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL3.5-ATRTP4`

Result table:
- `backtest_results_2026_ethjpy_v3_best_validation`

Validation result:
- Period covered: `2026-01-01` to `2026-03-18`
- Valid strategies: `1/1`
- Total trades: `166`
- Win rate: `47.59%`
- Total PnL: `334.52`
- Return %: `0.0335%`
- Max drawdown: `-1167.90`
- Max drawdown %: `-0.1167%`
- Score: `0.0006`

Interpretation:
- the `2024` winner is still positive in the currently available `2026` slice
- edge is much weaker than in `2025`
- this should be treated as early forward confirmation only, not a full-year conclusion

## Cross-Period Reading

Best fixed point:
- `H10 + ATRSL3.5 + ATRTP4`

Observed behavior:
- `2024 train`: profitable, moderate drawdown
- `2025 validate`: stronger than in-sample
- `2026 YTD validate`: still positive, but much weaker

Practical conclusion:
- the `2024` winner is the stronger cross-period baseline so far
- it holds up on both later windows
- its main weakness is not failure, but reduced edge in `2026`

## Recommended Use

- keep `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL3.5-ATRTP4` as the current robust baseline
- keep `H10/H15 + ATRSL4 + ATRTP4` as nearby alternates if later rolling tests are needed
- keep explicit wording that `2026` evidence currently only covers data through `2026-03-18`
