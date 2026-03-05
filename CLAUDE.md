# CLAUDE.md - USD/JPY 交易模拟系统开发指南

> 本文档为 Claude AI 助手提供项目结构、技术栈和开发规范的完整指南。

## 📋 项目概览

这是一个**全栈外汇交易模拟和回测系统**，支持 K 线可视化、技术指标分析、交易模拟和自动化策略训练。

**核心功能：**
- 实时 K 线回放与交易模拟
- 技术指标（RSI、MACD）计算和可视化
- 完整的风险管理系统（止损、止盈、持仓时间）
- 自动化策略回测和评分
- 历史交易记录和统计分析

**技术栈：**
- **前端**: React 19 + Vite + TradingView Lightweight Charts
- **后端**: Node.js 22 + Express + MySQL 8.0
- **训练**: 策略回测引擎（参数空间搜索）
- **部署**: Docker Compose（全容器化）

---

## 🏗️ 项目架构

### 架构图

```
┌─────────────────────────────────────────────────────────┐
│                   Docker Compose 环境                     │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   │
│  │  Frontend   │   │   Backend   │   │    Train    │   │
│  │  (Vite)     │──▶│  (Express)  │   │  (回测引擎)  │   │
│  │  :5173      │   │  :3001      │   │  (一次性)    │   │
│  └─────────────┘   └──────┬──────┘   └──────┬──────┘   │
│                            │                  │           │
│                    ┌───────▼──────────────────▼──────┐   │
│                    │      MySQL 8.0 (:3306)          │   │
│                    │      ┌──────────────────┐       │   │
│                    │      │  klines (K线)    │       │   │
│                    │      │  trades (交易)   │       │   │
│                    │      │  strategies(策略)│       │   │
│                    │      └──────────────────┘       │   │
│                    └─────────────────────────────────┘   │
│                                                           │
│  ┌─────────────┐                                         │
│  │  Adminer    │                                         │
│  │  :8080      │  (数据库管理界面)                       │
│  └─────────────┘                                         │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

### 三层架构

1. **Frontend Layer** ([frontend/](frontend/))
   - React SPA，提供交互式 K 线图表和交易面板
   - TradingView Lightweight Charts 渲染 K 线、RSI、MACD
   - 支持逐分钟回放历史数据

2. **Backend Layer** ([backend/](backend/))
   - Express REST API
   - 提供 K 线数据、交易记录、策略管理接口
   - 支持从 GMO Coin API 导入历史数据

3. **Training Layer** ([train/](train/))
   - 独立的策略回测引擎
   - 生成数千个参数组合，并行回测
   - 评分排名，保存 Top N 策略

---

## 📁 项目结构

```
money/
├── backend/                    # Express 后端 API
│   ├── server.js              # 主服务器入口（端口 3001）
│   ├── config/
│   │   └── database.js        # MySQL 连接池配置
│   ├── routes/                # API 路由
│   │   ├── klines.js          # K 线数据 CRUD
│   │   ├── trades.js          # 交易记录 CRUD + 统计
│   │   ├── strategies.js      # 策略管理 CRUD
│   │   └── import.js          # GMO Coin API 数据导入
│   ├── sql/
│   │   ├── init.sql           # 数据库初始化脚本 ⭐
│   │   ├── add-indicator-fields.sql
│   │   └── fix-charset.sql
│   ├── scripts/               # 辅助脚本
│   ├── Dockerfile             # 后端容器镜像
│   └── package.json
│
├── frontend/                   # Vite React 前端
│   ├── src/
│   │   ├── App.jsx            # 主应用入口
│   │   ├── main.jsx           # Vite 入口
│   │   ├── pages/             # 页面组件
│   │   │   ├── SimulatorPage.jsx    # 交易模拟器 ⭐
│   │   │   ├── ReplayPage.jsx       # 历史回放
│   │   │   ├── DataImportPage.jsx   # 数据导入界面
│   │   │   └── StrategyPage.jsx     # 策略管理
│   │   ├── components/        # React 组件
│   │   │   ├── ChartComponent.jsx   # K 线图表 ⭐
│   │   │   ├── TradingPanel.jsx     # 交易面板
│   │   │   ├── PlaybackControls.jsx # 回放控制
│   │   │   └── TabNavigation.jsx
│   │   ├── api/
│   │   │   └── api.js         # Axios HTTP 客户端 ⭐
│   │   ├── utils/
│   │   │   └── indicators.js  # RSI/MACD 计算 ⭐
│   │   ├── services/
│   │   │   └── playbackService.js
│   │   └── hooks/
│   │       └── usePlaybackControl.js
│   ├── vite.config.js
│   └── package.json
│
├── train/                      # 策略训练引擎（TypeScript）
│   ├── src/                   # TypeScript 源码
│   │   ├── scripts/           # 执行脚本
│   │   │   ├── train.ts       # 通用训练/验证入口 ⭐
│   │   │   ├── save-top3-strategies.ts
│   │   │   ├── init-db.ts     # 数据库初始化
│   │   │   ├── _common.ts     # 共享工具函数
│   │   │   └── _config.ts     # 配置加载器
│   │   ├── services/          # 核心业务逻辑
│   │   │   ├── strategy-executor.ts  # 策略执行引擎 ⭐
│   │   │   ├── strategy-parameter-generator.ts  # 参数生成器 ⭐
│   │   │   ├── signal-generator.ts
│   │   │   └── indicators/    # 指标计算
│   │   ├── types/             # TypeScript 类型定义
│   │   ├── configs/           # 配置管理
│   │   └── database/          # 数据库 DDL
│   ├── configs/               # JSON 配置文件 ⭐
│   │   ├── training/          # 训练配置（年度 + 滚动窗口）
│   │   │   ├── 2024_atr.json
│   │   │   ├── 2025_atr.json
│   │   │   └── 2025_01_rolling.json  # 14个滚动窗口配置
│   │   └── validation/        # 验证配置（年度 + 滚动窗口）
│   │       ├── 2024_atr_2025_validation.json
│   │       └── 2025_01_rolling_2025_01_validation.json
│   ├── dist/                  # 编译输出
│   ├── README.md              # 完整文档
│   ├── QUICK_START.md         # 快速开始指南
│   ├── tsconfig.json          # TypeScript 配置
│   └── package.json
│
├── data/                       # 原始数据文件（CSV 等）
├── docker-compose.yml          # Docker Compose 配置 ⭐
├── README.md                   # 用户文档
└── CLAUDE.md                   # 本文件（AI 开发指南）
```

**⭐ 标记的文件是开发时最常修改的核心文件**

---

## 🗄️ 数据库设计

### 表结构（[backend/sql/init.sql](backend/sql/init.sql)）

#### 1. `klines` - K 线数据表

```sql
CREATE TABLE klines (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    open_time BIGINT NOT NULL,           -- Unix 时间戳（毫秒）
    open DECIMAL(10, 5),                 -- 开盘价
    high DECIMAL(10, 5),                 -- 最高价
    low DECIMAL(10, 5),                  -- 最低价
    close DECIMAL(10, 5),                -- 收盘价
    volume DECIMAL(20, 8),               -- 成交量
    symbol VARCHAR(20) DEFAULT 'USDJPY', -- 交易对
    interval_type VARCHAR(10) DEFAULT '1m', -- 时间间隔
    UNIQUE KEY unique_kline (symbol, interval_type, open_time),
    INDEX idx_open_time (open_time),
    INDEX idx_symbol_time (symbol, open_time)
);
```

**字段说明：**
- `open_time`: 毫秒级时间戳（UTC），用于精确回放
- `symbol`: 支持扩展到其他交易对
- `interval_type`: `1m`, `5m`, `1h`, `1d` 等

#### 2. `trades` - 交易记录表

```sql
CREATE TABLE trades (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- 入场信息
    direction ENUM('long', 'short'),     -- 做多/做空
    entry_time BIGINT,                   -- 入场时间（毫秒戳）
    entry_price DECIMAL(10, 5),          -- 入场价格
    entry_index INT,                     -- 入场时的 K 线索引

    -- 风控参数
    lot_size DECIMAL(10, 2),             -- 仓位大小（手数）
    hold_minutes INT,                    -- 预设持仓时间（分钟）
    stop_loss DECIMAL(10, 5),            -- 止损价格
    take_profit DECIMAL(10, 5),          -- 止盈价格

    -- 出场信息
    exit_time BIGINT,                    -- 出场时间
    exit_price DECIMAL(10, 5),           -- 出场价格
    exit_reason ENUM('stop_loss', 'take_profit', 'hold_time_reached', 'manual'),

    -- 统计结果
    pnl DECIMAL(10, 2),                  -- 损益（USD）
    pips DECIMAL(10, 2),                 -- 点数
    percent DECIMAL(10, 4),              -- 收益率（%）
    actual_hold_minutes INT,             -- 实际持仓时间

    -- 技术指标（入场时和出场时）
    entry_rsi DECIMAL(6,2),
    entry_macd DECIMAL(10,5),
    entry_macd_signal DECIMAL(10,5),
    entry_macd_histogram DECIMAL(10,5),
    exit_rsi DECIMAL(6,2),
    exit_macd DECIMAL(10,5),
    exit_macd_signal DECIMAL(10,5),
    exit_macd_histogram DECIMAL(10,5),

    -- 元数据
    strategy_name VARCHAR(100),          -- 关联策略名称
    notes TEXT,                          -- 备注
    symbol VARCHAR(20) DEFAULT 'USDJPY',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_direction (direction),
    INDEX idx_entry_time (entry_time),
    INDEX idx_strategy (strategy_name)
);
```

**核心字段：**
- `direction`: 决定止损/止盈的计算方向
- `exit_reason`: 用于分析策略行为
- 指标字段：记录进出场时的 RSI、MACD 值，用于后续分析

#### 3. `strategies` - 策略配置表

```sql
CREATE TABLE strategies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,   -- 策略唯一标识
    description TEXT,                    -- 策略描述
    parameters JSON,                     -- 策略参数（JSON 格式）⭐
    is_active BOOLEAN DEFAULT TRUE,      -- 是否启用
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**parameters JSON 结构示例：**
```json
{
  "type": "rsi_and_macd",
  "rsi": { "period": 14, "oversold": 30, "overbought": 70 },
  "macd": { "fastPeriod": 12, "slowPeriod": 26, "signalPeriod": 9 },
  "risk": {
    "stopLossPercent": 0.2,
    "takeProfitPercent": 0.5,
    "maxHoldMinutes": 120,
    "lotSize": 0.1
  }
}
```

