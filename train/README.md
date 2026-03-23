# Train

`train` 目录现在只保留当前探索主链路：

- `rsi_macd` 入场
- ATR 止损 / 止盈
- 高频短持仓
- 统一写入 `backtest_results`
- BTCJPY 2024 / 2025 / 2026 训练配置
- BTCJPY 2025 Top10 对 2024 / 2026 验证配置
- 事件段路由验证能力

正式方法论文档：

- [METHODOLOGY.md](/Users/ts-changchang.zhuang/git/money/train/METHODOLOGY.md)
- [PLAYBOOK.md](/Users/ts-changchang.zhuang/git/money/train/PLAYBOOK.md)
- [TASK_TEMPLATE.md](/Users/ts-changchang.zhuang/git/money/train/TASK_TEMPLATE.md)
- [REPORT_SCORECARD.md](/Users/ts-changchang.zhuang/git/money/train/REPORT_SCORECARD.md)

## 常用命令

```bash
npm run build
npm test
npm run init-db
npm run train -- configs/training/2025_btcjpy_hf_rsi_macd_tp_atr.json
npm run validate -- configs/validation/2025_btcjpy_v7_hf_rsi_macd_top10_exact_from_2025_2024_validation.json
npm run router:validate
```

## 当前配置目录

```text
configs/
  training/
    2024_btcjpy_hf_rsi_macd_tp_atr.json
    2025_btcjpy_hf_rsi_macd_tp_atr.json
    2026_btcjpy_hf_rsi_macd_tp_atr.json
  validation/
    2025_btcjpy_v7_hf_rsi_macd_top10_exact_from_2025_2024_validation.json
    2025_btcjpy_v7_hf_rsi_macd_top10_exact_from_2025_2026_validation.json
  top-strategies/
    2025_btcjpy_v7_hf_rsi_macd_top10_exact_from_2025_top10.generated.json
  generated/regime-routing/
    BTCJPY_dual_year_router_v10_weekly_refined.json
    BTCJPY_dual_year_router_v10_weekly_refined.policy.json
```

## 关键入口

- `src/scripts/train.ts`
- `src/scripts/router-validate.ts`
- `src/services/strategy-executor.ts`
- `src/services/strategy-parameter-generator.ts`
- `src/services/router-policy-catalog.ts`
- `src/services/regime-router-validation.ts`

## 数据库

- `klines`
- `backtest_results`
- `strategies`
- `trades`
- `tasks`

旧的 `rsi_only / rolling / dynamic_ma200 / regression / multi-timeframe / signal-generator` 链路已经从当前实现中移除。
