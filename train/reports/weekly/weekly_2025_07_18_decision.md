# Weekly Rolling Decision 2025-07-18

## Scope

- Cutoff date: `2025-07-18`
- 3m window: `2025-04-19` to `2025-07-18`
- 1m window: `2025-06-19` to `2025-07-18`
- Execution window: `2025-07-19` to `2025-07-25`
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
- Selected params: `H25 + ATRSL3.5 + ATRTP3`
- Reason: switch threshold not met; keeping current production parameters

## Training Comparison

- Current 3m net return: `138.2%`
- Selected 3m net return: `142.3%`
- Current 1m net return: `91.6%`
- Selected 1m net return: `108.6%`

## Validation

- Validation status: `completed`
- Execution-week net return: `5.7%`
- Execution-week commission / margin: `6%`
- Execution-week max drawdown / margin: `-27%`

