# Weekly Rolling Decision 2026-02-20

## Scope

- Cutoff date: `2026-02-20`
- 3m window: `2025-11-21` to `2026-02-20`
- 1m window: `2026-01-21` to `2026-02-20`
- Execution window: `2026-02-21` to `2026-02-27`
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
- Selected params: `H30 + ATRSL4 + ATRTP4`
- Reason: both windows favor the slow family

## Training Comparison

- Current 3m net return: `86.8%`
- Selected 3m net return: `86.8%`
- Current 1m net return: `133.8%`
- Selected 1m net return: `133.8%`

## Validation

- Validation status: `completed`
- Execution-week net return: `7%`
- Execution-week commission / margin: `6.8%`
- Execution-week max drawdown / margin: `-21.2%`

