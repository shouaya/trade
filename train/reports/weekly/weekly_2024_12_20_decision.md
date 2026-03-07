# Weekly Rolling Decision 2024-12-20

## Scope

- Cutoff date: `2024-12-20`
- 3m window: `2024-09-21` to `2024-12-20`
- 1m window: `2024-11-21` to `2024-12-20`
- Execution window: `2024-12-21` to `2024-12-27`
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

- Current 3m net return: `-149.8%`
- Selected 3m net return: `-66.3%`
- Current 1m net return: `20%`
- Selected 1m net return: `-0.6%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-5.7%`
- Execution-week commission / margin: `4.4%`
- Execution-week max drawdown / margin: `-21.3%`

