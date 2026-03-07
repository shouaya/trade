# Weekly Rolling Decision 2025-07-11

## Scope

- Cutoff date: `2025-07-11`
- 3m window: `2025-04-12` to `2025-07-11`
- 1m window: `2025-06-12` to `2025-07-11`
- Execution window: `2025-07-12` to `2025-07-18`
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

- Current 3m net return: `174.5%`
- Selected 3m net return: `174.5%`
- Current 1m net return: `113.1%`
- Selected 1m net return: `113.1%`

## Validation

- Validation status: `completed`
- Execution-week net return: `17.4%`
- Execution-week commission / margin: `4.8%`
- Execution-week max drawdown / margin: `-27.1%`

