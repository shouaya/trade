# Weekly Rolling Decision 2024-09-27

## Scope

- Cutoff date: `2024-09-27`
- 3m window: `2024-06-28` to `2024-09-27`
- 1m window: `2024-08-28` to `2024-09-27`
- Execution window: `2024-09-28` to `2024-10-04`
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
- Selected params: `H30 + ATRSL3.5 + ATRTP4`
- Reason: both 3m and 1m top candidates are non-positive after fees

## Training Comparison

- Current 3m net return: `-71.2%`
- Selected 3m net return: `-71.2%`
- Current 1m net return: `-160.4%`
- Selected 1m net return: `-160.4%`

## Validation

- Validation status: `skipped`
- Reason: decision is pause

