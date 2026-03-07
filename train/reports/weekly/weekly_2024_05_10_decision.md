# Weekly Rolling Decision 2024-05-10

## Scope

- Cutoff date: `2024-05-10`
- 3m window: `2024-02-11` to `2024-05-10`
- 1m window: `2024-04-11` to `2024-05-10`
- Execution window: `2024-05-11` to `2024-05-17`
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

- Current 3m net return: `181.5%`
- Selected 3m net return: `182.9%`
- Current 1m net return: `84.7%`
- Selected 1m net return: `86.1%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-29.5%`
- Execution-week commission / margin: `5.2%`
- Execution-week max drawdown / margin: `-43.4%`

