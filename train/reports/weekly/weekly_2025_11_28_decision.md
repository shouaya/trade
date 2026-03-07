# Weekly Rolling Decision 2025-11-28

## Scope

- Cutoff date: `2025-11-28`
- 3m window: `2025-08-29` to `2025-11-28`
- 1m window: `2025-10-29` to `2025-11-28`
- Execution window: `2025-11-29` to `2025-12-05`
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
- Selected params: `H10 + ATRSL3.5 + ATRTP4`
- Reason: current parameters are already inside the weekly consensus zone

## Training Comparison

- Current 3m net return: `-10%`
- Selected 3m net return: `-10%`
- Current 1m net return: `24.1%`
- Selected 1m net return: `24.1%`

## Validation

- Validation status: `completed`
- Execution-week net return: `-15.2%`
- Execution-week commission / margin: `7.2%`
- Execution-week max drawdown / margin: `-21.7%`

