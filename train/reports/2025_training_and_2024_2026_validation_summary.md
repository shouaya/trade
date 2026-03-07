# 2025 Training And 2024/2026 Validation Summary

## Scope

This summary covers the fixed-window `2025` training cycle under the latest bid/ask execution model.

- Training window: `2025-01-01` to `2025-12-31`
- Reverse validation window: `2024-01-01` to `2024-12-31`
- Forward validation window: `2026-01-01` to `2026-02-27`

Execution note:
- FX import used `priceType=BOTH`
- Storage and execution both remain bid/ask-aware
- No synthetic bars were added for missing source data

## Data Notes

Dataset used by this run:
- `2024`: `371,160` bars
- `2025`: `368,257` bars
- `2026-01` to `2026-02`: `58,500` bars

Observed 2025 data characteristics:
- The previously known source gaps remain visible:
  - `2025-04-14 21:14 UTC -> 2025-04-14 21:18 UTC`
  - `2025-09-08 03:01 UTC -> 2025-09-08 04:21 UTC`
- This import also reflects shortened sessions around:
  - `2025-06-20`
  - `2025-12-25`
- Current `2025` bar count is lower than the older integrity report and should be treated as the canonical count for this run

Important scope limit:
- Current `2026` validation is not a full-year validation
- Current DB coverage ends at `2026-02-27 20:59:00 UTC`

## Training Result: 2025

Training config:
- [2025_atr.json](/Users/shoushoushou/git/trade/train/configs/training/2025_atr.json)

Run summary:
- Strategies tested: `150`
- Valid strategies: `150`
- Total simulated trades: `100,645`
- Training bars loaded: `368,257`
- Runtime: `5.3` minutes

Top training result:
- `RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL4-ATRTP4`
- tied with `...ATRTP5`
- tied with `...ATRTP6`
- tied with `...ATRTP7`

Top metrics:
- Trades: `660`
- Win rate: `54.09%`
- Total PnL: `2294.50`
- Sharpe: `0.0995`
- Max drawdown: `-315.50`
- Score: `112.2904`

Interpretation:
- The winning family is clearly `H10 + ATRSL4`
- `ATRTP=4/5/6/7` forms a complete plateau at the top
- Relative to the older 2025 snapshot, this rerun favors `ATRSL4` over `ATRSL3.5`

## Validation: 2024

Validation config:
- [2025_atr_2024_validation.json](/Users/shoushoushou/git/trade/train/configs/validation/2025_atr_2024_validation.json)

Validation candidates:
- `H10`
- `ATRSL = 4`
- `ATRTP = 4/5/6/7`

Top validation result:
- `RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL4-ATRTP4`
- tied with `...ATRTP5`

Top metrics:
- Trades: `715`
- Win rate: `50.63%`
- Total PnL: `282.00`
- Sharpe: `0.0104`
- Max drawdown: `-1155.50`
- Score: `1.3435`

Interpretation:
- The 2025 winner remains profitable on 2024 data, but only marginally
- `ATRTP4/5` lead slightly over `ATRTP6/7`
- The family generalizes backward, but much less strongly than it performs in-sample

## Validation: 2026 Jan-Feb

Validation config:
- [2025_atr_2026_validation.json](/Users/shoushoushou/git/trade/train/configs/validation/2025_atr_2026_validation.json)

Important scope limit:
- This result only covers `2026-01-01` to `2026-02-27`
- It must not be described as full-year 2026 validation

Validation candidates:
- `H10`
- `ATRSL = 4`
- `ATRTP = 4/5/6/7`

Top validation result:
- `RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL4-ATRTP4`
- tied with `...ATRTP5`
- tied with `...ATRTP6`
- tied with `...ATRTP7`

Top metrics:
- Trades: `124`
- Win rate: `52.42%`
- Total PnL: `662.00`
- Sharpe: `0.1109`
- Max drawdown: `-224.50`
- Score: `34.9960`

Interpretation:
- The 2025 winner family is clearly profitable in the currently available 2026 Jan-Feb window
- `ATRTP` is again a plateau parameter in this forward slice
- `H10 + ATRSL4` remains intact across training and available forward validation

## Cross-Period Comparison

Best structure by stage:
- 2025 training: `H10 + ATRSL4 + ATRTP4/5/6/7`
- 2024 validation: `H10 + ATRSL4 + ATRTP4/5`
- 2026 Jan-Feb validation: `H10 + ATRSL4 + ATRTP4/5/6/7`

Stable elements:
- RSI(14), OS30 / OB70
- `maxPositions = 1`
- `lotSize = 0.1`
- `maxHoldMinutes = 10`
- `ATRSL = 4`
- MA200 filter, MTF, ATR sizing, trailing stop, RSI reversion remain enabled

Weakly identified element:
- `ATRTP`
- It is a clear plateau parameter in training and in 2026 Jan-Feb
- It only weakly separates in 2024 validation

## Conclusion

The latest bid/ask-based fixed-window rerun favors a tighter and faster 2025 family than the older 2025 snapshot.

Current practical conclusion:
- Preferred 2025 fixed family: `H10 + ATRSL4`
- `ATRTP` should be treated as a plateau parameter, not a sharply optimized value
- Backward validation on `2024` is positive but weak
- Forward validation on available `2026 Jan-Feb` data is positive and materially stronger than the 2024 reverse validation

Recommended fixed-window baseline from this run:
- Primary baseline: `H10 + ATRSL4`
- Treat `ATRTP4/5/6/7` as operationally equivalent until a longer forward window separates them
- Keep the explicit note that current 2026 evidence only covers `2026-01-01` to `2026-02-27`
