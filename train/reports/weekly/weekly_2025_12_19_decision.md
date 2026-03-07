# Weekly Rolling Decision 2025-12-19

## Scope

- Cutoff date: `2025-12-19`
- 3m window: `2025-09-20` to `2025-12-19`
- 1m window: `2025-11-20` to `2025-12-19`
- Execution window: `2025-12-20` to `2025-12-26`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `slow`
- 1m dominant family: `slow`
- Shared ATRSL band: `4`
- Shared ATRTP band: `3, 4`
- Agreement level: `strong`

## Decision

- Action: `pause`
- Selected params: `H10 + ATRSL3.5 + ATRTP4`
- Reason: both 3m and 1m top candidates are non-positive after fees

## Training Comparison

- Current 3m net return: `-25.5%`
- Selected 3m net return: `-25.5%`
- Current 1m net return: `-55.3%`
- Selected 1m net return: `-55.3%`

## Validation

- Validation status: `skipped`
- Reason: decision is pause