---

## 🔌 API 接口文档

### Base URL
- **开发环境**: `http://localhost:3001/api`
- **容器内部**: `http://api:3001/api`

### K 线数据接口 ([backend/routes/klines.js](backend/routes/klines.js))

#### GET `/api/klines`
获取 K 线数据（支持时间范围和限制）

**Query 参数：**
```javascript
{
  symbol: 'USDJPY',          // 交易对（默认 USDJPY）
  interval: '1m',            // 时间间隔（默认 1m）
  start: 1735801200000,      // 起始时间（毫秒戳，可选）
  end: 1735887600000,        // 结束时间（毫秒戳，可选）
  limit: 1000                // 限制数量（默认 1000）
}
```

**响应示例：**
```json
{
  "success": true,
  "count": 1000,
  "data": [
    {
      "id": 12345,
      "openTime": 1735801200000,
      "open": "157.450",
      "high": "157.500",
      "low": "157.420",
      "close": "157.480",
      "volume": "1234.56",
      "symbol": "USDJPY",
      "intervalType": "1m"
    }
  ]
}
```

#### GET `/api/klines/stats`
获取 K 线数据统计（按交易对和间隔分组）

**响应示例：**
```json
{
  "success": true,
  "data": [
    {
      "symbol": "USDJPY",
      "interval_type": "1m",
      "count": 50000,
      "earliest": 1704067200000,
      "latest": 1735689540000
    }
  ]
}
```

