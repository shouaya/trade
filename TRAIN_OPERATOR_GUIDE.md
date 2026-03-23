# Train 上手操作指南

这份文档面向第一次接触 `train/` 流程的人。

目标是用最短路径说明：

1. 怎么新建训练配置
2. 参数大概怎么填
3. 下一步执行什么
4. 一直到最后会产出哪些报告、策略文件、router 文件

如果你后面要做更完整的方法论，请再看：

- `train/METHODOLOGY.md`
- `train/PLAYBOOK.md`
- `train/REPORT_SCORECARD.md`

## 先记住一件事

当前 `train` 的最小工作流分成两层：

- 第一层：训练候选池 -> 生成验证配置 -> 跑未来期验证
- 第二层：补 router / policy catalog -> 跑 router 验证 -> 出策略系统报告

如果你只是第一次上手，建议先跑通第一层。

## 最终会产出什么

一个完整任务通常会得到这些产物：

- 训练配置：`train/configs/training/*.json`
- 验证配置：`train/configs/validation/*.json`
- Top 策略快照：`train/configs/top-strategies/*.generated.json`
- router 文件：`train/configs/generated/regime-routing/*.json`
- policy catalog：`train/configs/generated/regime-routing/*.policy.json`
- 候选池结果：数据库 `backtest_results`
- Top 策略：数据库 `strategies`
- 路由验证报告：`train/reports/regime-routing-results/*.md` 和 `*.json`
- 成本敏感度报告：`train/reports/cost-sensitivity/*.md` 和 `*.json`
- 因果特征审计：`train/reports/feature-causality/*.md` 和 `*.json`

## Step 0：启动基础服务

仓库推荐用 Docker Compose 作为主执行路径。

先启动基础服务：

```bash
docker compose up -d mysql api frontend adminer
```

如果你要使用 UI 里的一键训练/验证，请把 `train` worker 也启动：

```bash
docker compose up -d train
```

第一次使用 `train` 时，建议先初始化：

```bash
docker compose run --rm train sh -lc "npm install && npm run build && npm run init-db"
```

这一步现在还会自动把 `train/configs/**/*.json` 同步进数据库里的 `train_configs`。
同时也会创建 UI 运行队列使用的 `train_run_requests` 表。

如果只是更新代码后重新跑：

```bash
docker compose run --rm train sh -lc "npm install && npm run build"
```

如果你后面只改了 JSON 配置，想单独把配置注册表同步到 DB，可以执行：

```bash
docker compose run --rm train sh -lc "npm install && npm run build && npm run sync:configs"
```

## Step 1：新建训练配置

最简单的做法不是从零写，而是复制一份现有训练配置再改名。

推荐从这里复制：

- `train/configs/training/2025_btcjpy_hf_rsi_macd_tp_atr.json`

例如你要做 `BTCJPY` 的一个新训练，可以先复制成：

```text
train/configs/training/2026_btcjpy_my_run.json
```

## Step 2：训练配置里哪些字段必须改

下面是一个最小可用模板。

