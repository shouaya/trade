# Weekly Rolling Decision 2025-11-07

## Scope

- Cutoff date: `2025-11-07`
- 3m window: `2025-08-08` to `2025-11-07`
- 1m window: `2025-10-08` to `2025-11-07`
- Execution window: `2025-11-08` to `2025-11-14`
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
- Selected params: `H10 + ATRSL3.5 + ATRTP4`
- Reason: current parameters are already inside the weekly consensus zone

## Training Comparison

- Current 3m net return: `-5%`
- Selected 3m net return: `-5%`
- Current 1m net return: `1.5%`
- Selected 1m net return: `1.5%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-16.8%`
- Execution-week commission / margin: `6.4%`
- Execution-week max drawdown / margin: `-26.4%`

