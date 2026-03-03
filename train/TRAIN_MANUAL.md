# Train 使用手册

本文档说明如何通过 `npm` 命令执行训练、回测、分组并行和结果查询。

## 1. 前置条件

- 已安装依赖：`npm install`
- MySQL/API 可用（如使用 docker）：
  - `docker-compose up -d`
- 已导入 K 线数据（至少覆盖 2024/2025 回测区间）

## 2. 快速开始

### 2.1 2025 批量训练回测

```bash
npm run train:2025
```

带参数示例：

```bash
npm run train:2025 -- --limit 500 --types rsi_only,rsi_and_macd --topN 20 --retainDays 3
```

### 2.2 2024 批量训练回测

```bash
npm run train:2024
```

带参数示例：

```bash
npm run train:2024 -- --limit 800 --types rsi_only --topN 10
```

## 3. 策略分组并行回测（2025）

### 3.1 启动 10 组并行

```bash
npm run train:group:launch
```

### 3.2 实时监控

```bash
npm run train:group:monitor
```

### 3.3 停止所有组

```bash
npm run train:group:stop
```

### 3.4 查询分组结果

```bash
npm run train:group:query
```

## 4. 单组调试（参数化入口）

运行第 1 组（10 组切分）：

```bash
npm run train:group -- --group 1 --groups 10
```

手工指定策略索引范围：

```bash
npm run train:group -- --group 3 --startIndex 2000 --endIndex 3999 --batchSize 20
```

## 5. 结果查询与验证

查询多维 Top10：

```bash
npm run train:query:top10
```

验证脚本：

```bash
npm run train:validate:2024
npm run train:validate:2026
npm run train:validate:2024:top3
npm run train:validate:2026:top3
```

保存策略：

```bash
npm run train:save:top10
npm run train:save:top3
```

## 6. 参数说明

`train:2024` / `train:2025` 支持：

- `--limit`：限制策略数量
- `--types`：策略类型列表（逗号分隔）
- `--topN`：入库 Top N
- `--retainDays`：保留回测中间表历史天数

`train:group` 支持：

- `--group`：组号（从 1 开始）
- `--groups`：总分组数（默认 10）
- `--startIndex`、`--endIndex`：覆盖自动分组范围
- `--batchSize`：每批落库数量

## 7. 常见问题

- `bash: command not found`
  - `train:group:launch/monitor/stop` 依赖 `bash`。请在 Git Bash / WSL / Linux / macOS 下运行，或改用 Node 版启动脚本。
- 回测报“没有找到K线数据”
  - 请先导入对应时间区间的数据，并确认 `symbol/interval_type` 与脚本一致（默认 `USDJPY/1min`）。
