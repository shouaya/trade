# Weekly Rolling Decision 2024-04-12

## Scope

- Cutoff date: `2024-04-12`
- 3m window: `2024-01-13` to `2024-04-12`
- 1m window: `2024-03-13` to `2024-04-12`
- Execution window: `2024-04-13` to `2024-04-19`
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

- Current 3m net return: `119.9%`
- Selected 3m net return: `119.9%`
- Current 1m net return: `60.4%`
- Selected 1m net return: `60.4%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-21%`
- Execution-week commission / margin: `2.4%`
- Execution-week max drawdown / margin: `-29%`

