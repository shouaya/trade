# Weekly Rolling Decision 2025-06-20

## Scope

- Cutoff date: `2025-06-20`
- 3m window: `2025-03-21` to `2025-06-20`
- 1m window: `2025-05-21` to `2025-06-20`
- Execution window: `2025-06-21` to `2025-06-27`
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
- Selected params: `H25 + ATRSL4 + ATRTP3`
- Reason: both windows favor the slow family

## Training Comparison

- Current 3m net return: `230.6%`
- Selected 3m net return: `232%`
- Current 1m net return: `39.6%`
- Selected 1m net return: `46.1%`

## Validation

- Validation status: `completed`
- Execution-week net return: `33.1%`
- Execution-week commission / margin: `4.8%`
- Execution-week max drawdown / margin: `-13.9%`

