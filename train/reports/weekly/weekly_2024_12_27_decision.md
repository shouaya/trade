# Weekly Rolling Decision 2024-12-27

## Scope

- Cutoff date: `2024-12-27`
- 3m window: `2024-09-28` to `2024-12-27`
- 1m window: `2024-11-28` to `2024-12-27`
- Execution window: `2024-12-28` to `2025-01-03`
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
- Selected params: `H30 + ATRSL3.5 + ATRTP4`
- Reason: switch threshold not met; keeping current production parameters

## Training Comparison

- Current 3m net return: `-167.1%`
- Selected 3m net return: `-130.9%`
- Current 1m net return: `40.1%`
- Selected 1m net return: `21.5%`

## Validation

- Validation status: `completed`
- Execution-week net return: `5.9%`
- Execution-week commission / margin: `7.2%`
- Execution-week max drawdown / margin: `-20.2%`

