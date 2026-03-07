# Weekly Rolling Decision 2026-02-13

## Scope

- Cutoff date: `2026-02-13`
- 3m window: `2025-11-14` to `2026-02-13`
- 1m window: `2026-01-14` to `2026-02-13`
- Execution window: `2026-02-14` to `2026-02-20`
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

- Current 3m net return: `22.4%`
- Selected 3m net return: `22.4%`
- Current 1m net return: `103.3%`
- Selected 1m net return: `103.3%`

## Validation

- Validation status: `completed`
- Execution-week net return: `45.4%`
- Execution-week commission / margin: `4.4%`
- Execution-week max drawdown / margin: `-9.7%`

