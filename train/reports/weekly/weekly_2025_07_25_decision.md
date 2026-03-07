# Weekly Rolling Decision 2025-07-25

## Scope

- Cutoff date: `2025-07-25`
- 3m window: `2025-04-26` to `2025-07-25`
- 1m window: `2025-06-26` to `2025-07-25`
- Execution window: `2025-07-26` to `2025-08-01`
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
- Selected params: `H25 + ATRSL3.5 + ATRTP4`
- Reason: 3m window is the regime anchor and favors the slow family

## Training Comparison

- Current 3m net return: `141.6%`
- Selected 3m net return: `148.9%`
- Current 1m net return: `65.4%`
- Selected 1m net return: `72.7%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-0.7%`
- Execution-week commission / margin: `3.2%`
- Execution-week max drawdown / margin: `-17.1%`

