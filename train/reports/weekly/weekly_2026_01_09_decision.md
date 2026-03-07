# Weekly Rolling Decision 2026-01-09

## Scope

- Cutoff date: `2026-01-09`
- 3m window: `2025-10-10` to `2026-01-09`
- 1m window: `2025-12-10` to `2026-01-09`
- Execution window: `2026-01-10` to `2026-01-16`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `fast`
- 1m dominant family: `slow`
- Shared ATRSL band: `3.5, 4`
- Shared ATRTP band: `3, 4`
- Agreement level: `mild`

## Decision

- Action: `pause`
- Selected params: `H10 + ATRSL3.5 + ATRTP4`
- Reason: both 3m and 1m top candidates are non-positive after fees

## Training Comparison

- Current 3m net return: `-112.4%`
- Selected 3m net return: `-112.4%`
- Current 1m net return: `-68%`
- Selected 1m net return: `-68%`

## Validation

- Validation status: `skipped`
- Reason: decision is pause

