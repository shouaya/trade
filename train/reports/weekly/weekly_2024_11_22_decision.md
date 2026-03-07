# Weekly Rolling Decision 2024-11-22

## Scope

- Cutoff date: `2024-11-22`
- 3m window: `2024-08-23` to `2024-11-22`
- 1m window: `2024-10-23` to `2024-11-22`
- Execution window: `2024-11-23` to `2024-11-29`
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
- Selected params: `H30 + ATRSL3.5 + ATRTP4`
- Reason: both 3m and 1m top candidates are non-positive after fees

## Training Comparison

- Current 3m net return: `-340%`
- Selected 3m net return: `-340%`
- Current 1m net return: `-95.8%`
- Selected 1m net return: `-95.8%`

## Validation

- Validation status: `skipped`
- Reason: decision is pause

