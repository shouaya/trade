# Weekly Rolling Decision 2024-08-23

## Scope

- Cutoff date: `2024-08-23`
- 3m window: `2024-05-24` to `2024-08-23`
- 1m window: `2024-07-24` to `2024-08-23`
- Execution window: `2024-08-24` to `2024-08-30`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `slow`
- 1m dominant family: `slow`
- Shared ATRSL band: `3.5, 4`
- Shared ATRTP band: `3, 4`
- Agreement level: `strong`

## Decision

- Action: `fallback`
- Selected params: `H30 + ATRSL3.5 + ATRTP4`
- Reason: both windows favor the slow family

## Training Comparison

- Current 3m net return: `2.4%`
- Selected 3m net return: `2.4%`
- Current 1m net return: `92.1%`
- Selected 1m net return: `92.1%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-33.2%`
- Execution-week commission / margin: `5.2%`
- Execution-week max drawdown / margin: `-53.5%`

