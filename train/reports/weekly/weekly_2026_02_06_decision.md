# Weekly Rolling Decision 2026-02-06

## Scope

- Cutoff date: `2026-02-06`
- 3m window: `2025-11-07` to `2026-02-06`
- 1m window: `2026-01-07` to `2026-02-06`
- Execution window: `2026-02-07` to `2026-02-13`
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

- Current 3m net return: `-97.8%`
- Selected 3m net return: `-49%`
- Current 1m net return: `1.8%`
- Selected 1m net return: `7%`

## Validation

- Validation status: `completed`
- Execution-week net return: `63.4%`
- Execution-week commission / margin: `5.6%`
- Execution-week max drawdown / margin: `-27.4%`

