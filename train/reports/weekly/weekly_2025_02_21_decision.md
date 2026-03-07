# Weekly Rolling Decision 2025-02-21

## Scope

- Cutoff date: `2025-02-21`
- 3m window: `2024-11-22` to `2025-02-21`
- 1m window: `2025-01-22` to `2025-02-21`
- Execution window: `2025-02-22` to `2025-02-28`
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

- Current 3m net return: `29.5%`
- Selected 3m net return: `29.5%`
- Current 1m net return: `37.1%`
- Selected 1m net return: `37.1%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-2.2%`
- Execution-week commission / margin: `4.4%`
- Execution-week max drawdown / margin: `-14.9%`

