# Weekly Rolling Decision 2025-06-13

## Scope

- Cutoff date: `2025-06-13`
- 3m window: `2025-03-14` to `2025-06-13`
- 1m window: `2025-05-14` to `2025-06-13`
- Execution window: `2025-06-14` to `2025-06-20`
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
- Selected params: `H30 + ATRSL4 + ATRTP3`
- Reason: both windows favor the slow family

## Training Comparison

- Current 3m net return: `177.7%`
- Selected 3m net return: `217%`
- Current 1m net return: `-9.8%`
- Selected 1m net return: `-1.6%`

## Validation

- Validation status: `completed`
- Execution-week net return: `30%`
- Execution-week commission / margin: `3.6%`
- Execution-week max drawdown / margin: `-12.7%`