#### POST `/api/klines/bulk`
批量插入 K 线数据（用于导入）

**请求体：**
```json
{
  "symbol": "USDJPY",
  "interval": "1m",
  "data": [
    { "openTime": 1735801200000, "open": 157.45, "high": 157.50, ... }
  ]
}
```

### 交易记录接口 ([backend/routes/trades.js](backend/routes/trades.js))

#### GET `/api/trades`
获取交易列表（支持分页和筛选）

**Query 参数：**
```javascript
{
  direction: 'long',         // 筛选方向（可选）
  strategy_name: 'RSI_30',   // 筛选策略（可选）
  limit: 50,                 // 每页数量（默认 50）
  offset: 0                  // 偏移量（默认 0）
}
```

#### POST `/api/trades`
创建交易记录

**请求体：**
```json
{
  "direction": "long",
  "entry_time": 1735801200000,
  "entry_price": 157.45,
  "entry_index": 100,
  "lot_size": 0.1,
  "hold_minutes": 60,
  "stop_loss": 157.30,
  "take_profit": 157.75,
  "exit_time": 1735804800000,
  "exit_price": 157.68,
  "exit_reason": "take_profit",
  "pnl": 23.00,
  "pips": 23,
  "percent": 0.146,
  "entry_rsi": 35.2,
  "entry_macd": -0.015,
  "strategy_name": "RSI_MACD_V1"
}
```

#### GET `/api/trades/stats/summary`
获取交易统计摘要

**响应示例：**
```json
{
  "success": true,
  "data": {
    "total_trades": 150,
    "winning_trades": 90,
    "losing_trades": 60,
    "win_rate": 60.00,
    "total_pnl": 1234.56,
    "avg_pnl": 8.23,
    "max_profit": 150.00,
    "max_loss": -80.00,
    "long_trades": 75,
    "short_trades": 75
  }
}
```

### 数据导入接口 ([backend/routes/import.js](backend/routes/import.js))

#### POST `/api/import/gmocoin`
从 GMO Coin API 导入历史 K 线数据

**请求体：**
```json
{
  "symbol": "USD_JPY",       // GMO 格式（下划线）
  "interval": "1min",        // GMO 格式: 1min, 5min, 1hour, 1day
  "priceType": "BID",        // BID 或 ASK
  "startDate": "20250101",   // YYYYMMDD
  "endDate": "20250105"
}
```

**功能特性：**
- 自动将日期范围切分为单日批次（GMO API 限制）
- 重试机制（最多 3 次）
- 自动转换时间戳（GMT → UTC 毫秒）
- 分批插入数据库（避免内存溢出）

---

## 🎨 前端开发指南

### 技术指标计算 ([frontend/src/utils/indicators.js](frontend/src/utils/indicators.js))

#### RSI (Relative Strength Index)

```javascript
import { calculateRSI } from '@/utils/indicators';

// 计算 RSI（默认周期 14）
const rsiData = calculateRSI(klineData, 14);

// 返回格式
[
  { time: 1735801200, value: 35.2 },
  { time: 1735801260, value: 38.5 },
  ...
]
```

**算法：**
1. 计算价格变化：`delta = close[i] - close[i-1]`
2. 分离涨跌：`gain = max(delta, 0)`, `loss = -min(delta, 0)`
3. 计算平均涨跌：使用 Wilder 平滑法
4. 计算 RS：`RS = avgGain / avgLoss`
5. 计算 RSI：`RSI = 100 - (100 / (1 + RS))`

**交易信号：**
- RSI < 30：超卖（买入信号）
- RSI > 70：超买（卖出信号）

#### MACD (Moving Average Convergence Divergence)

```javascript
import { calculateMACD } from '@/utils/indicators';

// 计算 MACD（默认 12, 26, 9）
const macdData = calculateMACD(klineData, 12, 26, 9);

// 返回格式
{
  macd: [{ time: 1735801200, value: -0.015 }, ...],
  signal: [{ time: 1735801200, value: -0.020 }, ...],
  histogram: [
    { time: 1735801200, value: 0.005, color: '#26a69a' },
    ...
  ]
}
```

**算法：**
1. 计算快线 EMA(12) 和慢线 EMA(26)
2. MACD 线（DIF）= EMA(12) - EMA(26)
3. 信号线（DEA）= MACD 的 EMA(9)
4. 柱状图（HISTOGRAM）= MACD - 信号线

**颜色编码：**
- 深绿 `#26a69a`: 柱子 > 0 且增大（强势上涨）
- 浅绿 `#4ecdc4`: 柱子 > 0 且减小（上涨减弱）
- 深红 `#ef5350`: 柱子 < 0 且减小（强势下跌）
- 浅红 `#ff7675`: 柱子 < 0 且增大（下跌减弱）

