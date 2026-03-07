# Weekly Rolling Decision 2025-08-01

## Scope

- Cutoff date: `2025-08-01`
- 3m window: `2025-05-02` to `2025-08-01`
- 1m window: `2025-07-02` to `2025-08-01`
- Execution window: `2025-08-02` to `2025-08-08`
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
- Selected params: `H25 + ATRSL3.5 + ATRTP4`
- Reason: switch threshold not met; keeping current production parameters

## Training Comparison

- Current 3m net return: `128.6%`
- Selected 3m net return: `131.6%`
- Current 1m net return: `59.2%`
- Selected 1m net return: `69.8%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-37.2%`
- Execution-week commission / margin: `3.6%`
- Execution-week max drawdown / margin: `-42.3%`