```json
{
  "name": "2026_BTCJPY_MY_RUN",
  "description": "2026 BTCJPY first train run",
  "timeRange": {
    "startTimeMs": 1767225600000,
    "endTimeMs": 1773964740000,
    "startIso": "2026-01-01T00:00:00.000Z",
    "endIso": "2026-03-19T23:59:00.000Z"
  },
  "market": {
    "symbol": "BTCJPY",
    "intervalType": "1min"
  },
  "database": {
    "tableName": "btcjpy_my_run_train_2026",
    "resetTableBeforeRun": true
  },
  "strategy": {
    "types": ["rsi_macd"],
    "parameters": {
      "rsi": {
        "period": [5, 7],
        "oversold": [32, 35],
        "overbought": [65, 68]
      },
      "macd": {
        "fastPeriod": [4, 6],
        "slowPeriod": [9, 12],
        "signalPeriod": [3, 4],
        "histogramThreshold": [0]
      },
      "risk": {
        "maxPositions": [1],
        "lotSize": [0.008],
        "maxHoldMinutes": [6, 8]
      },
      "atr": {
        "slMultiplier": [1.5, 2],
        "tpMultiplier": [1, 1.5]
      },
      "tradingSchedule": "* 12-18 * * 1-5",
      "tradingTimeRestriction": null
    }
  },
  "executor": {
    "version": "v3",
    "options": {
      "enableATRSizing": true,
      "feeModel": {
        "venueCode": "GMOCOIN",
        "commissionRate": 0.00002,
        "basis": "notional",
        "chargeOnEntry": true,
        "chargeOnExit": true
      }
    }
  },
  "output": {
    "topN": 10,
    "strategyNamePrefix": "2026-BTCJPY-MYRUN-",
    "descriptionPrefix": "2026 BTCJPY my run"
  }
}
```

### 这些字段必须确认

- `name`
  用来标识这次任务，尽量唯一。

- `timeRange`
  训练期时间范围。

- `market.symbol`
  交易对，比如 `BTCJPY`、`ETHJPY`。

- `market.intervalType`
  当前主链路默认是 `1min`。

- `database.tableName`
  这是这次训练的逻辑结果分组名，后面生成验证配置时还会用到。

- `output.topN`
  训练完成后要保留多少个 Top 策略。

### 参数怎么填

第一次上手，建议按“窄一点、能解释”的原则，不要一上来开很大网格。

建议：

- `rsi.period`
  先放 1 到 2 个值，例如 `[5, 7]`

- `rsi.oversold / overbought`
  先放 2 到 3 组，例如 `[32, 35]` / `[65, 68]`

- `macd.fastPeriod / slowPeriod / signalPeriod`
  先放 2 组快慢节奏

- `risk.maxHoldMinutes`
  先放 2 到 3 个持仓时长，不要太多

- `atr.slMultiplier / tpMultiplier`
  先放 2 组止损止盈力度

- `lotSize`
  先固定一个值，等候选池跑通后再扩

- `tradingSchedule`
  用 cron 风格字符串控制允许交易的 UTC 时段

### 第一次不建议做的事

- 不要同时混很多策略家族
- 不要把参数范围开得太大
- 不要还没训练就先写 router

## Step 3：跑训练

推荐命令：

```bash
docker compose run --rm train sh -lc "npm install && npm run build && npm run train -- configs/training/2026_btcjpy_my_run.json"
```

训练完成后，核心结果会进入：

- 数据库表 `backtest_results`
- 数据库表 `strategies`

其中：

- `backtest_results` 保存全部候选结果
- `strategies` 会保存 TopN 策略

## Step 4：把 Top 策略导出成验证配置

训练跑完后，下一步通常不是直接写 router，而是先做未来期验证。

最省事的做法是用现有脚本生成验证配置和 Top 策略快照。

示例：

```bash
docker compose run --rm train sh -lc "npm install && node scripts/generate-top3-validation-configs.js \
  --trainConfig=$(pwd)/configs/training/2026_btcjpy_my_run.json \
  --symbol=BTCJPY \
  --sourceTable=btcjpy_my_run_train_2026 \
  --outPrefix=2026_btcjpy_top10_exact_from_my_run \
  --strategyPrefix=2026-BTCJPY-VAL- \
  --descriptionPrefix='2026 BTCJPY validation' \
  --limit=10 \
  --exact=true"
```

跑完后通常会得到：

- `train/configs/validation/2026_btcjpy_top10_exact_from_my_run_2024_validation.json`
- `train/configs/validation/2026_btcjpy_top10_exact_from_my_run_2026_validation.json`
- `train/configs/top-strategies/2026_btcjpy_top10_exact_from_my_run_top10.generated.json`

### 参数说明

- `sourceTable`
  填训练配置里的 `database.tableName`

