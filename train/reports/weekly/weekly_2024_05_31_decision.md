# Weekly Rolling Decision 2024-05-31

## Scope

- Cutoff date: `2024-05-31`
- 3m window: `2024-03-03` to `2024-05-31`
- 1m window: `2024-05-02` to `2024-05-31`
- Execution window: `2024-06-01` to `2024-06-07`
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

- Action: `fallback`
- Selected params: `H30 + ATRSL4 + ATRTP4`
- Reason: both windows favor the slow family

## Training Comparison

- Current 3m net return: `114.5%`
- Selected 3m net return: `114.5%`
- Current 1m net return: `-13.5%`
- Selected 1m net return: `-13.5%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-14.8%`
- Execution-week commission / margin: `6.8%`
- Execution-week max drawdown / margin: `-41.1%`

