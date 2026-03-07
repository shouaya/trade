# Weekly Rolling Decision 2025-07-04

## Scope

- Cutoff date: `2025-07-04`
- 3m window: `2025-04-05` to `2025-07-04`
- 1m window: `2025-06-05` to `2025-07-04`
- Execution window: `2025-07-05` to `2025-07-11`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `slow`
- 1m dominant family: `slow`
- Shared ATRSL band: `3.5, 4`
- Shared ATRTP band: `3, 4`
- Agreement level: `strong`

## Decision

- Action: `fallback`
- Selected params: `H25 + ATRSL3.5 + ATRTP3`
- Reason: both windows favor the slow family

## Training Comparison

- Current 3m net return: `217%`
- Selected 3m net return: `228.2%`
- Current 1m net return: `110.1%`
- Selected 1m net return: `113.1%`

## Validation

- Validation status: `completed`
- Execution-week net return: `11.7%`
- Execution-week commission / margin: `5.2%`
- Execution-week max drawdown / margin: `-14.8%`

