# Weekly Rolling Decision 2024-11-01

## Scope

- Cutoff date: `2024-11-01`
- 3m window: `2024-08-02` to `2024-11-01`
- 1m window: `2024-10-02` to `2024-11-01`
- Execution window: `2024-11-02` to `2024-11-08`
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

- Current 3m net return: `-151.6%`
- Selected 3m net return: `-151.6%`
- Current 1m net return: `-104%`
- Selected 1m net return: `-104%`

## Validation

- Validation status: `skipped`
- Reason: decision is pause

