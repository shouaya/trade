# Weekly Rolling Decision 2025-04-04

## Scope

- Cutoff date: `2025-04-04`
- 3m window: `2025-01-05` to `2025-04-04`
- 1m window: `2025-03-05` to `2025-04-04`
- Execution window: `2025-04-05` to `2025-04-11`
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

- Current 3m net return: `45.4%`
- Selected 3m net return: `45.4%`
- Current 1m net return: `70.2%`
- Selected 1m net return: `70.2%`

## Validation

- Validation status: `completed`
- Execution-week net return: `70.7%`
- Execution-week commission / margin: `5.6%`
- Execution-week max drawdown / margin: `-32.7%`

