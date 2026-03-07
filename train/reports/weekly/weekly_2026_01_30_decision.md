# Weekly Rolling Decision 2026-01-30

## Scope

- Cutoff date: `2026-01-30`
- 3m window: `2025-10-31` to `2026-01-30`
- 1m window: `2025-12-31` to `2026-01-30`
- Execution window: `2026-01-31` to `2026-02-06`
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
- Selected params: `H10 + ATRSL3.5 + ATRTP4`
- Reason: both 3m and 1m top candidates are non-positive after fees

## Training Comparison

- Current 3m net return: `-48%`
- Selected 3m net return: `-48%`
- Current 1m net return: `-27.6%`
- Selected 1m net return: `-27.6%`

## Validation

- Validation status: `skipped`
- Reason: decision is pause

