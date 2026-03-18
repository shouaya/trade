# Rolling Training And Validation Summary

## Scope

This report summarizes the completed fee-aware rolling workflow from `2025-01` through `2026-02`.

- Rolling training months: `2025-01` to `2026-02`
- Rolling validation target months: `2025-01` to `2026-02`
- Total completed runs: `14` training tables + `14` validation tables

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
- Current `2026` data only covers `2026-01-01` to `2026-02-27 20:59:00 UTC`
- Any statement about `2026` in this report applies only to `2026-01` and `2026-02`

## Rolling Training Winners

Monthly training winners:

| Month | Winner | Trades | Win Rate | Gross Return | Commission / Margin | Net Return |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `2025-01` | `H25-ATRSL4-ATRTP4` | 674 | 61.57% | 127.8% | 269.6% | -141.8% |
| `2025-02` | `H25-ATRSL4-ATRTP4` | 671 | 60.95% | 57.8% | 268.4% | -210.6% |
| `2025-03` | `H10-ATRSL4-ATRTP4` | 704 | 48.58% | 91.5% | 281.6% | -190.1% |
| `2025-04` | `H10-ATRSL4-ATRTP4` | 699 | 48.35% | 112.9% | 279.6% | -166.7% |
| `2025-05` | `H10-ATRSL4-ATRTP4` | 725 | 48.69% | 182.2% | 290.0% | -107.8% |
| `2025-06` | `H10-ATRSL4-ATRTP4` | 699 | 49.36% | 196.1% | 279.6% | -83.5% |
| `2025-07` | `H10-ATRSL3.5-ATRTP4` | 696 | 50.14% | 297.7% | 278.4% | 19.3% |
| `2025-08` | `H10-ATRSL3-ATRTP4` | 690 | 50.87% | 458.2% | 276.0% | 182.2% |
| `2025-09` | `H10-ATRSL4-ATRTP4` | 671 | 50.37% | 352.0% | 268.4% | 83.6% |
| `2025-10` | `H10-ATRSL4-ATRTP4` | 664 | 51.36% | 465.3% | 265.6% | 199.7% |
| `2025-11` | `H10-ATRSL4-ATRTP4` | 662 | 51.81% | 431.8% | 264.8% | 167.0% |
| `2025-12` | `H10-ATRSL4-ATRTP4` | 662 | 53.02% | 581.9% | 264.8% | 317.1% |
| `2026-01` | `H10-ATRSL4-ATRTP4` | 663 | 51.73% | 473.7% | 265.2% | 208.5% |
| `2026-02` | `H10-ATRSL4-ATRTP4` | 658 | 50.76% | 499.0% | 263.2% | 235.8% |

Training summary:
- Total rolling training winner net return across all months: `512.7%`
- Average monthly training winner net return: `36.6%`
- Positive months: `8/14`
- Negative months: `6/14`
- Best training month: `2025-12` with `317.1%`
- Weakest training month: `2025-02` with `-210.6%`

Training family stability:
- `H10` won `12/14` months
- `H25` won `2/14` months
- `ATRTP4` won `14/14` months
- `ATRSL4` won `12/14` months
- `ATRSL3.5` won `1/14` month
- `ATRSL3` won `1/14` month

Interpretation:
- Fees materially change the rolling training picture
- The structural winner still converges to `H10`, but the early 2025 training months do not clear commissions
- Net rolling training only becomes consistently positive from `2025-07` onward
- `ATRTP4` remains completely stable, while `ATRSL` only briefly widens to `3.5` or `3.0`

## Rolling Validation Winners

Monthly validation winners:

