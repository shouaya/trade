# Weekly Rolling Decision 2025-02-14

## Scope

- Cutoff date: `2025-02-14`
- 3m window: `2024-11-15` to `2025-02-14`
- 1m window: `2025-01-15` to `2025-02-14`
- Execution window: `2025-02-15` to `2025-02-21`
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

- Current 3m net return: `-35%`
- Selected 3m net return: `-35%`
- Current 1m net return: `54.1%`
- Selected 1m net return: `54.1%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-26.2%`
- Execution-week commission / margin: `6.4%`
- Execution-week max drawdown / margin: `-29.7%`