### 核心组件

#### ChartComponent - K 线图表

**使用示例：**
```jsx
import ChartComponent from '@/components/ChartComponent';

<ChartComponent
  data={klineData}           // K 线数据数组
  rsiData={rsiData}          // RSI 数据
  macdData={macdData}        // MACD 数据
  currentIndex={100}         // 当前回放位置
  entryPrice={157.45}        // 入场价格（显示水平线）
  stopLoss={157.30}          // 止损价格（虚线）
  takeProfit={157.75}        // 止盈价格（虚线）
  direction="long"           // 交易方向
/>
```

**布局结构：**
```
┌─────────────────────────────┐
│   K 线蜡烛图（800px）        │ ← 主图表
│   - 入场价格线（实线）        │
│   - 止损/止盈线（虚线）       │
├─────────────────────────────┤
│   RSI 指标（120px）          │ ← 副图 1
│   - 超买线（70）             │
│   - 超卖线（30）             │
├─────────────────────────────┤
│   MACD 柱状图（120px）       │ ← 副图 2
│   - MACD 线                 │
│   - 信号线                   │
└─────────────────────────────┘
```

#### TradingPanel - 交易面板

**功能：**
- 选择交易方向（做多/做空）
- 设置入场价格（当前价或自定义）
- 配置止损/止盈（点数或百分比）
- 设置持仓时间
- 显示实时价格和指标值

**关键逻辑：**
```javascript
// 止损价格计算
const stopLossPrice = direction === 'long'
  ? entryPrice - (stopLossPips * 0.01)
  : entryPrice + (stopLossPips * 0.01);

// 止盈价格计算
const takeProfitPrice = direction === 'long'
  ? entryPrice + (takeProfitPips * 0.01)
  : entryPrice - (takeProfitPips * 0.01);

// USD/JPY: 1 pip = 0.01
```

### 页面流程

#### SimulatorPage - 交易模拟器

**用户流程：**
```
1. 加载数据
   用户选择日期范围 → 调用 klinesAPI.getKlines() → 显示 K 线图

2. 配置交易
   设置方向/止损/止盈/持仓时间 → 实时显示计算结果

3. 开始回放
   点击"播放"按钮 → 逐根 K 线回放 → 检查触发条件

4. 自动平仓
   触发止损/止盈/时间到期 → 计算损益 → 保存到数据库

5. 查看结果
   显示交易摘要 → 可跳转到 ReplayPage 查看详情
```

**检查触发逻辑（每根 K 线）：**
```javascript
// 1. 检查止损
if (direction === 'long' && currentLow <= stopLoss) {
  exitPrice = stopLoss;
  exitReason = 'stop_loss';
}

// 2. 检查止盈
if (direction === 'long' && currentHigh >= takeProfit) {
  exitPrice = takeProfit;
  exitReason = 'take_profit';
}

// 3. 检查持仓时间
if (elapsedMinutes >= holdMinutes) {
  exitPrice = currentClose;
  exitReason = 'hold_time_reached';
}
```

---

## 🤖 训练引擎开发指南

### 核心服务：[train/backtest-training-service.js](train/backtest-training-service.js)

#### 回测流程

```javascript
// 1. 创建结果表
await ensureBacktestTable('backtest_results_2025');

// 2. 加载 K 线数据
const klines = await loadKlines({
  symbol: 'USDJPY',
  intervalType: '1m',
  startTimeMs: 1735801200000,
  endTimeMs: 1767225540000
});

// 3. 生成策略组合
const strategies = generateStrategyCombinations({ limit: 1000 });

// 4. 批量执行策略
for (const strategy of strategies) {
  const executor = new StrategyExecutor(strategy, klines);
  const result = await executor.execute();

  // 5. 保存结果
  await saveBacktestResult('backtest_results_2025', result);
}

// 6. 查询 Top N 策略
const topStrategies = await queryTopStrategies('backtest_results_2025', 10);

// 7. 重跑并保存详情
await rerunAndSaveStrategies(topStrategies, klines);
```

### 策略参数空间 ([train/services/strategy-parameter-generator.js](train/services/strategy-parameter-generator.js))

```javascript
const PARAMETER_SPACE = {
  // RSI 参数
  rsi: {
    period: [14],                    // 固定 14 周期
    oversold: [20, 25, 30],          // 3 种超卖线
    overbought: [70, 75, 80]         // 3 种超买线
  },

  // MACD 参数
  macd: {
    fastPeriod: [12],                // 固定
    slowPeriod: [26],                // 固定
    signalPeriod: [9]                // 固定
  },

  // 网格策略参数
  grid: {
    levels: [5, 10, 20],             // 3 种层数
    rangePercent: [0.5, 1, 2],       // 3 种范围
    profitPerGrid: [0.1, 0.2, 0.3]   // 3 种利润
  },

  // 风控参数
  risk: {
    stopLossPercent: [null, 0.1, 0.15, 0.2, 0.25, 0.3],  // 6 种
    takeProfitPercent: [null, 0.2, 0.3, 0.5, 0.7, 1.0, 1.5],  // 7 种
    maxHoldMinutes: [30, 60, 120, 180, 240, 360, 480, 720],  // 8 种
    lotSize: [0.1],                  // 固定 0.1 手
    maxPositions: [1]                // 固定 1 个持仓
  },

  // 策略类型
  types: [
    'grid_only',       // 纯网格
    'rsi_only',        // 纯 RSI
    'macd_only',       // 纯 MACD
    'rsi_and_macd',    // RSI 且 MACD（AND）
    'rsi_or_macd'      // RSI 或 MACD（OR）
  ]
};

// 理论组合数 = 3×3×3×3×3×6×7×8×5 = 约 40 万种
// 实际可设置 limit 限制生成数量
```

