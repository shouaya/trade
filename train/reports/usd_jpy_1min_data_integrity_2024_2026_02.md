# USD/JPY 1min FX Data Integrity Report

## Scope

This report summarizes the imported `USDJPY / 1min / fx / BOTH` dataset currently stored in `klines`.

Coverage:
- 2024-01-01 to 2024-12-31
- 2025-01-01 to 2025-12-31
- 2026-01-01 to 2026-02-28

Storage model:
- Raw prices are stored as `bid_*` and `ask_*`
- No compatibility `open/high/low/close` columns are persisted in `klines`
- Mid prices are calculated only at query/runtime when needed

## Summary

Imported totals:
- 2024: `371,160` bars
- 2025: `369,638` bars
- 2026-01 to 2026-02: `58,500` bars
- Total in DB: `799,298` bars

Current full-table range:
- Earliest bar: `2024-01-01 22:00:00 UTC`
- Latest bar: `2026-02-27 20:59:00 UTC`

Expected weekly pattern observed:
- Sunday: `120` bars
- Monday to Thursday: `1440` bars/day
- Friday: `1260` bars
- Weekend close gap: Friday `20:59 UTC` to Sunday `22:00 UTC`

## Yearly Results

### 2024

Range:
- Start: `2024-01-01 22:00:00 UTC`
- End: `2024-12-31 20:59:00 UTC`

Integrity result:
- No non-weekend abnormal gaps found
- Dataset is considered complete for training/validation usage

### 2025

Range:
- Start: `2025-01-01 22:00:00 UTC`
- End: `2025-12-31 20:59:00 UTC`

Integrity result:
- Two non-weekend abnormal gaps were found
- These gaps were verified against the upstream GMO public API
- Conclusion: the missing bars are from source data, not from the import process

Observed abnormal gaps:
1. `2025-04-14 21:14 UTC -> 2025-04-14 21:18 UTC`
   Missing duration: `4` minutes

2. `2025-09-08 03:01 UTC -> 2025-09-08 04:21 UTC`
   Missing duration: `80` minutes

Decision:
- Keep the gaps as-is
- Do not forward-fill or synthesize missing bars

### 2026-01 to 2026-02

Range:
- Start: `2026-01-01 22:00:00 UTC`
- End: `2026-02-27 20:59:00 UTC`

Integrity result:
- No non-weekend abnormal gaps found
- Dataset is considered clean

Observed daily pattern examples:
- `2026-01-01`: `120`
- `2026-01-02`: `1260`
- `2026-02-23` to `2026-02-26`: `1440`
- `2026-02-27`: `1260`

## Conclusion

The current `USDJPY / 1min / fx / BOTH` dataset is usable for training and validation.

Operational conclusion:
- 2024: clean
- 2025: usable, with 2 verified source gaps retained intentionally
- 2026-01 to 2026-02: clean

Recommended handling:
- Keep the 2025 gaps unchanged
- Record them as known upstream data issues
- Use the dataset as the canonical source for the next training/validation runs