| Month | Winner | Trades | Win Rate | Gross Return | Commission / Margin | Net Return |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `2025-01` | `H30-ATRSL4-ATRTP3` | 63 | 58.73% | -19.5% | 25.2% | -44.7% |
| `2025-02` | `H10-ATRSL4-ATRTP3` | 46 | 45.65% | 33.8% | 18.4% | 15.4% |
| `2025-03` | `H10-ATRSL3.5-ATRTP3` | 50 | 52.00% | 86.9% | 20.0% | 66.9% |
| `2025-04` | `H10-ATRSL3.5-ATRTP3` | 62 | 59.68% | 163.3% | 24.8% | 138.5% |
| `2025-05` | `H10-ATRSL3.5-ATRTP3` | 40 | 47.50% | 6.1% | 16.0% | -9.9% |
| `2025-06` | `H10-ATRSL3.5-ATRTP3` | 52 | 59.62% | 87.3% | 20.8% | 66.5% |
| `2025-07` | `H10-ATRSL3-ATRTP4` | 62 | 54.84% | 103.7% | 24.8% | 78.9% |
| `2025-08` | `H10-ATRSL3-ATRTP3` | 44 | 43.18% | -30.4% | 17.6% | -48.0% |
| `2025-09` | `H10-ATRSL4-ATRTP4` | 54 | 53.70% | 42.9% | 21.6% | 21.3% |
| `2025-10` | `H10-ATRSL4-ATRTP4` | 58 | 53.45% | -7.3% | 23.2% | -30.5% |
| `2025-11` | `H10-ATRSL3-ATRTP4` | 58 | 51.72% | 53.3% | 23.2% | 30.1% |
| `2025-12` | `H10-ATRSL4-ATRTP3` | 66 | 42.42% | -19.7% | 26.4% | -46.1% |
| `2026-01` | `H10-ATRSL4-ATRTP4` | 66 | 43.94% | 6.2% | 26.4% | -20.2% |
| `2026-02` | `H10-ATRSL4-ATRTP4` | 58 | 53.45% | 126.2% | 23.2% | 103.0% |

Validation summary:
- Total rolling validation winner net return across all months: `321.2%`
- Average monthly validation winner net return: `22.9%`
- Positive months: `8/14`
- Negative months: `6/14`
- Best validation month: `2025-04` with `138.5%`
- Worst validation month: `2025-08` with `-48.0%`

Validation family stability:
- `H10` won `13/14` months
- `H30` won `1/14` month
- `TP3` won `8/14` months
- `TP4` won `6/14` months
- `ATRSL4` won `7/14` months
- `ATRSL3.5` won `4/14` months
- `ATRSL3` won `3/14` months

Interpretation:
- Rolling validation remains net positive overall, but much less smooth after fees
- The structural stability is still in `H10`, not in a single globally fixed stop/target pair
- Validation winners oscillate inside a narrow band:
- `ATRSL 3.0` to `4.0`
- `TP3` to `TP4`
- This is still a usable adaptation signal, but it is weaker than the no-fee version

## What The Rolling Line Says

Main signal:
- The market still shifts away from the slower `H25/H30` structure toward `H10`
- That structural conclusion survives fees

Important fee-aware nuance:
- Early rolling training months are net negative even at the winner level
- Rolling validation is positive overall, but only `8/14` months are positive
- This means rolling still adapts best, but the edge margin is thinner and more regime-dependent than the no-fee report suggested

Stable parameters:
- RSI(14), OS30 / OB70
- `maxPositions = 1`
- `lotSize = 0.1`
- `H10` as the dominant hold time

Adaptive parameters:
- `ATRSL` is the main rolling adjustment lever
- `TP` shifts between `3` and `4` in validation

## Conclusion

The fee-aware rolling workflow still points to the fast `H10` family, but with a stricter operational reading.

Current practical conclusion:
- Rolling still confirms the fast `H10` regime
- The most stable rolling core is `H10 + ATRTP4`
- The main adaptive lever remains `ATRSL`
- The latest available month still supports `H10-ATRSL4-ATRTP4`
- But rolling should no longer be described as broadly strong across nearly every month; fee drag makes the dispersion materially larger

Recommended rolling baseline:
- Structural baseline: `H10`
- Current stop-loss band: `ATRSL 3.5` to `4.0`
- Current target band: `ATRTP 3` to `4`
- Latest available month still supports `H10-ATRSL4-ATRTP4`