### 策略执行器 ([train/services/strategy-executor.js](train/services/strategy-executor.js))

**执行逻辑：**
```javascript
for (let i = 0; i < klines.length; i++) {
  const currentKline = klines[i];

  // 1. 检查现有持仓是否需要平仓
  for (const position of openPositions) {
    // 检查止损
    if (hitStopLoss(position, currentKline)) {
      closePosition(position, 'stop_loss');
    }
    // 检查止盈
    if (hitTakeProfit(position, currentKline)) {
      closePosition(position, 'take_profit');
    }
    // 检查持仓时间
    if (exceededHoldTime(position, currentKline)) {
      closePosition(position, 'hold_time_reached');
    }
  }

  // 2. 检查是否可以开仓
  if (openPositions.length < maxPositions) {
    // 生成信号
    const signal = generateSignal(strategy, klines, i);

    // 根据信号开仓
    if (signal.direction) {
      openPosition({
        direction: signal.direction,
        entryPrice: currentKline.close,
        entryTime: currentKline.openTime,
        entryRsi: signal.rsi,
        entryMacd: signal.macd,
        // ... 其他参数
      });
    }
  }
}

// 3. 强制平仓剩余持仓
for (const position of openPositions) {
  closePosition(position, 'end_of_data');
}

// 4. 计算统计指标
return {
  totalTrades,
  winningTrades,
  losingTrades,
  winRate,
  totalPnl,
  sharpeRatio,
  maxDrawdown,
  score: (totalPnl * winRate * sharpeRatio) / (maxDrawdown + 1)
};
```

### 配置文件驱动

所有配置文件位于 `train/configs/` 目录，只有两个标准目录：

**training/** - 训练配置
- `2024_atr.json` - 2024年度训练
- `2025_atr.json` - 2025年度训练
- `2025_01_rolling.json` - 滚动窗口训练（14个月）

**validation/** - 验证配置
- `2024_atr_2025_validation.json` - 年度验证
- `2025_01_rolling_2025_01_validation.json` - 滚动窗口验证（14个月）

**示例配置** ([train/configs/training/2025_atr.json](train/configs/training/2025_atr.json)):

```json
{
  "name": "2025_ATR_TRAIN",
  "description": "2025年全年数据训练",
  "timeRange": {
    "startTimeMs": 1735801200000,
    "endTimeMs": 1767225540000,
    "startIso": "2025-01-01T00:00:00Z",
    "endIso": "2025-12-31T23:59:00Z"
  },
  "market": {
    "symbol": "USDJPY",
    "intervalType": "1min"
  },
  "database": {
    "tableName": "backtest_results_2025_atr"
  },
  "strategy": {
    "types": ["rsi_only"],
    "parameters": { /* 150+ 组合 */ }
  }
}
```

### 使用命令（统一格式）

```bash
# 训练命令（TYPE/NAME 格式，不含 .json）
make train CONFIG=training/2024_atr           # 年度训练
make train CONFIG=training/2025_01_rolling    # 滚动窗口训练

# 验证命令
make validate CONFIG=validation/2024_atr_2025_validation
make validate CONFIG=validation/2025_01_rolling_2025_01_validation

# 保存最佳策略
make save-top3

# 数据库初始化
make db-init
```

---

## 🚀 开发工作流

### 启动开发环境

```bash
# 1. 启动所有服务
docker-compose up -d

# 2. 查看日志
docker-compose logs -f api      # 查看后端日志
docker-compose logs -f frontend # 查看前端日志

# 3. 访问服务
# - 前端: http://localhost:5173
# - 后端 API: http://localhost:3001/api
# - Adminer: http://localhost:8080
#   (系统: MySQL, 服务器: mysql, 用户: trader, 密码: traderpass)

# 4. 停止服务
docker-compose down
```

### 数据导入流程

```bash
# 方法 1: 使用前端界面
访问 http://localhost:5173 → DataImportPage → 填写参数 → 点击导入

# 方法 2: 使用 API 直接调用
curl -X POST http://localhost:3001/api/import/gmocoin \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "USD_JPY",
    "interval": "1min",
    "priceType": "BID",
    "startDate": "20250101",
    "endDate": "20250105"
  }'

# 方法 3: 使用后端脚本（如果有）
docker-compose exec api npm run import
```

### 策略训练流程（简化版）

```bash
# 1. 初始化数据库（首次运行）
make db-init

# 2. 年度训练
make train CONFIG=training/2024_atr
make train CONFIG=training/2025_atr

# 3. 验证策略
make validate CONFIG=validation/2024_atr_2025_validation
make validate CONFIG=validation/2024_atr_2026_validation

# 4. 保存最佳策略
make save-top3

# 滚动窗口训练（可选）
make train CONFIG=training/2025_01_rolling
make train CONFIG=training/2025_02_rolling
# ... 或使用批量脚本

# 滚动窗口验证
make validate CONFIG=validation/2025_01_rolling_2025_01_validation
```

**优势**:
- 统一的 `TYPE/NAME` 格式
- 自动编译 TypeScript
- 自动安装依赖
- 清晰的命令语义

### 调试技巧

#### 后端调试

```bash
# 进入后端容器
docker-compose exec api sh

# 手动测试 API
curl http://localhost:3001/api/klines/stats

