# Weekly Rolling Decision 2024-06-28

## Scope

- Cutoff date: `2024-06-28`
- 3m window: `2024-03-29` to `2024-06-28`
- 1m window: `2024-05-29` to `2024-06-28`
- Execution window: `2024-06-29` to `2024-07-05`
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

- Current 3m net return: `12.7%`
- Selected 3m net return: `12.2%`
- Current 1m net return: `-64.3%`
- Selected 1m net return: `-59.8%`

## Validation

- Validation status: `completed`
- Execution-week net return: `3.2%`
- Execution-week commission / margin: `9.2%`
- Execution-week max drawdown / margin: `-22%`

