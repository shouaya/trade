# TODO

## Goal

Complete the remaining train/validation/report workflow on Mac under the latest bid/ask execution model.

Execution rule:
- Use `priceType=BOTH` for FX imports
- Keep bid/ask execution pricing
- Do not change compose structure for platform-specific paths

## Phase 1: Environment And Data

- [ ] Start services
  - `docker compose up -d mysql api frontend adminer train`
- [ ] Confirm service health
  - `docker compose ps`
- [ ] Rebuild core tables
  - `make db-init`
- [ ] Import 2024 USD/JPY 1min FX data
  - `make import type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20240101 endDate=20241231`
- [ ] Import 2025 USD/JPY 1min FX data
  - `make import type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20250101 endDate=20251231`
- [ ] Import 2026-01 to 2026-02 USD/JPY 1min FX data
  - `make import type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20260101 endDate=20260228`
- [ ] Verify total K-line coverage
  - `docker compose exec mysql mysql -u trader -ptraderpass trading -e "SELECT COUNT(*) AS cnt, MIN(FROM_UNIXTIME(open_time/1000)) AS min_dt, MAX(FROM_UNIXTIME(open_time/1000)) AS max_dt FROM klines WHERE symbol='USDJPY' AND interval_type='1min';"`
- [ ] Keep known 2025 source gaps unchanged

## Phase 2: 2025 Fixed Training

- [ ] Run 2025 training
  - `make train CONFIG=training/2025_atr`
- [ ] Query 2025 Top strategies
  - `docker compose exec mysql mysql -u trader -ptraderpass trading -e "SELECT strategy_name, total_trades, ROUND(win_rate*100,2) AS win_rate_pct, total_pnl, sharpe_ratio, max_drawdown, score FROM backtest_results_2025_v3_atr_optimization WHERE total_trades > 0 ORDER BY total_pnl DESC, score DESC, strategy_name ASC LIMIT 10;"`
- [ ] Confirm 2025 winner family

## Phase 3: 2025 Strategy Validation

- [ ] Validate 2025 best strategy on 2024 data
  - `make validate CONFIG=validation/2025_atr_2024_validation`
- [ ] Validate 2025 best strategy on 2026 data
  - `make validate CONFIG=validation/2025_atr_2026_validation`
- [ ] Export 2024 validation results
  - `docker compose exec mysql mysql -u trader -ptraderpass trading -e "SELECT strategy_name, total_trades, ROUND(win_rate*100,2) AS win_rate_pct, total_pnl, sharpe_ratio, max_drawdown, score FROM backtest_results_2025_v3_atr_optimization_2024_validation ORDER BY total_pnl DESC, score DESC, strategy_name ASC;"`
- [ ] Export 2026 validation results
  - `docker compose exec mysql mysql -u trader -ptraderpass trading -e "SELECT strategy_name, total_trades, ROUND(win_rate*100,2) AS win_rate_pct, total_pnl, sharpe_ratio, max_drawdown, score FROM backtest_results_2025_v3_atr_optimization_2026_validation ORDER BY total_pnl DESC, score DESC, strategy_name ASC;"`
- [ ] Write 2025 fixed-window report
  - Target file: `train/reports/2025_training_and_2024_2026_validation_summary.md`

## Phase 4: Rolling Training And Validation

- [ ] Run rolling training set
  - Preferred: full rolling range already used in this repo
  - Start from `2025-01`
- [ ] Run rolling validation set
  - Validate each rolling month against its target month
- [ ] Confirm rolling best family and month-to-month stability
- [ ] Write rolling report
  - Target file: `train/reports/rolling_training_and_validation_summary.md`

## Phase 5: Final Synthesis

- [ ] Compare the 3 report lines
  - `2024 fixed`
  - `2025 fixed`
  - `rolling`
- [ ] Decide current preferred production baseline
- [ ] Identify stable parameters vs regime-sensitive parameters
- [ ] Identify TP plateau behavior in all three lines
- [ ] Write final comprehensive report
  - Target file: `train/reports/final_comprehensive_comparison_report.md`

## Existing Reports Already Available

- [ ] 2024 fixed-window report already exists
  - `train/reports/2024_training_and_2025_2026_validation_summary.md`
- [ ] Data integrity report already exists
  - `train/reports/usd_jpy_1min_data_integrity_2024_2026_02.md`

## Notes

- Current 2026 validation is not full-year validation
- Current 2026 scope is only `2026-01-01` to `2026-02-27`
- Any final statement about 2026 must explicitly mention this scope limit
- If Docker storage issues appear again, do not trust partial training tables
