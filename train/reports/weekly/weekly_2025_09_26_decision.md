# Weekly Rolling Decision 2025-09-26

## Scope

- Cutoff date: `2025-09-26`
- 3m window: `2025-06-27` to `2025-09-26`
- 1m window: `2025-08-27` to `2025-09-26`
- Execution window: `2025-09-27` to `2025-10-03`
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

- Action: `switch`
- Selected params: `H10 + ATRSL3.5 + ATRTP4`
- Reason: fast-family consensus survives across 3m and 1m windows

## Training Comparison

- Current 3m net return: `-71.8%`
- Selected 3m net return: `0.9%`
- Current 1m net return: `-50.9%`
- Selected 1m net return: `-5.5%`

## Validation

- Validation status: `completed`
- Execution-week net return: `11.5%`
- Execution-week commission / margin: `6.8%`
- Execution-week max drawdown / margin: `-29.2%`

