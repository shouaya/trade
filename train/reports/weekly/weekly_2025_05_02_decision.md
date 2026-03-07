# Weekly Rolling Decision 2025-05-02

## Scope

- Cutoff date: `2025-05-02`
- 3m window: `2025-02-03` to `2025-05-02`
- 1m window: `2025-04-03` to `2025-05-02`
- Execution window: `2025-05-03` to `2025-05-09`
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`

## Consensus

- 3m dominant family: `fast`
- 1m dominant family: `slow`
- Shared ATRSL band: `3.5, 4`
- Shared ATRTP band: `3, 4`
- Agreement level: `mild`

## Decision

- Action: `keep`
- Selected params: `H10 + ATRSL4 + ATRTP4`
- Reason: current parameters are already inside the weekly consensus zone

## Training Comparison

- Current 3m net return: `219.9%`
- Selected 3m net return: `219.9%`
- Current 1m net return: `131.7%`
- Selected 1m net return: `131.7%`

## Validation

- Validation status: `completed`
- Execution-week net return: `2.8%`
- Execution-week commission / margin: `2.4%`
- Execution-week max drawdown / margin: `-21%`

