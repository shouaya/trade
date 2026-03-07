# Weekly Rolling Decision 2024-04-19

## Scope

- Cutoff date: `2024-04-19`
- 3m window: `2024-01-20` to `2024-04-19`
- 1m window: `2024-03-20` to `2024-04-19`
- Execution window: `2024-04-20` to `2024-04-26`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `slow`
- 1m dominant family: `fast`
- Shared ATRSL band: `4`
- Shared ATRTP band: `3, 4`
- Agreement level: `mild`

## Decision

- Action: `fallback`
- Selected params: `H30 + ATRSL4 + ATRTP3`
- Reason: 3m window is the regime anchor and favors the slow family

## Training Comparison

- Current 3m net return: `84.4%`
- Selected 3m net return: `84.4%`
- Current 1m net return: `27.5%`
- Selected 1m net return: `27.5%`

## Validation

- Validation status: `completed`
- Execution-week net return: `0.5%`
- Execution-week commission / margin: `2%`
- Execution-week max drawdown / margin: `-9.1%`

