# Weekly Rolling Decision 2025-04-11

## Scope

- Cutoff date: `2025-04-11`
- 3m window: `2025-01-12` to `2025-04-11`
- 1m window: `2025-03-12` to `2025-04-11`
- Execution window: `2025-04-12` to `2025-04-18`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `fast`
- 1m dominant family: `slow`
- Shared ATRSL band: `3.5, 4`
- Shared ATRTP band: `3, 4`
- Agreement level: `mild`

## Decision

- Action: `keep`
- Selected params: `H10 + ATRSL4 + ATRTP4`
- Reason: current parameters are already inside the weekly consensus zone

## Training Comparison

- Current 3m net return: `172.6%`
- Selected 3m net return: `172.6%`
- Current 1m net return: `100.7%`
- Selected 1m net return: `100.7%`

## Validation

- Validation status: `completed`
- Execution-week net return: `37.7%`
- Execution-week commission / margin: `4.8%`
- Execution-week max drawdown / margin: `-12%`

