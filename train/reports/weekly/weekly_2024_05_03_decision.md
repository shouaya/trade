# Weekly Rolling Decision 2024-05-03

## Scope

- Cutoff date: `2024-05-03`
- 3m window: `2024-02-04` to `2024-05-03`
- 1m window: `2024-04-04` to `2024-05-03`
- Execution window: `2024-05-04` to `2024-05-10`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `slow`
- 1m dominant family: `fast`
- Shared ATRSL band: `3.5, 4`
- Shared ATRTP band: `3, 4`
- Agreement level: `mild`

## Decision

- Action: `fallback`
- Selected params: `H30 + ATRSL4 + ATRTP3`
- Reason: 3m window is the regime anchor and favors the slow family

## Training Comparison

- Current 3m net return: `153.6%`
- Selected 3m net return: `153.6%`
- Current 1m net return: `62.5%`
- Selected 1m net return: `62.5%`

## Validation

- Validation status: `completed`
- Execution-week net return: `20.3%`
- Execution-week commission / margin: `6%`
- Execution-week max drawdown / margin: `-14.4%`

