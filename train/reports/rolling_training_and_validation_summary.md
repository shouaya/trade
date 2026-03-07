# Rolling Training And Validation Summary

## Scope

This report summarizes the completed rolling workflow from `2025-01` through `2026-02` under the latest bid/ask execution model.

- Rolling training months: `2025-01` to `2026-02`
- Rolling validation target months: `2025-01` to `2026-02`
- Total completed runs: `14` training tables + `14` validation tables

Execution note:
- FX import used `priceType=BOTH`
- Storage and execution remained bid/ask-aware
- Current `2026` data only covers `2026-01-01` to `2026-02-27 20:59:00 UTC`
- Any statement about `2026` in this report applies only to `2026-01` and `2026-02`

## Rolling Training Winners

Monthly training winners:

| Month | Winner | Trades | Win Rate | Total PnL | Sharpe | Max DD | Score |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `2025-01` | `H25-ATRSL4-ATRTP4` | 674 | 63.65% | 639.00 | 0.0210 | -1551.00 | 7.7518 |
| `2025-02` | `H10-ATRSL2-ATRTP4` | 762 | 49.08% | 394.50 | 0.0149 | -1114.50 | 2.6230 |
| `2025-03` | `H10-ATRSL4-ATRTP4` | 704 | 51.42% | 457.50 | 0.0170 | -1155.50 | 3.6278 |
| `2025-04` | `H10-ATRSL4-ATRTP4` | 699 | 50.50% | 564.50 | 0.0203 | -1155.50 | 5.2516 |
| `2025-05` | `H10-ATRSL4-ATRTP4` | 725 | 50.76% | 911.00 | 0.0304 | -1155.50 | 12.7859 |
| `2025-06` | `H10-ATRSL3.5-ATRTP4` | 703 | 51.78% | 982.00 | 0.0329 | -1180.50 | 15.2191 |
| `2025-07` | `H10-ATRSL3.5-ATRTP4` | 693 | 52.38% | 1414.50 | 0.0477 | -1180.50 | 32.1298 |
| `2025-08` | `H10-ATRSL3-ATRTP4` | 687 | 52.98% | 2217.00 | 0.0770 | -1172.50 | 82.1932 |
| `2025-09` | `H10-ATRSL3-ATRTP4` | 676 | 52.66% | 1697.00 | 0.0642 | -835.00 | 52.1781 |
| `2025-10` | `H10-ATRSL4-ATRTP4` | 661 | 53.71% | 2252.50 | 0.0924 | -679.50 | 101.6229 |
| `2025-11` | `H10-ATRSL4-ATRTP4` | 659 | 54.02% | 2085.00 | 0.0856 | -679.50 | 87.6375 |
| `2025-12` | `H10-ATRSL4-ATRTP4` | 659 | 55.39% | 2835.50 | 0.1207 | -315.50 | 172.3465 |
| `2026-01` | `H10-ATRSL4-ATRTP4` | 660 | 54.09% | 2294.50 | 0.0995 | -315.50 | 112.2904 |
| `2026-02` | `H10-ATRSL4-ATRTP4` | 655 | 53.13% | 2421.00 | 0.1074 | -389.00 | 125.5537 |

Training summary:
- Total rolling training winner PnL across all months: `21165.50`
- Average monthly training winner PnL: `1511.82`
- Best training month: `2025-12` with `2835.50`
- Weakest training month: `2025-02` with `394.50`

Training family stability:
- `H10` won `13/14` months
- `ATRTP4` won `14/14` months
- `ATRSL4` won `9/14` months
- `ATRSL3.5` won `2/14` months
- `ATRSL3` won `2/14` months
- `ATRSL2` won `1/14` months

Interpretation:
- The rolling training line converges very quickly to the fast `H10` family
- `ATRTP4` is the most stable training parameter in the whole rolling set
- The main rolling adaptation is in `ATRSL`, but it stays within a narrow `2.0` to `4.0` envelope and is mostly concentrated in `3.0` to `4.0`
- `2025-01` is the only month that still resembles the slower `2024` style

## Rolling Validation Winners

Monthly validation winners:

