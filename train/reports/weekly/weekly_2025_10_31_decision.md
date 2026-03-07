# Weekly Rolling Decision 2025-10-31

## Scope

- Cutoff date: `2025-10-31`
- 3m window: `2025-08-01` to `2025-10-31`
- 1m window: `2025-10-02` to `2025-10-31`
- Execution window: `2025-11-01` to `2025-11-07`
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
- Selected params: `H10 + ATRSL3.5 + ATRTP4`
- Reason: both 3m and 1m top candidates are non-positive after fees

## Training Comparison

- Current 3m net return: `-85.6%`
- Selected 3m net return: `-85.6%`
- Current 1m net return: `-36.1%`
- Selected 1m net return: `-36.1%`

## Validation

- Validation status: `skipped`
- Reason: decision is pause

