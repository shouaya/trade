# Weekly Rolling Decision 2025-03-07

## Scope

- Cutoff date: `2025-03-07`
- 3m window: `2024-12-08` to `2025-03-07`
- 1m window: `2025-02-08` to `2025-03-07`
- Execution window: `2025-03-08` to `2025-03-14`
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
- Selected params: `H10 + ATRSL4 + ATRTP4`
- Reason: current parameters are already inside the weekly consensus zone

## Training Comparison

- Current 3m net return: `26.4%`
- Selected 3m net return: `26.4%`
- Current 1m net return: `23.4%`
- Selected 1m net return: `23.4%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-5.1%`
- Execution-week commission / margin: `3.2%`
- Execution-week max drawdown / margin: `-43.5%`