| Month | Winner | Trades | Win Rate | Total PnL | Sharpe | Max DD | Score |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `2025-01` | `H30-ATRSL4-ATRTP3` | 63 | 60.32% | -97.50 | -0.0360 | -395.50 | -0.5346 |
| `2025-02` | `H10-ATRSL4-ATRTP3` | 46 | 50.00% | 169.00 | 0.1304 | -148.00 | 10.0170 |
| `2025-03` | `H10-ATRSL2-ATRTP3` | 56 | 53.57% | 435.50 | 0.1842 | -167.50 | 39.0753 |
| `2025-04` | `H10-ATRSL3.5-ATRTP3` | 62 | 59.68% | 816.50 | 0.2622 | -129.00 | 116.1405 |
| `2025-05` | `H10-ATRSL3.5-ATRTP3` | 40 | 55.00% | 30.50 | 0.0190 | -236.00 | 0.2903 |
| `2025-06` | `H10-ATRSL3.5-ATRTP3` | 49 | 63.27% | 362.50 | 0.2387 | -107.50 | 49.7604 |
| `2025-07` | `H10-ATRSL3-ATRTP4` | 62 | 54.84% | 518.50 | 0.2661 | -160.00 | 68.7949 |
| `2025-08` | `H10-ATRSL3-ATRTP3` | 44 | 45.45% | -152.00 | -0.1144 | -332.00 | -0.6281 |
| `2025-09` | `H10-ATRSL4-ATRTP4` | 54 | 55.56% | 214.50 | 0.1392 | -188.00 | 15.0802 |
| `2025-10` | `H10-ATRSL4-ATRTP4` | 58 | 55.17% | -36.50 | -0.0208 | -232.50 | -0.1831 |
| `2025-11` | `H10-ATRSL3-ATRTP4` | 58 | 55.17% | 266.50 | 0.1735 | -151.50 | 23.1889 |
| `2025-12` | `H10-ATRSL4-ATRTP3` | 66 | 43.94% | -98.50 | -0.0617 | -255.50 | -0.3935 |
| `2026-01` | `H10-ATRSL4-ATRTP4` | 66 | 46.97% | 31.00 | 0.0178 | -224.50 | 0.2359 |
| `2026-02` | `H10-ATRSL4-ATRTP4` | 58 | 58.62% | 631.00 | 0.1698 | -133.00 | 57.1122 |

Validation summary:
- Total rolling validation winner PnL across all months: `3091.00`
- Average monthly validation winner PnL: `220.79`
- Positive months: `10/14`
- Negative months: `4/14`
- Best validation month: `2025-04` with `816.50`
- Worst validation month: `2025-08` with `-152.00`

Validation family stability:
- `H10` won `13/14` months
- `TP3` won `8/14` months
- `TP4` won `6/14` months
- `ATRSL4` won `7/14` months
- `ATRSL3.5` won `3/14` months
- `ATRSL3` won `2/14` months
- `ATRSL2` won `1/14` months

Interpretation:
- Forward validation remains mostly profitable, but month-to-month dispersion is real
- The structural stability is in `H10`, not in a single globally fixed stop/target pair
- Validation winners oscillate between `ATRSL 3.0` to `4.0` and between `TP3` and `TP4`
- That is a narrower and more credible adaptation band than a full regime break

## What The Rolling Line Says

Main signal:
- The market shifted away from the slower `H25/H30` 2024 structure very quickly
- The rolling line overwhelmingly prefers the fast `H10` structure

Stable parameters:
- RSI(14), OS30 / OB70
- `maxPositions = 1`
- `lotSize = 0.1`
- `H10` as the dominant hold time

Adaptive parameters:
- `ATRSL` is the main rolling adjustment lever
- `TP` shifts between `3` and `4` in validation, but training stays locked on `4`

Important nuance:
- Rolling training has a very clean and stable top family
- Rolling validation is profitable overall, but it is not monotonic
- This is a usable adaptation signal, not a claim that every month is easy or uniformly strong

## Conclusion

The rolling workflow confirms that the current preferred regime is the fast `H10` family rather than the slower `2024` family.

Current practical conclusion:
- Rolling training strongly converges to `H10 + ATRTP4`
- Rolling validation is positive overall with `10/14` profitable months
- The most stable production-friendly rolling core is `H10`
- The most adaptive rolling parameter is `ATRSL`
- The current `2026` evidence is limited to `2026-01` and `2026-02`, not full-year `2026`

Recommended rolling baseline:
- Structural baseline: `H10`
- Current stop-loss band: `ATRSL 3.5` to `4.0`
- Current target band: `ATRTP 3` to `4`
- Latest available month still supports `H10-ATRSL4-ATRTP4`
