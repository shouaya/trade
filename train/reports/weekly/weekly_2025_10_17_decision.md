# Weekly Rolling Decision 2025-10-17

## Scope

- Cutoff date: `2025-10-17`
- 3m window: `2025-07-18` to `2025-10-17`
- 1m window: `2025-09-18` to `2025-10-17`
- Execution window: `2025-10-18` to `2025-10-24`
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
- Selected params: `H10 + ATRSL3.5 + ATRTP4`
- Reason: current parameters are already inside the weekly consensus zone

## Training Comparison

- Current 3m net return: `-40.8%`
- Selected 3m net return: `-40.8%`
- Current 1m net return: `28.5%`
- Selected 1m net return: `28.5%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-32.1%`
- Execution-week commission / margin: `7.2%`
- Execution-week max drawdown / margin: `-33.5%`