- `outPrefix`
  这次验证配置文件和快照文件的前缀

- `limit`
  要导出多少个 Top 策略

- `exact=true`
  表示验证配置里写入显式策略列表，最适合复验

## Step 5：跑未来期验证

拿到验证配置后，直接跑：

```bash
docker compose run --rm train sh -lc "npm install && npm run build && npm run validate -- configs/validation/2026_btcjpy_top10_exact_from_my_run_2026_validation.json"
```

这一步主要会把未来期候选池结果也写进：

- 数据库表 `backtest_results`

## Step 6：补跑两个推荐审计

### A. 成本敏感度

看这组策略是不是只在“无成本世界”里赚钱：

```bash
docker compose run --rm train sh -lc "npm install && npm run build && npm run report:cost-sensitivity -- --config configs/validation/2026_btcjpy_top10_exact_from_my_run_2026_validation.json"
```

产物：

- `train/reports/cost-sensitivity/*.md`
- `train/reports/cost-sensitivity/*.json`

### B. 因果特征审计

看“开盘后前 N 分钟特征”能不能近似全天研究特征：

```bash
docker compose run --rm train sh -lc "npm install && npm run build && npm run audit:causal-features -- --symbol BTCJPY --start 2026-01-01 --end 2026-03-31 --openingMinutes 60"
```

产物：

- `train/reports/feature-causality/*.md`
- `train/reports/feature-causality/*.json`

## Step 7：什么时候开始做 router / policy catalog

满足下面条件后，再进入 router 阶段比较合适：

- 候选池已经跑通
- Top 策略有明显差异
- 未来期验证已经有基础结果
- 你已经知道最差周、最差日大概在哪里

这时再根据：

- `train/METHODOLOGY.md`
- `train/PLAYBOOK.md`

去补：

- `train/configs/generated/regime-routing/<SYMBOL>_<router>.json`
- `train/configs/generated/regime-routing/<SYMBOL>_<router>.policy.json`

## Step 8：跑 router 验证

当你已经有：

- 一个验证配置
- 一个 router 文件

就可以跑 router 验证：

```bash
docker compose run --rm train sh -lc "npm install && npm run build && node dist/scripts/router-validate.js \
  --validation configs/validation/2026_btcjpy_top10_exact_from_my_run_2026_validation.json \
  --router configs/generated/regime-routing/BTCJPY_my_router.json"
```

产物：

- `train/reports/regime-routing-results/*.md`
- `train/reports/regime-routing-results/*.json`

## 最短上手路径

如果你只想先跑通一次，按这个顺序就够了：

1. 新建训练配置
2. 跑训练
3. 生成验证配置
4. 跑未来期验证
5. 跑成本敏感度
6. 跑因果特征审计

这时你已经有：

- 候选池结果
- Top 策略快照
- 验证配置
- 成本报告
- 因果特征报告

等这些都看顺眼了，再进入 router / policy catalog。

## 常见问题

### 1. 为什么训练后没有自动生成验证 JSON 文件

因为训练主命令当前主要负责：

- 跑候选池
- 保存结果到数据库
- 保存 Top 策略到 `strategies`

验证 JSON 需要你手动生成，或者用 `generate-top3-validation-configs.js` 生成。

### 2. 为什么我现在还没有 router / policy 文件

因为 router 不是训练自动产物。

它通常是在：

- 训练结果
- 验证结果
- 最差周 / 最差日分析

这些都出来之后，按方法论文档继续迭代生成的。

### 3. 第一次参数该开多大

建议只开“小而有差异”的网格。

经验上第一次控制在几十到一两百个组合，比一上来几千个组合更容易看懂。

## 一句话总结

第一次上手时，不要追求“一步到 router”。

先跑通：

**训练配置 -> 候选池训练 -> 验证配置 -> 未来期验证 -> 成本/因果审计**

等这些结果看明白了，再进入 router 和 policy system 阶段。
