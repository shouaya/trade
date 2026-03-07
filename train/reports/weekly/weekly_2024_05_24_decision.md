# Weekly Rolling Decision 2024-05-24

## Scope

- Cutoff date: `2024-05-24`
- 3m window: `2024-02-25` to `2024-05-24`
- 1m window: `2024-04-25` to `2024-05-24`
- Execution window: `2024-05-25` to `2024-05-31`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `slow`
- 1m dominant family: `slow`
- Shared ATRSL band: `4`
- Shared ATRTP band: `3, 4`
- Agreement level: `strong`

## Decision

- Action: `fallback`
- Selected params: `H30 + ATRSL4 + ATRTP4`
- Reason: both windows favor the slow family

## Training Comparison

- Current 3m net return: `140.2%`
- Selected 3m net return: `140.2%`
- Current 1m net return: `73.9%`
- Selected 1m net return: `73.9%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-37.5%`
- Execution-week commission / margin: `5.6%`
- Execution-week max drawdown / margin: `-50.4%`