# 查看数据库
docker-compose exec mysql mysql -u trader -ptraderpass trading -e "SELECT COUNT(*) FROM klines;"
```

#### 前端调试

```bash
# 进入前端容器
docker-compose exec frontend sh

# 重新安装依赖（如果需要）
npm install

# 查看 Vite 配置
cat vite.config.js
```

#### 数据库调试

```bash
# 使用 Adminer（推荐）
访问 http://localhost:8080

# 使用命令行
docker-compose exec mysql mysql -u trader -ptraderpass trading

# 常用 SQL
SELECT symbol, interval_type, COUNT(*) FROM klines GROUP BY symbol, interval_type;
SELECT direction, COUNT(*), AVG(pnl) FROM trades GROUP BY direction;
SELECT * FROM strategies WHERE is_active = TRUE;
```

---

## 📐 开发规范

### 代码风格

1. **JavaScript/Node.js**
   - 使用 ES6+ 语法
   - async/await 优于 Promise 链
   - 错误处理：try-catch + 返回 JSON 错误
   - 变量命名：camelCase
   - 常量命名：UPPER_SNAKE_CASE

2. **React/JSX**
   - 使用函数组件 + Hooks
   - 组件命名：PascalCase
   - Props 解构
   - 使用 `useEffect` 处理副作用
   - 使用 `useState` 管理本地状态

3. **SQL**
   - 表名：小写下划线（如 `klines`, `trades`）
   - 字段名：小写下划线（如 `entry_time`, `exit_reason`）
   - 使用参数化查询（防止 SQL 注入）

### Git 提交规范

```bash
# 功能开发
git commit -m "feat: 添加网格策略信号生成器"

# Bug 修复
git commit -m "fix: 修复 MACD 计算中的除零错误"

# 文档更新
git commit -m "docs: 更新 CLAUDE.md 中的 API 文档"

# 性能优化
git commit -m "perf: 优化回测执行器的内存使用"

# 重构
git commit -m "refactor: 重构策略参数生成器为配置驱动"
```

### 文件命名

- **组件文件**: `PascalCase.jsx`（如 `TradingPanel.jsx`）
- **工具函数**: `camelCase.js`（如 `indicators.js`）
- **服务类**: `kebab-case.js`（如 `strategy-executor.js`）
- **配置文件**: `kebab-case.json`（如 `training-2025.json`）

---

## 🛠️ 常见开发任务

### 任务 1: 添加新的技术指标

**步骤：**

1. **前端 - 添加指标计算函数** ([frontend/src/utils/indicators.js](frontend/src/utils/indicators.js))
   ```javascript
   export function calculateBollingerBands(data, period = 20, stdDev = 2) {
     // 1. 计算移动平均（中轨）
     const sma = calculateSMA(data, period);

     // 2. 计算标准差
     const stdDevValues = /* ... */;

     // 3. 计算上下轨
     return {
       upper: sma.map((s, i) => s.value + stdDev * stdDevValues[i]),
       middle: sma,
       lower: sma.map((s, i) => s.value - stdDev * stdDevValues[i])
     };
   }
   ```

2. **前端 - 在 ChartComponent 中显示**
   - 添加新的图表面板或覆盖到主图
   - 使用 `chart.addLineSeries()` 绘制上下轨

3. **后端 - 添加字段到 trades 表**
   ```sql
   ALTER TABLE trades
   ADD COLUMN entry_bb_upper DECIMAL(10,5),
   ADD COLUMN entry_bb_lower DECIMAL(10,5);
   ```

4. **训练 - 添加到信号生成器** ([train/services/signal-generator.js](train/services/signal-generator.js))
   ```javascript
   const bb = calculateBollingerBands(klines.slice(0, i+1));
   if (currentPrice < bb.lower) {
     signal.direction = 'long';  // 价格触及下轨，买入
   }
   ```

### 任务 2: 添加新的策略类型

**步骤：**

1. **训练 - 扩展参数空间** ([train/services/strategy-parameter-generator.js](train/services/strategy-parameter-generator.js))
   ```javascript
   const PARAMETER_SPACE = {
     // ... 现有参数
     bollingerBands: {
       period: [20],
       stdDev: [2, 2.5, 3]
     },
     types: [
       // ... 现有类型
       'bb_mean_reversion',  // 新类型：布林带均值回归
     ]
   };
   ```

2. **训练 - 实现信号生成逻辑** ([train/services/signal-generator.js](train/services/signal-generator.js))
   ```javascript
   if (strategy.type === 'bb_mean_reversion') {
     const bb = calculateBollingerBands(/* ... */);
     if (price < bb.lower) return { direction: 'long' };
     if (price > bb.upper) return { direction: 'short' };
   }
   ```

3. **运行回测并验证**
   ```bash
   docker compose run --rm train npm run backtest -- -- --config 2025 --limit 100
   ```

### 任务 3: 优化回测性能

**性能瓶颈分析：**
- 策略数量：1000+
- K 线数量：50,000+（1 个月的 1 分钟数据）
- 单次回测时间：约 1-5 秒
- 总耗时：1000 × 3 秒 = 50 分钟

**优化方案：**

1. **分组并行执行** ([train/scripts/group-backtest.js](train/scripts/group-backtest.js))
   ```bash
   # 10 个进程并行（每个处理 100 个策略）
   docker compose run --rm train npm run group:run -- -- --group 1 --groups 10
   ```

2. **减少数据库写入频率**
   ```javascript
   // 批量插入而非逐条插入
   await batchInsert(results, 100);  // 每 100 条写入一次
   ```

3. **使用内存缓存 K 线数据**
   ```javascript
   // 避免每个策略重新加载 K 线
   const klines = await loadKlines(/* ... */);  // 只加载一次
   for (const strategy of strategies) {
     executor = new StrategyExecutor(strategy, klines);  // 复用
   }
   ```

---

## 🔒 安全注意事项

### 数据库安���

1. **生产环境必须修改默认密码**
   ```yaml
   # docker-compose.yml
   environment:
     MYSQL_ROOT_PASSWORD: <strong-password>  # 修改此处
     MYSQL_PASSWORD: <strong-password>       # 修改此处
   ```

2. **使用环境变量**
   ```bash
   # backend/.env
   DB_HOST=mysql
   DB_USER=trader
   DB_PASSWORD=${DB_PASSWORD}  # 从环境变量读取
   ```

3. **限制数据库访问**
   ```yaml
   # 仅在内部网络暴露
   mysql:
     ports: []  # 移除端口映射
   ```

### API 安全

1. **参数验证**
   ```javascript
   // backend/routes/klines.js
   app.get('/api/klines', (req, res) => {
     const { symbol, limit } = req.query;
     if (!['USDJPY', 'EURUSD'].includes(symbol)) {
       return res.status(400).json({ error: 'Invalid symbol' });
     }
     if (limit > 10000) {
       return res.status(400).json({ error: 'Limit too large' });
     }
     // ...
   });
   ```

2. **使用参数化查询**
   ```javascript
   // ❌ 不安全
   const query = `SELECT * FROM klines WHERE symbol = '${symbol}'`;

   // ✅ 安全
   const query = 'SELECT * FROM klines WHERE symbol = ?';
   await pool.query(query, [symbol]);
   ```

3. **添加 CORS 限制**
   ```javascript
   // backend/server.js
   app.use(cors({
     origin: ['http://localhost:5173', 'https://yourdomain.com']
   }));
   ```

---

## 📊 性能监控

### 关键指标

1. **K 线数据量**
   ```sql
   SELECT
     symbol,
     interval_type,
     COUNT(*) as total,
     MIN(open_time) as earliest,
     MAX(open_time) as latest
   FROM klines
   GROUP BY symbol, interval_type;
   ```

2. **交易统计**
   ```sql
   SELECT
     COUNT(*) as total_trades,
     AVG(pnl) as avg_pnl,
     SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) / COUNT(*) * 100 as win_rate
   FROM trades;
   ```

3. **策略排名**
   ```sql
   SELECT
     name,
     parameters->>'$.type' as type,
     is_active
   FROM strategies
   ORDER BY created_at DESC
   LIMIT 10;
   ```

### 数据库优化

```sql
-- 1. 检查索引使用情况
EXPLAIN SELECT * FROM klines WHERE symbol = 'USDJPY' AND open_time > 1735801200000;

