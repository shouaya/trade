# Weekly Rolling Decision 2025-01-24

## Scope

- Cutoff date: `2025-01-24`
- 3m window: `2024-10-25` to `2025-01-24`
- 1m window: `2024-12-25` to `2025-01-24`
- Execution window: `2025-01-25` to `2025-01-31`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `fast`
- 1m dominant family: `fast`
- Shared ATRSL band: `3.5, 4`
- Shared ATRTP band: `3, 4`
- Agreement level: `strong`

## Decision

- Action: `pause`
- Selected params: `H10 + ATRSL4 + ATRTP4`
- Reason: both 3m and 1m top candidates are non-positive after fees

## Training Comparison

- Current 3m net return: `-108.1%`
- Selected 3m net return: `-108.1%`
- Current 1m net return: `-35.8%`
- Selected 1m net return: `-35.8%`

## Validation

- Validation status: `skipped`
- Reason: decision is pause

