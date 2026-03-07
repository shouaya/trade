# Weekly Rolling Decision 2025-01-17

## Scope

- Cutoff date: `2025-01-17`
- 3m window: `2024-10-18` to `2025-01-17`
- 1m window: `2024-12-18` to `2025-01-17`
- Execution window: `2025-01-18` to `2025-01-24`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `slow`
- 1m dominant family: `fast`
- Shared ATRSL band: `3.5, 4`
- Shared ATRTP band: `3, 4`
- Agreement level: `mild`

## Decision

- Action: `pause`
- Selected params: `H10 + ATRSL4 + ATRTP4`
- Reason: both 3m and 1m top candidates are non-positive after fees

## Training Comparison

- Current 3m net return: `-111.2%`
- Selected 3m net return: `-111.2%`
- Current 1m net return: `-52.6%`
- Selected 1m net return: `-52.6%`

## Validation

- Validation status: `skipped`
- Reason: decision is pause

