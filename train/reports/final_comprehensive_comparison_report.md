# Final Comprehensive Comparison Report

## Scope

This report compares the three completed lines now available in the repository:

1. `2024 fixed`
2. `2025 fixed`
3. `rolling`

Source reports:
- [2024_training_and_2025_2026_validation_summary.md](/Users/shoushoushou/git/trade/train/reports/2024_training_and_2025_2026_validation_summary.md)
- [2025_training_and_2024_2026_validation_summary.md](/Users/shoushoushou/git/trade/train/reports/2025_training_and_2024_2026_validation_summary.md)
- [rolling_training_and_validation_summary.md](/Users/shoushoushou/git/trade/train/reports/rolling_training_and_validation_summary.md)

Important scope limit:
- All `2026` evidence in this report is limited to `2026-01-01` through `2026-02-27`
- No statement here should be read as a full-year `2026` conclusion

## Executive Summary

The three lines now point to one clear structural conclusion:

- `2024 fixed` is the best stable slow-regime reference
- `2025 fixed` is the strongest proof that the regime shifted toward faster trades
- `rolling` is the best current production baseline because it preserves the `2025` fast structure while adapting more smoothly month to month

Current preferred production baseline:
- `H10` family
- current working core: `H10 + ATRSL4`
- current operating target band: `ATRTP3` to `ATRTP4`

Fallback reference:
- `2024 fixed` remains the cleanest slow-regime backup, centered on `H25/H30 + ATRSL4`

## Line-By-Line Comparison

### 1. 2024 Fixed

Core result:
- Training winner: `H25 + ATRSL4 + ATRTP4/5`
- 2025 forward validation: profitable at `1559.50`
- 2026 Jan-Feb forward validation: profitable at `801.00`

What it means:
- This line is structurally robust
- `ATRSL4` is highly stable
- Hold time is slower and more conservative than the later lines
- `ATRTP` is a broad plateau parameter

Main strength:
- Best cross-period stability among the fixed lines

Main weakness:
- It belongs to the older slower regime and is probably no longer the best default for current deployment

### 2. 2025 Fixed

Core result:
- Training winner: `H10 + ATRSL4 + ATRTP4/5/6/7`
- 2024 reverse validation: only `282.00`
- 2026 Jan-Feb forward validation: `662.00`

What it means:
- This line is the cleanest proof that the dominant structure changed from `H25/H30` to `H10`
- It is much faster and more efficient than the 2024 line in-sample
- It is not as robust backward into 2024 as the 2024 line is forward into 2025

Main strength:
- Clear regime-shift detector

Main weakness:
- Cross-regime robustness is weaker than `2024 fixed`

### 3. Rolling

Core result:
- Training winners: `H10` in `13/14` months, `ATRTP4` in `14/14` months
- Validation winners: profitable in `10/14` months
- Validation total over the completed 14-month target set: `3091.00`
- Validation average per month: `220.79`

What it means:
- The rolling line strongly confirms the `2025` fast structure
- It adapts mainly through `ATRSL` and secondarily through `TP3` vs `TP4`
- It keeps current market fit without reverting to the older slow family

Main strength:
- Best current adaptation line

Main weakness:
- Month-to-month validation dispersion is real; this is not a uniformly smooth line

## Stable Parameters Vs Regime-Sensitive Parameters

Stable across all three lines:
- RSI(14)
- OS30 / OB70
- `maxPositions = 1`
- `lotSize = 0.1`
- MA200 filter, multi-timeframe filter, ATR sizing, trailing stop, RSI reversion remain enabled

Relatively stable:
- `ATRSL` stays in a narrow band around `3.0` to `4.0`
- `ATRSL4` is the single most repeatable stop-loss setting across the completed work

Regime-sensitive:
- Hold time is the clearest regime variable
- `2024 fixed`: `H25/H30`
- `2025 fixed`: `H10`
- `rolling`: overwhelmingly `H10`

Weakly identified:
- `ATRTP`
- It behaves more like a response surface or local plateau than a sharply optimized parameter

## TP Plateau Behavior

### 2024 Fixed

Observed behavior:
- `ATRTP4/5/6` behave almost identically at the top

Interpretation:
- `TP` is not the key edge source in the slow regime

### 2025 Fixed

Observed behavior:
- `ATRTP4/5/6/7` are fully tied at the top

Interpretation:
- The fast regime makes `TP` even less informative as a single-point optimum

### Rolling

Observed behavior:
- Rolling training locks onto `ATRTP4`
- Rolling validation oscillates between `TP3` and `TP4`

Interpretation:
- The rolling line does not show a broad top-end `TP` plateau in the same way fixed windows do
- Instead, it shows a narrow operating band centered on `3` to `4`
- That is consistent with a system where current edge comes more from fast exits and stop placement than from stretching hard take-profit targets

## Which Baseline Should Be Preferred Now

Preferred production baseline:
- `rolling`

Reason:
- It is the most current line
- It agrees with the `2025 fixed` regime shift instead of contradicting it
- It remains profitable overall across the full completed monthly validation set
- Its latest completed month still points to `H10-ATRSL4-ATRTP4`

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

The completed workflow does not support reverting to the older slow `2024` structure as the default live baseline.

The stronger conclusion is:
- the market regime changed toward `H10`
- `ATRSL4` is the most stable shared anchor
- `TP` should not be overfit
- the rolling line is currently the best production reference

If one baseline must be selected now, use:
- `RSI-P14-OS30-OB70-MP1-LOT0.1-H10-ATRSL4-ATRTP4`

And keep these caveats attached:
- `2026` evidence currently means only `2026-01` and `2026-02`
- rolling validation still has losing months
- `2024 fixed` should remain available as a slow-regime fallback rather than being discarded
