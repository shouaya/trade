# 2024 Training And 2025/2026 Validation Summary

## Scope

This summary covers one complete cycle under the latest bid/ask execution model:

- Training window: `2024-01-01` to `2024-12-31`
- Forward validation window 1: `2025-01-01` to `2025-12-31`
- Forward validation window 2: `2026-01-01` to `2026-02-27`

Important execution note:
- Entry/exit prices are no longer based on a single `close`
- Execution now uses side-aware prices:
  - long entry: `ask`
  - long exit: `bid`
  - short entry: `bid`
  - short exit: `ask`
- This report is based on the latest bid/ask data model

## Training Result: 2024

Training config:
- [2024_atr.json](/d:/git/trade/train/configs/training/2024_atr.json)

Training dataset:
- `USDJPY`
- `1min`
- `371,160` bars

Search space:
- RSI only
- `maxHoldMinutes`: `5, 10, 15, 20, 25, 30`
- `ATR SL`: `2.0, 2.5, 3.0, 3.5, 4.0`
- `ATR TP`: `3.0, 4.0, 5.0, 6.0, 7.0`

Run summary:
- Strategies tested: `150`
- Valid strategies: `150`
- Total simulated trades: `110,260`
- Runtime: `13.7` minutes

Top training result:
- `RSI-P14-OS30-OB70-MP1-LOT0.1-H25-ATRSL4-ATRTP4`
- tied with `RSI-P14-OS30-OB70-MP1-LOT0.1-H25-ATRSL4-ATRTP5`

Top metrics:
- Trades: `674`
- Win rate: `63.65%`
- Total PnL: `639.00`
- Sharpe: `0.0210`
- Max drawdown: `-1551.00`
- Score: `7.7518`

Observation:
- The best 2024 structure remains concentrated around:
  - `H25`
  - `ATRSL = 4`
  - `ATRTP = 4~6`
- `TP=4` and `TP=5` are fully tied
- This again suggests a take-profit plateau rather than a sharply defined TP optimum

## Forward Validation: 2025

Validation config:
- [2024_atr_2025_validation.json](/d:/git/trade/train/configs/validation/2024_atr_2025_validation.json)

Validation candidates:
- `H25/H30`
- `ATRSL = 4`
- `ATRTP = 4/5/6`

Validation dataset:
- `USDJPY`
- `1min`
- `369,638` bars

Top validation result:
- `RSI-P14-OS30-OB70-MP1-LOT0.1-H25-ATRSL4-ATRTP4`
- tied with `...ATRTP5`
- tied with `...ATRTP6`

Top metrics:
- Trades: `617`
- Win rate: `63.21%`
- Total PnL: `1559.50`
- Sharpe: `0.0582`
- Max drawdown: `-639.00`
- Score: `52.1641`

Interpretation:
- The 2024 winner generalizes well into 2025
- `H25` remains superior to `H30` in this forward period
- `ATRSL = 4` remains stable
- `ATRTP = 4/5/6` produces the same total PnL, confirming the TP plateau effect

## Forward Validation: 2026

Validation config:
- [2024_atr_2026_validation.json](/d:/git/trade/train/configs/validation/2024_atr_2026_validation.json)

Important scope limit:
- Current DB only contains `2026-01-01` to `2026-02-27`
- This is not a full-year 2026 validation
- It is effectively a `2026 Jan-Feb forward validation`

Validation dataset:
- `USDJPY`
- `1min`
- `58,500` bars

Top validation result:
- `RSI-P14-OS30-OB70-MP1-LOT0.1-H30-ATRSL4-ATRTP4`
- tied with `...ATRTP5`
- tied with `...ATRTP6`

Top metrics:
- Trades: `117`
- Win rate: `66.67%`
- Total PnL: `801.00`
- Sharpe: `0.1291`
- Max drawdown: `-169.50`
- Score: `62.6784`

Interpretation:
- The 2024 family remains profitable in the 2026 Jan-Feb forward window
- The preferred hold time shifts slightly from `H25` to `H30`
- `ATRSL = 4` remains unchanged
- `ATRTP = 4/5/6` is still a plateau

## Cross-Period Comparison

Best structure by stage:
- 2024 training: `H25 + ATRSL4 + ATRTP4/5`
- 2025 validation: `H25 + ATRSL4 + ATRTP4/5/6`
- 2026 Jan-Feb validation: `H30 + ATRSL4 + ATRTP4/5/6`

Stable elements:
- RSI(14), OS30 / OB70
- `maxPositions = 1`
- `lotSize = 0.1`
- `ATRSL = 4`
- MA200 filter, MTF, ATR sizing, trailing stop, RSI reversion all remain enabled

Changing element:
- Hold time shows mild drift:
  - `2024/2025`: `H25`
  - `2026 Jan-Feb`: `H30`

Weakly identified element:
- `ATRTP`
- Across training and both validations, `ATRTP=4/5/6` behaves almost identically
- This is the least important parameter in the current best-performing family

## Conclusion

The latest bid/ask-based run does not overturn the earlier core conclusion.

Current practical conclusion:
- The 2024 best family is still valid after moving to bid/ask execution
- It remains profitable in 2025 forward validation
- It also remains profitable in the currently available 2026 Jan-Feb forward validation
- The most stable parameter is `ATRSL = 4`
- The most likely adaptive parameter is hold time, shifting from `25` to `30` minutes
- Take-profit remains a plateau parameter and should not be over-interpreted

Recommended working baseline:
- Primary baseline: `H25 + ATRSL4`
- 2026-sensitive variant: `H30 + ATRSL4`
- Treat `ATRTP=4/5/6` as equivalent unless a later validation window separates them clearly
