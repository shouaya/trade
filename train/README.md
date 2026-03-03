# Train 目录说明

本目录承载“策略训练 / 回测 / 入库”的业务编排逻辑，目标是把这部分能力从 `scripts/` 中解耦出来，脚本仅保留参数入口职责。

详细使用方式见: `train/TRAIN_MANUAL.md`（已统一为 `docker compose run --rm train ...`）

配置驱动约定：
- 训练参数: `configs/training/*.json`
- 验证参数: `configs/validation/*.json`
- 分组参数: `configs/group-backtest/*.json`
- Top策略参数: `configs/top-strategies/*.json` + `configs/validation-top-strategies/*.json`
- 通用入口: `scripts/backtest.js`、`scripts/validate.js`、`scripts/group-backtest.js`

## 核心文件

- `backtest-training-service.js`
  - 创建/清理回测结果表
  - 按日期范围加载 K 线
  - 生成策略组合并执行回测
  - 计算评分并查询 Top N
  - 重跑 Top 策略并写入 `strategies` 与 `trades`

## 使用方式

通过 `docker compose` 入口调用（年份通过参数传入）：

- `scripts/backtest.js`
- `scripts/validate.js`
- `scripts/group-backtest.js`

示例参数：

- `docker compose run --rm train npm run backtest -- -- --config 2025 --limit 500 --types rsi_only,rsi_and_macd`
- `docker compose run --rm train npm run backtest -- -- --config 2024 --topN 20 --retainDays 3`

## 后续迁移建议

可将其它批量脚本继续迁移为“单脚本 + JSON 参数”模式，避免重复维护。
