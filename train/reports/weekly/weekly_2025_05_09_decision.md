# Weekly Rolling Decision 2025-05-09

## Scope

- Cutoff date: `2025-05-09`
- 3m window: `2025-02-10` to `2025-05-09`
- 1m window: `2025-04-10` to `2025-05-09`
- Execution window: `2025-05-10` to `2025-05-16`
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
- Selected params: `H10 + ATRSL3.5 + ATRTP3`
- Reason: both windows favor the slow family

## Training Comparison

- Current 3m net return: `213%`
- Selected 3m net return: `224%`
- Current 1m net return: `65.2%`
- Selected 1m net return: `71.7%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-7.1%`
- Execution-week commission / margin: `2%`
- Execution-week max drawdown / margin: `-19%`

