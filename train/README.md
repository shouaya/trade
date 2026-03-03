# Train 目录说明

本目录承载“策略训练 / 回测 / 入库”的业务编排逻辑，目标是把这部分能力从 `scripts/` 中解耦出来，脚本仅保留参数入口职责。

详细使用方式见: `train/TRAIN_MANUAL.md`

## 核心文件

- `backtest-training-service.js`
  - 创建/清理回测结果表
  - 按日期范围加载 K 线
  - 生成策略组合并执行回测
  - 计算评分并查询 Top N
  - 重跑 Top 策略并写入 `strategies` 与 `trades`

## 使用方式

通过脚本入口调用：

- `scripts/run-multi-strategy-backtest.js` (2025 配置)
- `scripts/run-backtest-2024.js` (2024 配置，策略名带 `2024-` 前缀)

示例参数：

- `node train/scripts/run-multi-strategy-backtest.js --limit 500 --types rsi_only,rsi_and_macd`
- `node train/scripts/run-backtest-2024.js --topN 20 --retainDays 3`

## 后续迁移建议

可将其它批量脚本（如 `run-backtest-2025-m*.js`、`run-backtest-2025-group*.js`）逐步改为复用本目录 service，避免重复维护。
