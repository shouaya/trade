# Weekly Rolling Decision 2024-05-17

## Scope

- Cutoff date: `2024-05-17`
- 3m window: `2024-02-18` to `2024-05-17`
- 1m window: `2024-04-18` to `2024-05-17`
- Execution window: `2024-05-18` to `2024-05-24`
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
- Selected params: `H30 + ATRSL4 + ATRTP4`
- Reason: 3m window is the regime anchor and favors the slow family

## Training Comparison

- Current 3m net return: `145.1%`
- Selected 3m net return: `145.1%`
- Current 1m net return: `33.1%`
- Selected 1m net return: `33.1%`

## Validation

- Validation status: `completed`
- Execution-week net return: `20%`
- Execution-week commission / margin: `4.8%`
- Execution-week max drawdown / margin: `-4.2%`

