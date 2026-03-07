# Weekly Rolling Decision 2024-07-05

## Scope

- Cutoff date: `2024-07-05`
- 3m window: `2024-04-06` to `2024-07-05`
- 1m window: `2024-06-06` to `2024-07-05`
- Execution window: `2024-07-06` to `2024-07-12`
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

- Current 3m net return: `17.7%`
- Selected 3m net return: `18.1%`
- Current 1m net return: `9.1%`
- Selected 1m net return: `13%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-4.4%`
- Execution-week commission / margin: `6.8%`
- Execution-week max drawdown / margin: `-25.8%`

