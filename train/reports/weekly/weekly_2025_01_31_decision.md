# Weekly Rolling Decision 2025-01-31

## Scope

- Cutoff date: `2025-01-31`
- 3m window: `2024-11-01` to `2025-01-31`
- 1m window: `2025-01-01` to `2025-01-31`
- Execution window: `2025-02-01` to `2025-02-07`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `slow`
- 1m dominant family: `slow`
- Shared ATRSL band: `3.5, 4`
- Shared ATRTP band: `3, 4`
- Agreement level: `strong`

## Decision

- Action: `pause`
- Selected params: `H10 + ATRSL4 + ATRTP4`
- Reason: both 3m and 1m top candidates are non-positive after fees

## Training Comparison

- Current 3m net return: `-105%`
- Selected 3m net return: `-105%`
- Current 1m net return: `-47.5%`
- Selected 1m net return: `-47.5%`

## Validation

- Validation status: `skipped`
- Reason: decision is pause

