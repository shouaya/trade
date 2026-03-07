# Weekly Rolling Decision 2024-08-09

## Scope

- Cutoff date: `2024-08-09`
- 3m window: `2024-05-10` to `2024-08-09`
- 1m window: `2024-07-10` to `2024-08-09`
- Execution window: `2024-08-10` to `2024-08-16`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `fast`
- 1m dominant family: `slow`
- Shared ATRSL band: `3.5`
- Shared ATRTP band: `3, 4`
- Agreement level: `mild`

## Decision

- Action: `keep`
- Selected params: `H30 + ATRSL4 + ATRTP4`
- Reason: switch threshold not met; keeping current production parameters

## Training Comparison

- Current 3m net return: `-25.1%`
- Selected 3m net return: `-1.7%`
- Current 1m net return: `78.7%`
- Selected 1m net return: `69.8%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-9.9%`
- Execution-week commission / margin: `6%`
- Execution-week max drawdown / margin: `-30.3%`

