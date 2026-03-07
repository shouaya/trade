# Weekly Rolling Decision 2024-09-20

## Scope

- Cutoff date: `2024-09-20`
- 3m window: `2024-06-21` to `2024-09-20`
- 1m window: `2024-08-21` to `2024-09-20`
- Execution window: `2024-09-21` to `2024-09-27`
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
- Selected params: `H30 + ATRSL3.5 + ATRTP4`
- Reason: both 3m and 1m top candidates are non-positive after fees

## Training Comparison

- Current 3m net return: `-65.6%`
- Selected 3m net return: `-65.6%`
- Current 1m net return: `-187.6%`
- Selected 1m net return: `-187.6%`

## Validation

- Validation status: `skipped`
- Reason: decision is pause

