# Train 使用手册

本文档说明如何通过 `docker compose` 统一执行训练、回测、分组并行和结果查询。

命令组织规范：
- `train/package.json` 维护训练域内的原生命令（如 `backtest:2025`、`group:run`）。
- 根 `package.json` 提供 `train:*` 代理命令，方便在仓库根目录执行。
- 推荐统一使用：`train:backtest:*` 与 `train:group:*`。

## 1. 前置条件

- 启动基础服务（推荐）：
  - `docker compose up -d mysql api frontend adminer`
- 建议使用一次性容器执行 train 命令（无需常驻 train 容器）
- 已导入 K 线数据（至少覆盖 2024/2025 回测区间）

## 2. 快速开始

### 2.0 安装 train 依赖

在一次性 train 容器中执行：

```bash
docker compose run --rm train npm install
```

### 2.1 2025 批量训练回测

```bash
docker compose run --rm train npm run backtest:2025
```

带参数示例：

```bash
docker compose run --rm train npm run backtest:2025 -- --limit 500 --types rsi_only,rsi_and_macd --topN 20 --retainDays 3
```

### 2.2 2024 批量训练回测

```bash
docker compose run --rm train npm run backtest:2024
```

带参数示例：

```bash
docker compose run --rm train npm run backtest:2024 -- --limit 800 --types rsi_only --topN 10
```

## 3. 策略分组并行回测（2025）

### 3.1 启动 10 组并行

```bash
docker compose run --rm train npm run group:launch
```

### 3.2 实时监控

```bash
docker compose run --rm train npm run group:monitor
```

### 3.3 停止所有组

```bash
docker compose run --rm train npm run group:stop
```

### 3.4 查询分组结果

```bash
docker compose run --rm train npm run group:query
```

## 4. 单组调试（参数化入口）

运行第 1 组（10 组切分）：

```bash
docker compose run --rm train npm run group:run -- --group 1 --groups 10
```

手工指定策略索引范围：

```bash
docker compose run --rm train npm run group:run -- --group 3 --startIndex 2000 --endIndex 3999 --batchSize 20
```

## 5. 结果查询与验证

查询多维 Top10：

```bash
docker compose run --rm train npm run query:top10
```

验证脚本：

```bash
docker compose run --rm train npm run validate:2024
docker compose run --rm train npm run validate:2026
docker compose run --rm train npm run validate:2024:top3
docker compose run --rm train npm run validate:2026:top3
```

保存策略：

```bash
docker compose run --rm train npm run save:top10
docker compose run --rm train npm run save:top3
```

## 6. 参数说明

`backtest:2024` / `backtest:2025` 支持：

- `--limit`：限制策略数量
- `--types`：策略类型列表（逗号分隔）
- `--topN`：入库 Top N
- `--retainDays`：保留回测中间表历史天数

`group:run` 支持：

- `--group`：组号（从 1 开始）
- `--groups`：总分组数（默认 10）
- `--startIndex`、`--endIndex`：覆盖自动分组范围
- `--batchSize`：每批落库数量

## 7. 常见问题

- `error during connect ... EOF`
  - 先重试单服务命令：`docker compose run --rm train npm run backtest:2025`
  - 若仍失败，重启 Docker Desktop 后再试。
- `bash: command not found`
  - `group:launch/monitor/stop` 依赖 `bash`；当前 `train` 镜像为 `node:22`，默认可用。
- 回测报“没有找到K线数据”
  - 请先导入对应时间区间的数据，并确认 `symbol/interval_type` 与脚本一致（默认 `USDJPY/1min`）。
