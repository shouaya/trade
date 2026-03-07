# Weekly Rolling Decision 2024-11-29

## Scope

- Cutoff date: `2024-11-29`
- 3m window: `2024-08-30` to `2024-11-29`
- 1m window: `2024-10-30` to `2024-11-29`
- Execution window: `2024-11-30` to `2024-12-06`
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

- Current 3m net return: `-344.9%`
- Selected 3m net return: `-344.9%`
- Current 1m net return: `-168.9%`
- Selected 1m net return: `-168.9%`

## Validation

- Validation status: `skipped`
- Reason: decision is pause

