# ETHJPY Rolling Training And Validation Summary

## Scope

This report summarizes the completed monthly rolling workflow for `ETHJPY`.

- Instrument: `ETHJPY`
- Interval: `1min`
- Rolling execution months: `2025-01` to `2026-03`
- Training rule: use the previous `12` full months to train, select the monthly best strategy, then validate on the execution month
- Total completed rolling runs: `15`

Execution assumptions:
- `tradingSchedule = ALWAYS`
- `tradingTimeRestriction = null`
- commission model: `GMOCOIN`, `notional x 0.002%` on entry and exit
- ranking is based on corrected `score -> return_pct -> total_pnl`

Metric note:
- the current engine is already symbol-aware for `ETHJPY`
- `PnL` is calculated in quote currency `JPY`
- `return_pct` and `max_drawdown_pct` are normalized using the current `1,000,000 JPY` capital baseline

Data scope note:
- `2026-03` is month-to-date only
- the latest available rolling result in this report is based on data through `2026-03-18`

## Aggregate Result

Rolling validation summary:

- Positive months: `11/15`
- Negative months: `4/15`
- Total validation PnL: `5689.90`
- Average monthly validation return: `0.0379%`

High-level reading:
- rolling stayed positive in aggregate across the full executed history
- the path was not smooth, but it remained operationally useful
- the dominant parameter family changed over time instead of staying fixed

## Monthly Rolling Results

| Execution Month | Train Window | Validation Window | Selected Strategy | Validation PnL | Return % |
| --- | --- | --- | --- | ---: | ---: |
| `2025-01` | `2024-01-01` to `2024-12-31` | `2025-01-01` to `2025-01-31` | `H10-ATRSL3.5-ATRTP4` | 1012.41 | 0.1012% |
| `2025-02` | `2024-02-01` to `2025-01-31` | `2025-02-01` to `2025-02-28` | `H15-ATRSL4-ATRTP4` | 2973.55 | 0.2974% |
| `2025-03` | `2024-03-01` to `2025-02-28` | `2025-03-01` to `2025-03-31` | `H15-ATRSL4-ATRTP4` | 1884.91 | 0.1885% |
| `2025-04` | `2024-04-01` to `2025-03-31` | `2025-04-01` to `2025-04-30` | `H15-ATRSL3.5-ATRTP4` | -682.94 | -0.0683% |
| `2025-05` | `2024-05-01` to `2025-04-30` | `2025-05-01` to `2025-05-31` | `H15-ATRSL4-ATRTP4` | -1935.79 | -0.1936% |
| `2025-06` | `2024-06-01` to `2025-05-31` | `2025-06-01` to `2025-06-30` | `H15-ATRSL3.5-ATRTP3` | 1208.38 | 0.1208% |
| `2025-07` | `2024-07-01` to `2025-06-30` | `2025-07-01` to `2025-07-31` | `H15-ATRSL4-ATRTP3` | 140.48 | 0.0140% |
| `2025-08` | `2024-08-01` to `2025-07-31` | `2025-08-01` to `2025-08-31` | `H15-ATRSL4-ATRTP3` | 1311.89 | 0.1312% |
| `2025-09` | `2024-09-01` to `2025-08-31` | `2025-09-01` to `2025-09-30` | `H15-ATRSL3.5-ATRTP3` | 918.10 | 0.0918% |
| `2025-10` | `2024-10-01` to `2025-09-30` | `2025-10-01` to `2025-10-31` | `H15-ATRSL3.5-ATRTP3` | 1128.81 | 0.1129% |
| `2025-11` | `2024-11-01` to `2025-10-31` | `2025-11-01` to `2025-11-30` | `H15-ATRSL3.5-ATRTP4` | -2735.26 | -0.2735% |
| `2025-12` | `2024-12-01` to `2025-11-30` | `2025-12-01` to `2025-12-31` | `H15-ATRSL4-ATRTP4` | 371.19 | 0.0371% |
| `2026-01` | `2025-01-01` to `2025-12-31` | `2026-01-01` to `2026-01-31` | `H15-ATRSL3-ATRTP4` | -831.55 | -0.0832% |
| `2026-02` | `2025-02-01` to `2026-01-31` | `2026-02-01` to `2026-02-28` | `H5-ATRSL4-ATRTP4` | 747.54 | 0.0748% |
| `2026-03` | `2025-03-01` to `2026-02-28` | `2026-03-01` to `2026-03-18` | `H5-ATRSL4-ATRTP4` | 178.18 | 0.0178% |

## Parameter Evolution

### Hold Time

- `2025-01` started with `H10`
- most of `2025-02` to `2026-01` was dominated by `H15`
- `2026-02` and `2026-03` shifted to `H5`

Interpretation:
- the rolling process did not converge to one permanent hold-time setting
- the dominant regime in most of `2025` was `H15`
- the latest available months show a further acceleration into `H5`

### Stop Loss / Take Profit

- `ATRSL` mostly stayed in the `3.5` to `4.0` band
- only one month, `2026-01`, moved to `ATRSL3`
- `ATRTP` stayed inside a narrow `3` to `4` band

Interpretation:
- the main structural movement came from hold time, not from drastic stop/target rewrites
- `ATRSL3.5/4` and `ATRTP3/4` remain the practical operating range

## Best And Weakest Months

Best validation months:

- `2025-02`: `+2973.55`, `0.2974%`
- `2025-03`: `+1884.91`, `0.1885%`
- `2025-08`: `+1311.89`, `0.1312%`

Weakest validation months:

- `2025-11`: `-2735.26`, `-0.2735%`
- `2025-05`: `-1935.79`, `-0.1936%`
- `2026-01`: `-831.55`, `-0.0832%`

Interpretation:
- rolling was clearly beneficial overall, but there were still meaningful regime breaks
- the weak months were concentrated around late `2025` and early `2026`
- even after those drawdowns, the full rolling line remained positive in aggregate

## Relationship To Fixed-Year Winners

What rolling agrees with:

- it does not support using the `2025` fixed winner unchanged forever
- it also does not fully revert to the `2024` fixed baseline
- instead, it keeps adapting around the same RSI core while moving hold-time and ATR settings

What rolling adds:

- it shows that `H15` was the dominant live regime through most of `2025`
- it shows that the market state shifted again by `2026-02`, where `H5` became the selected winner
- this is exactly the kind of movement that single fixed-year strategies cannot capture

## Conclusion

The ETHJPY rolling workflow is now fully established and the results are usable.

Main conclusions:

- rolling delivered positive aggregate validation from `2025-01` through `2026-03-18`
- the dominant 2025 regime was `H15`, not the `2024` fixed `H10` baseline
- the latest available months moved again toward `H5`
- `ATRSL3.5/4` and `ATRTP3/4` remained the stable operating band

Practical reading:

- if the goal is cross-period robustness with one static baseline, `2024 fixed` is still the cleaner reference
- if the goal is live adaptation, rolling is the better framework
- current rolling evidence supports keeping the adaptive framework rather than locking ETHJPY to a single fixed annual winner
