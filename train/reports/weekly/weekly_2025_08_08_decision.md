# Weekly Rolling Decision 2025-08-08

## Scope

- Cutoff date: `2025-08-08`
- 3m window: `2025-05-09` to `2025-08-08`
- 1m window: `2025-07-09` to `2025-08-08`
- Execution window: `2025-08-09` to `2025-08-15`
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
- Selected params: `H25 + ATRSL3.5 + ATRTP4`
- Reason: switch threshold not met; keeping current production parameters

## Training Comparison

- Current 3m net return: `80.3%`
- Selected 3m net return: `87%`
- Current 1m net return: `11.5%`
- Selected 1m net return: `21.9%`

## Validation

- Validation status: `completed`
- Execution-week net return: `1.7%`
- Execution-week commission / margin: `2%`
- Execution-week max drawdown / margin: `-12.3%`

