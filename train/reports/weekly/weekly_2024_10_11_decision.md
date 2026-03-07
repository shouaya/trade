# Weekly Rolling Decision 2024-10-11

## Scope

- Cutoff date: `2024-10-11`
- 3m window: `2024-07-12` to `2024-10-11`
- 1m window: `2024-09-12` to `2024-10-11`
- Execution window: `2024-10-12` to `2024-10-18`
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

- Current 3m net return: `-118.9%`
- Selected 3m net return: `-76.4%`
- Current 1m net return: `-58%`
- Selected 1m net return: `9.2%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-56.1%`
- Execution-week commission / margin: `6.8%`
- Execution-week max drawdown / margin: `-71.8%`

