# 2024 Training And 2025/2026 Validation Summary

## Scope

This summary covers the fee-aware fixed-window `2024` cycle under the current bid/ask execution model.

- Training window: `2024-01-01` to `2024-12-31`
- Forward validation window 1: `2025-01-01` to `2025-12-31`
- Forward validation window 2: `2026-01-01` to `2026-02-27`

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

## Training Result: 2024

Training config:
- [2024_atr.json](/Users/shoushoushou/git/trade/train/configs/training/2024_atr.json)

Run summary:
- Strategies tested: `150`
- Valid strategies: `150`
- Total simulated trades: `110,260`

Top training result:
- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H25-ATRSL4-ATRTP4`
- tied with `...H25-ATRSL4-ATRTP5`

Top metrics:
- Trades: `674`
- Win rate: `61.57%`
- Gross return on margin: `127.8%`
- Commission / margin: `269.6%`
- Net return on margin: `-141.8%`
- Sharpe: `-0.0233`
- Max drawdown / margin: `-390.7%`
- Score: `-3.9686`

Interpretation:
- The pre-fee `H25 + ATRSL4` family still tops the 2024 search table
- But once `GMOCOIN` commission is charged on both sides, the full 2024 training window turns net negative
- Fee drag is larger than gross edge in-sample, so this line cannot be described as a self-sustaining fee-aware training winner

## Forward Validation: 2025

Validation config:
- [2024_atr_2025_validation.json](/Users/shoushoushou/git/trade/train/configs/validation/2024_atr_2025_validation.json)

Validation candidates:
- `H25/H30`
- `ATRSL = 4`
- `ATRTP = 4/5/6`

Top validation result:
- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H25-ATRSL4-ATRTP4`
- tied with `...ATRTP5`
- tied with `...ATRTP6`

Top metrics:
- Trades: `617`
- Win rate: `62.07%`
- Gross return on margin: `311.9%`
- Commission / margin: `246.8%`
- Net return on margin: `65.1%`
- Sharpe: `0.0121`
- Max drawdown / margin: `-222.2%`
- Score: `2.2317`

Interpretation:
- The 2024 family still generalizes forward into 2025 after fees
- Net profitability survives, but the edge is much smaller than the gross figure suggests
- `ATRTP4/5/6` remains a plateau parameter

## Forward Validation: 2026 Jan-Feb

Validation config:
- [2024_atr_2026_validation.json](/Users/shoushoushou/git/trade/train/configs/validation/2024_atr_2026_validation.json)

Important scope limit:
- This result only covers `2026-01-01` to `2026-02-27`
- It must not be described as full-year 2026 validation

Top validation result:
- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H30-ATRSL4-ATRTP4`
- tied with `...ATRTP5`
- tied with `...ATRTP6`

Top metrics:
- Trades: `117`
- Win rate: `65.81%`
- Gross return on margin: `160.2%`
- Commission / margin: `46.8%`
- Net return on margin: `113.4%`
- Sharpe: `0.0914`
- Max drawdown / margin: `-43.1%`
- Score: `31.0038`

Interpretation:
- The 2024 family remains net profitable in the currently available 2026 Jan-Feb slice
- The preferred hold time shifts from `H25` to `H30`
- `ATRSL4` remains unchanged

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
- MA200 filter, MTF filter, ATR sizing, trailing stop, RSI reversion remain enabled

Changing element:
- Hold time shows mild drift:
- `2024/2025`: `H25`
- `2026 Jan-Feb`: `H30`

Weakly identified element:
- `ATRTP`
- Across training and both validations, `ATRTP=4/5/6` behaves as a plateau rather than a sharply identified optimum

## Conclusion

The fee-aware rerun changes the practical reading of the `2024 fixed` line.

Current practical conclusion:
- `2024 fixed` no longer clears its own training window after fees
- It still remains net profitable in `2025` validation and in available `2026 Jan-Feb` validation
- The slow-regime structure is therefore still useful as a cross-period fallback, but not as a clean fee-aware primary baseline

Recommended interpretation:
- Keep `H25/H30 + ATRSL4` as a slow fallback family
- Treat `ATRTP4/5/6` as operationally equivalent
- Keep the explicit note that current `2026` evidence only covers `2026-01-01` to `2026-02-27`
