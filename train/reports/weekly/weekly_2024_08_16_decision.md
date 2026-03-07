# Weekly Rolling Decision 2024-08-16

## Scope

- Cutoff date: `2024-08-16`
- 3m window: `2024-05-17` to `2024-08-16`
- 1m window: `2024-07-17` to `2024-08-16`
- Execution window: `2024-08-17` to `2024-08-23`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `slow`
- 1m dominant family: `slow`
- Shared ATRSL band: `3.5`
- Shared ATRTP band: `3, 4`
- Agreement level: `strong`

## Decision

- Action: `fallback`
- Selected params: `H30 + ATRSL3.5 + ATRTP4`
- Reason: both windows favor the slow family

## Training Comparison

- Current 3m net return: `8.5%`
- Selected 3m net return: `9.2%`
- Current 1m net return: `40.1%`
- Selected 1m net return: `55%`

## Validation

- Validation status: `completed`
- Execution-week net return: `11.2%`
- Execution-week commission / margin: `4.8%`
- Execution-week max drawdown / margin: `-55.3%`

