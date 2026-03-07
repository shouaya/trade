# Weekly Rolling Decision 2025-01-03

## Scope

- Cutoff date: `2025-01-03`
- 3m window: `2024-10-04` to `2025-01-03`
- 1m window: `2024-12-04` to `2025-01-03`
- Execution window: `2025-01-04` to `2025-01-10`
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

- Current 3m net return: `-94.4%`
- Selected 3m net return: `-94.4%`
- Current 1m net return: `64.7%`
- Selected 1m net return: `64.7%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-56.5%`
- Execution-week commission / margin: `8%`
- Execution-week max drawdown / margin: `-65.4%`

