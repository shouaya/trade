# Weekly Rolling Decision 2024-07-19

## Scope

- Cutoff date: `2024-07-19`
- 3m window: `2024-04-20` to `2024-07-19`
- 1m window: `2024-06-20` to `2024-07-19`
- Execution window: `2024-07-20` to `2024-07-26`
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

- Action: `fallback`
- Selected params: `H30 + ATRSL4 + ATRTP4`
- Reason: both windows favor the slow family

## Training Comparison

- Current 3m net return: `31.2%`
- Selected 3m net return: `31.2%`
- Current 1m net return: `29.1%`
- Selected 1m net return: `29.1%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-89%`
- Execution-week commission / margin: `4.8%`
- Execution-week max drawdown / margin: `-98.8%`