-- 2. 添加复合索引
CREATE INDEX idx_symbol_interval_time ON klines(symbol, interval_type, open_time);

-- 3. 清理旧数据
DELETE FROM trades WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
```

---

## 🐛 故障排查

### 常见问题

#### 问题 1: 前端无法连接后端

**症状：**
```
Failed to fetch: http://localhost:3001/api/klines
```

**检查步骤：**
```bash
# 1. 检查后端容器是否运行
docker-compose ps api

# 2. 检查后端日志
docker-compose logs api

# 3. 测试后端 API
curl http://localhost:3001/api/klines/stats

# 4. 检查前端环境变量
docker-compose exec frontend env | grep VITE
```

**解决方案：**
- 确保 `docker-compose.yml` 中 `api` 服务的 `ports` 正确映射
- 检查 `frontend/vite.config.js` 中的 proxy 配置

#### 问题 2: MySQL 容器启动失败

**症状：**
```
ERROR 2002 (HY000): Can't connect to MySQL server on 'mysql'
```

**检查步骤：**
```bash
# 1. 查看 MySQL 日志
docker-compose logs mysql

# 2. 检查数据卷
docker volume ls | grep mysql

# 3. 等待 healthcheck 通过
docker-compose ps mysql
# 状态应显示 "healthy"
```

**解决方案：**
```bash
# 删除旧数据卷并重新创建
docker-compose down -v
docker-compose up -d mysql
```

#### 问题 3: 回测训练卡住

**症状：**
```
Backtesting strategy 1/1000... (长时间无响应)
```

**检查步骤：**
```bash
# 1. 检查 K 线数据量
docker-compose exec mysql mysql -u trader -ptraderpass trading -e \
  "SELECT COUNT(*) FROM klines WHERE symbol='USDJPY' AND interval_type='1m';"

# 2. 检查容器资源使用
docker stats money-train

