# Weekly Rolling Decision 2024-04-05

## Scope

- Cutoff date: `2024-04-05`
- 3m window: `2024-01-06` to `2024-04-05`
- 1m window: `2024-03-06` to `2024-04-05`
- Execution window: `2024-04-06` to `2024-04-12`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `slow`
- 1m dominant family: `slow`
- Shared ATRSL band: `4`
- Shared ATRTP band: `3, 4`
- Agreement level: `strong`

## Decision

- Action: `fallback`
- Selected params: `H30 + ATRSL4 + ATRTP3`
- Reason: both windows favor the slow family

## Training Comparison

- Current 3m net return: `40%`
- Selected 3m net return: `137.3%`
- Current 1m net return: `24.4%`
- Selected 1m net return: `38.9%`

## Validation

- Validation status: `completed`
- Execution-week net return: `24.2%`
- Execution-week commission / margin: `4%`
- Execution-week max drawdown / margin: `-5%`

