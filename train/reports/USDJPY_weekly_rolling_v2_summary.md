# Weekly Rolling V2 Summary

## Scope

This report summarizes the second iteration of the weekly rolling strategy selector.

Evaluation range:
- Start cutoff: `2025-01-03`
- End cutoff: `2026-02-20`
- Total weekly cutoffs: `60`

Capital basis used for both training and validation:
- Initial margin capital: `500 USD`
- Leverage: `20x`
- Position basis: `0.1 lot = 10,000 USD notional`
- All return ratios below are normalized by `500 USD`

Execution note:
- FX import used `priceType=BOTH`
- Storage and execution remained bid/ask-aware
- Fee model used `GMOCOIN`
- Commission rule: `notional x 0.002%` on both entry and exit

Important scope limit:
- Current `2026` evidence in this report only covers `2026-01-01` to `2026-02-27`
- No statement here should be read as a full-year `2026` conclusion

Source artifacts:
- [weekly_history_2025_01_03_2026_02_20.md](/Users/shoushoushou/git/trade/train/reports/weekly/weekly_history_2025_01_03_2026_02_20.md)
- [weekly_history_2025_01_03_2026_02_20.json](/Users/shoushoushou/git/trade/train/reports/weekly/weekly_history_2025_01_03_2026_02_20.json)

## Why V2 Exists

Weekly rolling V1 was technically valid but operationally weak.

Main V1 problems:
- it mixed `2024` slow-regime history with `2025+` production-relevant history
- it paused too often
- it switched too rarely
- its full-history validation aggregate was negative

V2 was introduced to fix those issues without changing the core fee-aware backtest engine.

## V2 Rule Set

Search space used by V2:
- Hold families: `H10`, `H25`, `H30`
- `ATRSL`: `3.5`, `4`
- `ATRTP`: `3`, `4`
- `lotSize`: fixed at `0.1`

Windows used each week:
- `3m` training window as regime anchor
- `1m` training window as confirmation / warning signal
- next `1 week` as execution-window validation

V2 decision logic:
- `keep`
- `switch`
- `fallback`
- `pause`

Key V2 changes versus V1:
- removed `H15`
- narrowed search space to the fee-relevant region already identified by prior runs
- reduced over-aggressive pausing
- relaxed switch threshold from a rigid multiplicative rule to a more practical absolute improvement rule
- allowed continuity when `3m` remains viable but `1m` is temporarily weak
- evaluated production relevance on `2025+`, not on the full `2024-2026` history

## V2 Aggregate Result

Action counts:
- `keep`: `35`
- `pause`: `13`
- `fallback`: `11`
- `switch`: `1`

Validation summary:
- Validation completed: `47`
- Positive validation weeks: `27`
- Negative validation weeks: `20`
- Total validation net return: `147.6%`
- Average validation net return: `3.1%`

Interpretation:
- V2 is materially better than V1 for the production-relevant `2025+` range
- The system spends most of its time in `keep`, which is operationally desirable
- `pause` still exists, but no longer dominates the workflow
- `fallback` is still important and cannot be removed

## Parameter Path

Initial parameters:
- `H10 + ATRSL4 + ATRTP4`

Final parameters:
- `H30 + ATRSL4 + ATRTP4`

Observed parameter path:
- early `2025` starts from the fast family
- during strong `2025-02` to `2025-05` weeks, `H10 + ATRSL4 + ATRTP4` remains productive
- during softer intermediate periods, the selector moves toward `ATRSL3.5 / ATRTP3`
- in later periods, especially near the available `2026` tail, the selector often prefers the slow fallback family

Interpretation:
- weekly rolling does not prove that `H10` should always dominate
- weekly rolling does prove that a fee-aware selector benefits from keeping both the fast family and the slow fallback available

## What Worked

Clear improvements in V2:
- production-relevant weekly aggregate turned positive
- weekly average return turned positive
- `keep` became the dominant action
- the framework stopped overreacting to short-window weakness

Most important positive conclusion:
- a fee-aware weekly selector is viable for `2025+`
- but it should be framed as a regime-sensitive controller, not as a permanently fast-only controller

## What Did Not Hold

Things V2 does not support:
- removing fallback logic
- claiming `H10` is always the correct weekly production family
- claiming weekly switching is frequent or necessary
- claiming full `2026` evidence

Important negative finding:
- even in V2, the system ends the sample on `H30 + ATRSL4 + ATRTP4`
- this means the slow family remains structurally relevant and should not be deleted from the weekly framework

## Production Reading

Current practical reading:
- do not use fixed-window selection as the primary deployment logic
- use weekly rolling V2 as the primary strategy-selection framework
- keep slow fallback enabled
- keep fee-aware net metrics as the only truth source for weekly decisions

Recommended production policy:
- primary controller: weekly rolling V2
- fast family available: `H10 + ATRSL4 + ATRTP4`
- nearby fast variant available: `H10 + ATRSL3.5 + ATRTP3`
- fallback family available: `H25/H30 + ATRSL4 + ATRTP3/4`

## Final Conclusion

Weekly Rolling V2 is the first weekly version that is operationally credible under fees.

Main conclusion:
- for the production-relevant `2025-01-03` to `2026-02-20` range, weekly rolling V2 is positive in aggregate
- V2 improves materially over V1
- the correct architecture is not `fixed`
- the correct architecture is not `fast only`
- the correct architecture is `weekly rolling + fallback`

If one weekly framework should be retained now, use:
- weekly rolling V2 with fee-aware net metrics
- `H10` as the fast family
- `H25/H30` as explicit fallback
- fixed `0.1 lot`
- no auto-scaling
