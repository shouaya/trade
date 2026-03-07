# Weekly Rolling Decision 2024-06-14

## Scope

- Cutoff date: `2024-06-14`
- 3m window: `2024-03-15` to `2024-06-14`
- 1m window: `2024-05-15` to `2024-06-14`
- Execution window: `2024-06-15` to `2024-06-21`
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

- Current 3m net return: `32.2%`
- Selected 3m net return: `32.2%`
- Current 1m net return: `-67.6%`
- Selected 1m net return: `-67.6%`

## Validation

- Validation status: `completed`
- Execution-week net return: `0.8%`
- Execution-week commission / margin: `6.8%`
- Execution-week max drawdown / margin: `-20.5%`

