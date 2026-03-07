# Weekly Rolling Decision 2024-06-21

## Scope

- Cutoff date: `2024-06-21`
- 3m window: `2024-03-22` to `2024-06-21`
- 1m window: `2024-05-22` to `2024-06-21`
- Execution window: `2024-06-22` to `2024-06-28`
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

- Current 3m net return: `29.5%`
- Selected 3m net return: `23.2%`
- Current 1m net return: `-54.2%`
- Selected 1m net return: `-47.3%`

## Validation

- Validation status: `completed`
- Execution-week net return: `13%`
- Execution-week commission / margin: `4%`
- Execution-week max drawdown / margin: `-3.2%`

