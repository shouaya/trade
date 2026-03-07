# Weekly Rolling Decision 2025-05-30

## Scope

- Cutoff date: `2025-05-30`
- 3m window: `2025-03-03` to `2025-05-30`
- 1m window: `2025-05-01` to `2025-05-30`
- Execution window: `2025-05-31` to `2025-06-06`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `fast`
- 1m dominant family: `fast`
- Shared ATRSL band: `3.5, 4`
- Shared ATRTP band: `3, 4`
- Agreement level: `strong`

## Decision

- Action: `keep`
- Selected params: `H10 + ATRSL3.5 + ATRTP3`
- Reason: current parameters are already inside the weekly consensus zone

## Training Comparison

- Current 3m net return: `195.5%`
- Selected 3m net return: `195.5%`
- Current 1m net return: `-9.9%`
- Selected 1m net return: `-9.9%`

## Validation

- Validation status: `completed`
- Execution-week net return: `5.6%`
- Execution-week commission / margin: `6.8%`
- Execution-week max drawdown / margin: `-23.1%`

