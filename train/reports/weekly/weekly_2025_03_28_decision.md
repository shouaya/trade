# Weekly Rolling Decision 2025-03-28

## Scope

- Cutoff date: `2025-03-28`
- 3m window: `2024-12-29` to `2025-03-28`
- 1m window: `2025-03-01` to `2025-03-28`
- Execution window: `2025-03-29` to `2025-04-04`
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
- Selected params: `H10 + ATRSL4 + ATRTP4`
- Reason: switch threshold not met; keeping current production parameters

## Training Comparison

- Current 3m net return: `16%`
- Selected 3m net return: `7.2%`
- Current 1m net return: `27.8%`
- Selected 1m net return: `32.3%`

## Validation

- Validation status: `completed`
- Execution-week net return: `17.3%`
- Execution-week commission / margin: `7.6%`
- Execution-week max drawdown / margin: `-22%`

