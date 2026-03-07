# Weekly Rolling Decision 2025-06-27

## Scope

- Cutoff date: `2025-06-27`
- 3m window: `2025-03-28` to `2025-06-27`
- 1m window: `2025-05-28` to `2025-06-27`
- Execution window: `2025-06-28` to `2025-07-04`
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
- Selected params: `H25 + ATRSL4 + ATRTP3`
- Reason: both windows favor the slow family

## Training Comparison

- Current 3m net return: `252.2%`
- Selected 3m net return: `252.2%`
- Current 1m net return: `94.1%`
- Selected 1m net return: `94.1%`

## Validation

- Validation status: `completed`
- Execution-week net return: `16%`
- Execution-week commission / margin: `4.4%`
- Execution-week max drawdown / margin: `-16.7%`

