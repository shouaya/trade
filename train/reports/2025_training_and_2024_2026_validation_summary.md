# 2025 Training And 2024/2026 Validation Summary

## Scope

This summary covers the corrected `ETHJPY` fixed-window `2025` training cycle and single-best reverse/forward validation.

- Instrument: `ETHJPY`
- Interval: `1min`
- Training window: `2025-01-01` to `2025-12-31`
- Reverse validation window: `2024-01-01` to `2024-12-31`
- Forward validation window: `2026-01-01` to `2026-03-18`

Configs used:
- Training: `train/configs/training/2025_ethjpy_atr.json`
- Validation 2024: `train/configs/validation/2025_ethjpy_best_2024_validation.json`
- Validation 2026: `train/configs/validation/2025_ethjpy_best_2026_validation.json`

Execution assumptions:
- `tradingSchedule = ALWAYS`
- `tradingTimeRestriction = null`
- commission model: `GMOCOIN`, `notional x 0.002%` on entry and exit
- ranking is based on corrected `score -> return_pct -> total_pnl`

Metric note:
- current engine is already symbol-aware for `ETHJPY`
- `PnL` is calculated in quote currency `JPY`
- `return_pct` and `max_drawdown_pct` are normalized using the current `1,000,000 JPY` capital baseline

## Training Result: 2025

Result table:
- `backtest_results_2025_ethjpy_v3_atr`

Run summary:
- Strategies tested: `150`
- Valid strategies: `150`
- Total simulated trades: `135100`
- Runtime: about `6.2 minutes`

Top training strategies:

| Rank | Strategy | Trades | Win Rate | Total PnL | Return % | Max Drawdown | Max DD % | Score |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H15-ATRSL3-ATRTP4` | 881 | 49.15% | 7257.04 | 0.7257% | -4048.00 | -0.4007% | 0.0513 |
| 2 | `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H15-ATRSL4-ATRTP4` | 869 | 50.06% | 7239.69 | 0.7240% | -3880.08 | -0.3842% | 0.0502 |
| 3 | `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H15-ATRSL3-ATRTP5` | 881 | 49.15% | 7108.03 | 0.7108% | -4048.00 | -0.4008% | 0.0492 |
| 4 | `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H15-ATRSL3-ATRTP6` | 881 | 49.15% | 7108.03 | 0.7108% | -4048.00 | -0.4008% | 0.0492 |
| 5 | `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H15-ATRSL3-ATRTP7` | 881 | 49.15% | 7108.03 | 0.7108% | -4048.00 | -0.4008% | 0.0492 |

Training interpretation:
- the `2025` best point shifts to `H15 + ATRSL3 + ATRTP4`
- compared with `2024`, the hold time becomes longer and stop-loss becomes slightly tighter
- this is a real regime change, not just a minor reshuffle inside the same parameter core

## Best-Strategy Validation: 2024

Validated strategy:
- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H15-ATRSL3-ATRTP4`

Result table:
- `backtest_results_2024_ethjpy_v3_best_from_2025_validation`

Validation result:
- Valid strategies: `1/1`
- Total trades: `818`
- Win rate: `51.10%`
- Total PnL: `2803.30`
- Return %: `0.2803%`
- Max drawdown: `-6054.16`
- Max drawdown %: `-0.6043%`
- Score: `0.0073`

Interpretation:
- the `2025` winner can still make money when reversed onto `2024`
- but it is materially weaker than the true `2024` winner
- this means the `2025` line is not the best cross-period choice for backward robustness

## Best-Strategy Validation: 2026 YTD

Validated strategy:
- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H15-ATRSL3-ATRTP4`

Result table:
- `backtest_results_2026_ethjpy_v3_best_from_2025_validation`

Validation result:
- Period covered: `2026-01-01` to `2026-03-18`
- Valid strategies: `1/1`
- Total trades: `166`
- Win rate: `45.78%`
- Total PnL: `-117.19`
- Return %: `-0.0117%`
- Max drawdown: `-1646.51`
- Max drawdown %: `-0.1646%`
- Score: `0.0000`

Interpretation:
- the `2025` winner does not hold up in the currently available `2026` slice
- PnL is already slightly negative
- this is the clearest evidence that the `2025` winner is more regime-specific than the `2024` winner

## Cross-Period Reading

Best fixed point:
- `H15 + ATRSL3 + ATRTP4`

Observed behavior:
- `2025 train`: strongest of all current single-year winners
- `2024 validate`: still positive, but weaker
- `2026 YTD validate`: already slightly negative

Practical conclusion:
- the `2025` winner is a strong in-sample and same-regime candidate
- it is not the stronger cross-period baseline
- compared with the `2024` winner, it has higher peak performance but weaker robustness

## Recommended Use

- treat `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H15-ATRSL3-ATRTP4` as a regime-sensitive fast candidate, not the primary baseline
- prefer the `2024` winner for cross-period stability
- keep explicit wording that `2026` evidence currently only covers data through `2026-03-18`
