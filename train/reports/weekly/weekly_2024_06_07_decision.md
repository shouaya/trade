# Weekly Rolling Decision 2024-06-07

## Scope

- Cutoff date: `2024-06-07`
- 3m window: `2024-03-08` to `2024-06-07`
- 1m window: `2024-05-08` to `2024-06-07`
- Execution window: `2024-06-08` to `2024-06-14`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `fast`
- 1m dominant family: `fast`
- Shared ATRSL band: `4`
- Shared ATRTP band: `3, 4`
- Agreement level: `strong`

## Decision

- Action: `keep`
- Selected params: `H30 + ATRSL4 + ATRTP4`
- Reason: switch threshold not met; keeping current production parameters

## Training Comparison

- Current 3m net return: `43.7%`
- Selected 3m net return: `33.9%`
- Current 1m net return: `-62.7%`
- Selected 1m net return: `-44.2%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-17.1%`
- Execution-week commission / margin: `4.4%`
- Execution-week max drawdown / margin: `-26.8%`

