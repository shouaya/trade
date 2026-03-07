# Final Comprehensive Comparison Report

## Scope

This report compares the three completed fee-aware lines:

1. `2024 fixed`
2. `2025 fixed`
3. `rolling`

Source reports:
- [2024_training_and_2025_2026_validation_summary.md](/Users/shoushoushou/git/trade/train/reports/2024_training_and_2025_2026_validation_summary.md)
- [2025_training_and_2024_2026_validation_summary.md](/Users/shoushoushou/git/trade/train/reports/2025_training_and_2024_2026_validation_summary.md)
- [rolling_training_and_validation_summary.md](/Users/shoushoushou/git/trade/train/reports/rolling_training_and_validation_summary.md)

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
- All `2026` evidence in this report is limited to `2026-01-01` through `2026-02-27`
- No statement here should be read as a full-year `2026` conclusion

## Executive Summary

Fees change the ranking logic materially.

The three lines now say:
- `2024 fixed` is no longer fee-aware profitable in-sample, but it still validates forward on `2025` and available `2026 Jan-Feb`
- `2025 fixed` is fee-aware profitable in-sample and on available `2026 Jan-Feb`, but fails backward on `2024`
- `rolling` still best captures the fast `H10` regime, but its month-to-month edge is thinner than the no-fee report suggested

Current preferred production baseline:
- `H10` family
- current working core: `H10 + ATRSL4`
- current operating target band: `ATRTP3` to `ATRTP4`

Fallback reference:
- `2024 fixed` remains the cleanest slow-regime fallback

## Line-By-Line Comparison

### 1. 2024 Fixed

Core result:
- Training winner: `H25 + ATRSL4 + ATRTP4/5`
- Training net return on margin: `-141.8%`
- `2025` forward validation net return on margin: `65.1%`
- `2026 Jan-Feb` forward validation net return on margin: `113.4%`

What it means:
- This line no longer clears fees inside its own training window
- But it still preserves positive cross-period validation
- `ATRSL4` remains highly stable
- Hold time remains slower than the later lines

Main strength:
- Best slow-regime fallback

Main weakness:
- Fee-aware in-sample profitability is gone

### 2. 2025 Fixed

Core result:
- Training winner: `H10 + ATRSL4 + ATRTP4/5/6/7`
- Training net return on margin: `208.5%`
- `2024` reverse validation net return on margin: `-229.6%`
- `2026 Jan-Feb` forward validation net return on margin: `82.8%`

What it means:
- This line remains the clearest proof that the dominant structure changed from `H25/H30` to `H10`
- It still works in-sample and in the available forward slice
- It does not generalize backward into the older regime after fees

Main strength:
- Clearest fee-aware regime-shift detector

Main weakness:
- Backward robustness is weak

### 3. Rolling

Core result:
- Training winners: `H10` in `12/14` months, `ATRTP4` in `14/14` months
- Training total winner net return: `512.7%`
- Training positive months: `8/14`
- Validation winners: profitable in `8/14` months
- Validation total winner net return: `321.2%`
- Validation average per month: `22.9%`

What it means:
- The rolling line still confirms the `H10` fast structure
- It adapts mainly through `ATRSL` and secondarily through `TP3` vs `TP4`
- But fees remove a large part of the apparent smoothness from the no-fee version

Main strength:
- Best current adaptation line

Main weakness:
- Net month-to-month dispersion is now significant

## Stable Parameters Vs Regime-Sensitive Parameters

Stable across all three lines:
- RSI(14)
- OS30 / OB70
- `maxPositions = 1`
- `lotSize = 0.1`
- MA200 filter, MTF filter, ATR sizing, trailing stop, RSI reversion remain enabled

Relatively stable:
- `ATRSL` stays inside `3.0` to `4.0`
- `ATRSL4` is still the single most repeatable stop-loss setting across the completed work

Regime-sensitive:
- Hold time is still the clearest regime variable
- `2024 fixed`: `H25/H30`
- `2025 fixed`: `H10`
- `rolling`: overwhelmingly `H10`

Weakly identified:
- `ATRTP`
- It behaves more like a narrow operating band than a sharply optimized value

## What Fees Change

Main effect:
- Gross edge is not enough by itself; turnover now matters directly
- Fast families still win structurally, but only when the underlying gross edge is large enough to survive `GMOCOIN` commission

Observed consequences:
- `2024 fixed` training turns net negative
- `2025 fixed` remains net positive in-sample, but loses backward robustness
- Rolling early months are net negative even at the winner level
- Rolling validation remains positive overall, but only `8/14` months are positive

Practical implication:
- The correct question is no longer just "which family ranks highest gross"
- The correct question is "which family survives fee drag while remaining stable enough across adjacent regimes"

## Which Baseline Should Be Preferred Now

Preferred production baseline:
- `rolling`

Reason:
- It is still the most current line
- It agrees with the `2025 fixed` regime shift instead of contradicting it
- Its latest completed month still points to `H10-ATRSL4-ATRTP4`
- It retains positive net validation in aggregate even after fees

Operational caveat:
- This is now a narrower recommendation than before
- Rolling is the best available baseline, not a smooth high-margin baseline

Recommended working production expression:
- Primary: `H10 + ATRSL4 + ATRTP4`
- Acceptable nearby variant: `H10 + ATRSL3.5 + ATRTP3/4`

Fallback baseline:
- `2024 fixed`, if a slower and more conservative backup is needed

Not recommended as primary baseline:
- `2025 fixed` by itself

Reason:
- It is valuable as regime evidence, but the rolling line gives a better current operational view

## Final Conclusion

The fee-aware workflow still does not support reverting to the older slow `2024` structure as the default live baseline.

The stronger fee-aware conclusion is:
- the market regime changed toward `H10`
- `ATRSL4` is still the most stable shared anchor
- `TP` should not be overfit
- rolling remains the best production reference, but with materially thinner edge after fees

If one baseline must be selected now, use:
- `GMOCOIN-RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL4-ATRTP4`

And keep these caveats attached:
- `2026` evidence currently means only `2026-01` and `2026-02`
- rolling validation has `6/14` losing months after fees
- `2024 fixed` should remain available as a slow-regime fallback rather than being discarded
