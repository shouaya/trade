# 2025 Training And 2024/2026 Validation Summary

## Scope

This summary covers the fee-aware fixed-window `2025` cycle under the current bid/ask execution model.

- Training window: `2025-01-01` to `2025-12-31`
- Reverse validation window: `2024-01-01` to `2024-12-31`
- Forward validation window: `2026-01-01` to `2026-02-27`

Capital basis used for both training and validation:
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`
- All return ratios below are normalized by `500 USD`

Execution note:
- FX import used `priceType=BOTH`
- Storage and execution remained bid/ask-aware
- Fee model used `GMOCOIN`
- Commission rule: `notional x 0.002%` on both entry and exit

Important scope limit:
- Current `2026` validation is not a full-year validation
- Current DB coverage ends at `2026-02-27 20:59:00 UTC`

## Data Notes

Dataset used by this run:
- `2024`: `371,160` bars
- `2025`: `369,638` bars
- `2026-01` to `2026-02`: `58,500` bars

Observed 2025 data characteristics:
- Current `2025` bar count for this fee-aware rerun is `369,638`
- This run should be treated as the canonical count for the current database

## Training Result: 2025

Training config:
- [2025_atr.json](/Users/shoushoushou/git/trade/train/configs/training/2025_atr.json)

Run summary:
- Strategies tested: `150`
- Valid strategies: `150`

Top training result:
- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL4-ATRTP4`
- tied with `...ATRTP5`
- tied with `...ATRTP6`
- tied with `...ATRTP7`

Top metrics:
- Trades: `663`
- Win rate: `51.73%`
- Gross return on margin: `473.7%`
- Commission / margin: `265.2%`
- Net return on margin: `208.5%`
- Sharpe: `0.0451`
- Max drawdown / margin: `-119.5%`
- Score: `22.0949`

Interpretation:
- The winning family remains clearly `H10 + ATRSL4`
- `ATRTP=4/5/6/7` remains a full plateau at the top
- Fees materially reduce the 2025 edge, but this line still survives in-sample as net profitable

## Validation: 2024

Validation config:
- [2025_atr_2024_validation.json](/Users/shoushoushou/git/trade/train/configs/validation/2025_atr_2024_validation.json)

Validation candidates:
- `H10`
- `ATRSL = 4`
- `ATRTP = 4/5/6/7`

Top validation result:
- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL4-ATRTP4`
- tied with `...ATRTP5`

Top metrics:
- Trades: `715`
- Win rate: `47.55%`
- Gross return on margin: `56.4%`
- Commission / margin: `286.0%`
- Net return on margin: `-229.6%`
- Sharpe: `-0.0421`
- Max drawdown / margin: `-367.3%`
- Score: `-4.9627`

Interpretation:
- The 2025 winner no longer generalizes backward into 2024 after fees
- Gross edge exists, but it is far smaller than the fee burden
- This is the clearest sign that the `2025` fast family is regime-specific rather than backward-robust

## Validation: 2026 Jan-Feb

Validation config:
- [2025_atr_2026_validation.json](/Users/shoushoushou/git/trade/train/configs/validation/2025_atr_2026_validation.json)

Important scope limit:
- This result only covers `2026-01-01` to `2026-02-27`
- It must not be described as full-year 2026 validation

Top validation result:
- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL4-ATRTP4`
- tied with `...ATRTP5`
- tied with `...ATRTP6`
- tied with `...ATRTP7`

Top metrics:
- Trades: `124`
- Win rate: `48.39%`
- Gross return on margin: `132.4%`
- Commission / margin: `49.6%`
- Net return on margin: `82.8%`
- Sharpe: `0.0694`
- Max drawdown / margin: `-53.7%`
- Score: `12.6340`

Interpretation:
- The 2025 winner family remains net profitable in the currently available 2026 Jan-Feb slice
- `ATRTP` is again a plateau parameter in this forward window
- `H10 + ATRSL4` remains intact across training and the available forward period

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
- MA200 filter, MTF filter, ATR sizing, trailing stop, RSI reversion remain enabled

Weakly identified element:
- `ATRTP`
- It is a clear plateau parameter in training and in the available 2026 forward window

## Conclusion

The fee-aware rerun keeps the structural conclusion but changes the robustness conclusion.

Current practical conclusion:
- Preferred `2025 fixed` family remains `H10 + ATRSL4`
- `ATRTP4/5/6/7` should still be treated as operationally equivalent
- This line is fee-aware profitable in-sample and on available `2026 Jan-Feb`
- This line is fee-aware negative on `2024`, so it should not be treated as a cross-regime baseline

Recommended fixed-window interpretation:
- Use `2025 fixed` primarily as evidence of the fast-regime shift
- Do not use its `2024` reverse validation as support for backward robustness
- Keep the explicit note that current `2026` evidence only covers `2026-01-01` to `2026-02-27`