# 3. 查看训练日志
docker-compose logs train
```

**解决方案：**
- 减少策略数量：`--limit 100`
- 减少 K 线范围：修改配置文件中的 `startTimeMs` 和 `endTimeMs`
- 增加容器内存限制

---

## 📚 参考资源

### 技术文档

- [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/)
- [Express.js 官方文档](https://expressjs.com/)
- [React Hooks 参考](https://react.dev/reference/react)
- [MySQL 8.0 参考手册](https://dev.mysql.com/doc/refman/8.0/en/)

### 交易和技术分析

- [Investopedia - RSI](https://www.investopedia.com/terms/r/rsi.asp)
- [Investopedia - MACD](https://www.investopedia.com/terms/m/macd.asp)
- [TradingView - 技术指标库](https://www.tradingview.com/scripts/)

### GMO Coin API

- [GMO Coin Public API](https://api.coin.z.com/docs/)
- K 线数据端点：`GET /public/v1/klines`

---

## 🎯 开发路线图

### Phase 1: 基础功能（已完成）
- [x] K 线数据管理（导入、存储、查询）
- [x] 交易模拟器（回放、止损止盈）
- [x] RSI 和 MACD 指标
- [x] 交易记录和统计
- [x] Docker 容器化部署

### Phase 2: 策略训练（已完成）
- [x] 策略参数生成器
- [x] 回测执行引擎
- [x] 评分和排名系统
- [x] 配置文件驱动
- [x] 并行回测优化

### Phase 3: 功能增强（待开发）
- [ ] 添加更多技术指标（布林带、ATR、移动平均等）
- [ ] 多交易对支持（EURUSD、GBPUSD 等）
- [ ] 实时数据流接入（WebSocket）
- [ ] 用户认证和多账户支持
- [ ] 策略性能对比图表
- [ ] 风险管理面板（最大回撤、夏普比率图表）

### Phase 4: 生产优化（规划中）
- [ ] 前端性能优化（虚拟滚动、数据分页）
- [ ] 后端缓存层（Redis）
- [ ] 数据库读写分离
- [ ] 日志聚合和监控（ELK Stack）
- [ ] CI/CD 流水线
- [ ] Kubernetes 部署配置

---

## 💡 最佳实践

### 开发工作流

1. **小步迭代**
   - 每次只修改一个功能
   - 频繁提交代码（每个小功能一次）
   - 编写清晰的提交信息

2. **测试驱动**
   - 修改代码前先手动测试现有功能
   - 添加新功能后立即测试
   - 使用 Adminer 验证数据库变更

3. **文档同步**
   - 修改 API 时同步更新本文档
   - 添加新配置时添加注释
   - 复杂逻辑添加代码注释

### 代码审查检查清单

- [ ] 参数验证（防止非法输入）
- [ ] 错误处理（try-catch + 有意义的错误信息）
- [ ] SQL 注入防护（使用参数化查询）
- [ ] 内存泄漏检查（关闭数据库连接、清理定时器）
- [ ] 日志记录（关键操作和错误）
- [ ] 性能影响（避免 N+1 查询、使用索引）

### 数据管理

1. **定期备份**
   ```bash
   # 导出数据库
   docker-compose exec mysql mysqldump -u trader -ptraderpass trading > backup.sql

   # 恢复数据库
   docker-compose exec -T mysql mysql -u trader -ptraderpass trading < backup.sql
   ```

2. **数据清理策略**
   - 回测结果表：保留最近 7 天
   - 交易记录：保留所有（用于长期分析）
   - K 线数据：保留最近 1 年

3. **数据验证**
   ```sql
   -- 检查 K 线数据完整性
   SELECT
     DATE(FROM_UNIXTIME(open_time/1000)) as date,
     COUNT(*) as count
   FROM klines
   WHERE symbol = 'USDJPY' AND interval_type = '1m'
   GROUP BY date
   ORDER BY date;
   -- 预期：每天约 1440 条（24小时 × 60分钟）
   ```

---

## 🎓 学习资源

### 新手入门

如果您是 Claude AI 且是首次接触本项目，建议按以下顺序学习：

1. **理解项目结构**（15 分钟）
   - 阅读本文档的"项目架构"和"项目结构"部分
   - 浏览 [docker-compose.yml](docker-compose.yml) 了解服务组成

2. **运行项目**（10 分钟）
   ```bash
   docker-compose up -d
   # 访问 http://localhost:5173
   # 尝试导入样本数据并回放
   ```

3. **阅读核心代码**（30 分钟）
   - [backend/sql/init.sql](backend/sql/init.sql) - 数据库设计
   - [frontend/src/utils/indicators.js](frontend/src/utils/indicators.js) - 指标计算
   - [train/backtest-training-service.js](train/backtest-training-service.js) - 回测逻辑

4. **实践修改**（30 分钟）
   - 修改一个参数（如 RSI 超卖线从 30 改为 25）
   - 观察前端和回测结果的变化
   - 提交一个测试 commit

### 进阶学习

- **深入理解技术指标**：阅读 Investopedia 上的 RSI、MACD、布林带文章
- **策略优化**：学习过拟合、前向验证、Walk-Forward Analysis
- **性能优化**：研究 Node.js 异步编程、数据库索引优化
- **Docker 进阶**：学习多阶段构建、资源限制、健康检查

---

## 📞 支持和联系

### 问题反馈

如果遇到问题，请按以下顺序排查：

1. 查阅本文档的"故障排查"部分
2. 检查容器日志（`docker-compose logs <service>`）
3. 搜索已知问题（GitHub Issues）
4. 提交新 Issue（提供详细的错误信息和复现步骤）

### 贡献指南

欢迎贡献代码！提交 PR 前请确保：

1. 代码符合项目规范
2. 通过本地测试
3. 更新相关文档
4. 提供清晰的 PR 描述

---

## 🔄 版本历史

- **v1.0.0** (2025-01-03)
  - 初始版本
  - 基础交易模拟功能
  - RSI 和 MACD 指标
  - Docker 容器化部署

- **v1.1.0** (2025-02-15)
  - 添加策略训练引擎
  - 支持并行回测
  - 配置文件驱动
  - 添加 GMO Coin API 导入

- **v1.2.0** (当前)
  - 完善文档（CLAUDE.md）
  - 优化数据库索引
  - 添加更多查询脚本
  - 改进前端 UI

---

**最后更新**: 2025-03-05
**维护者**: 项目开发团队
**许可证**: MIT
