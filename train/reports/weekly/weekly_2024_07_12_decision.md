# Weekly Rolling Decision 2024-07-12

## Scope

- Cutoff date: `2024-07-12`
- 3m window: `2024-04-13` to `2024-07-12`
- 1m window: `2024-06-13` to `2024-07-12`
- Execution window: `2024-07-13` to `2024-07-19`
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

- Action: `keep`
- Selected params: `H30 + ATRSL4 + ATRTP4`
- Reason: switch threshold not met; keeping current production parameters

## Training Comparison

- Current 3m net return: `-10.9%`
- Selected 3m net return: `-9.5%`
- Current 1m net return: `-9%`
- Selected 1m net return: `-2%`

## Validation

- Validation status: `completed`
- Execution-week net return: `21.1%`
- Execution-week commission / margin: `2%`
- Execution-week max drawdown / margin: `-13.7%`

