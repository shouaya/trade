# Weekly Rolling Decision 2024-10-25

## Scope

- Cutoff date: `2024-10-25`
- 3m window: `2024-07-26` to `2024-10-25`
- 1m window: `2024-09-26` to `2024-10-25`
- Execution window: `2024-10-26` to `2024-11-01`
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
- Selected params: `H30 + ATRSL3.5 + ATRTP4`
- Reason: switch threshold not met; keeping current production parameters

## Training Comparison

- Current 3m net return: `-97.9%`
- Selected 3m net return: `-41.9%`
- Current 1m net return: `-92.8%`
- Selected 1m net return: `7.1%`

## Validation

- Validation status: `completed`
- Execution-week net return: `10.4%`
- Execution-week commission / margin: `5.6%`
- Execution-week max drawdown / margin: `-35.3%`

