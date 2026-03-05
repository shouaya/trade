# Database Schema Directory

此目录包含所有数据库表的 DDL 定义。

## 文件结构

```
src/database/
├── index.ts                      # 导出所有 schema
├── backtest-results.schema.ts    # 回测结果表
├── strategies.schema.ts          # 策略配置表
├── trades.schema.ts              # 交易记录表
└── tasks.schema.ts               # 任务管理表
```

## 使用方法

### 1. 导入单个 Schema

```typescript
import { TRADES_DDL } from '../database/trades.schema';

await db.query(TRADES_DDL);
```

### 2. 导入多个 Schema

```typescript
import {
  BACKTEST_RESULTS_DDL,
  STRATEGIES_DDL,
  TRADES_DDL,
  TASKS_DDL
} from '../database';

await db.query(BACKTEST_RESULTS_DDL);
await db.query(STRATEGIES_DDL);
await db.query(TRADES_DDL);
await db.query(TASKS_DDL);
```

## 表说明

### backtest_results - 回测结果表
存储策略回测的统计结果，包括交易次数、胜率、盈亏、夏普比率等指标。

### strategies - 策略配置表
存储策略的参数配置，支持 JSON 格式存储复杂参数。

### trades - 交易记录表
存储每笔交易的详细信息，包括入场价格、出场价格、止损止盈、技术指标等。

### tasks - 任务管理表
存储训练任务的执行状态，用于任务调度和监控。

## 注意事项

1. 所有 DDL 使用 `CREATE TABLE IF NOT EXISTS` 以避免重复创建
2. 表使用 `InnoDB` 引擎，支持事务和外键
3. 字符集统一使用 `utf8mb4` 以支持 emoji 和特殊字符
4. 所有表都包含适当的索引以优化查询性能
5. klines 表不在此目录中，由 backend 负责创建和维护
