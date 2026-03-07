# Weekly Rolling Decision 2025-03-14

## Scope

- Cutoff date: `2025-03-14`
- 3m window: `2024-12-15` to `2025-03-14`
- 1m window: `2025-02-15` to `2025-03-14`
- Execution window: `2025-03-15` to `2025-03-21`
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

- Current 3m net return: `3.4%`
- Selected 3m net return: `3.4%`
- Current 1m net return: `-15.8%`
- Selected 1m net return: `-15.8%`

## Validation

- Validation status: `completed`
- Execution-week net return: `11.9%`
- Execution-week commission / margin: `5.2%`
- Execution-week max drawdown / margin: `-17.4%`

