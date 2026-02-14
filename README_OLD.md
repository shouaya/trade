# GMO Coin 数据拉取与交易模拟器

这个项目用于从 GMO Coin 拉取 FX 市场的历史数据，并提供交易模拟回测功能。

## 功能特性

### 数据拉取
- 拉取 USD/JPY (美元日元) 货币对的 1分钟 K线数据
- 支持自定义日期范围（2025年至今）
- 自动保存为 JSON 和 CSV 两种格式
- 智能请求频率控制，避免 API 限流

### 交易模拟器（CLI）
- 🎯 回到过去任意时刻进行交易模拟
- 📊 支持做多/做空双向交易
- ⛔ 智能止损触发检测
- 🎯 智能止盈触发检测
- 💰 精确计算损益（美元、点数、百分比）
- 📈 批量回测多个交易策略
- 📋 完整的交易统计分析（胜率、盈亏比等）

### 可视化界面（Web UI）
- 🖥️ 基于 React + TradingView Lightweight Charts
- 📊 专业级 K 线图表实时渲染
- ⏯️ 时间回放控制（可调速 0.5x - 10x）
- 🎮 交互式交易面板
- 📈 实时交易状态监控
- 💹 交易标记可视化（入场/出场/止损/止盈）
- 🎯 自动检测止损止盈触发

## 安装依赖

```bash
npm install
```

## 快速开始

**第一次使用？查看 [快速开始指南 →](QUICKSTART.md)**

### 1. 安装依赖并获取数据

```bash
npm install
cd frontend && npm install && cd ..  # 安装前端依赖
npm run fetch:sample  # 拉取最近3天的示例数据
```

### 2. 启动可视化界面（推荐）

```bash
npm run ui  # 启动 Web UI
```

然后打开浏览器访问：http://localhost:5173

### 3. 或使用命令行工具

```bash
npm run trade  # 交互式命令行工具
npm run demo   # 查看使用示例
```

## 文档导航

- 📖 [README.md](README.md) - 项目总览（本文件）
- 🚀 [QUICKSTART.md](QUICKSTART.md) - 5分钟快速上手
- 📊 [TRADING_SIMULATOR.md](TRADING_SIMULATOR.md) - 交易模拟器详细说明
- 🏗️ [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) - 项目结构和开发指南

## 使用方法

### 数据拉取

#### 1. 拉取完整数据

运行以下命令拉取从 2025-01-01 到今天的所有 1分钟 K线数据：

```bash
npm run fetch
```

或者直接运行：

```bash
node fetch-gmocoin-data.js
```

#### 2. 拉取示例数据

拉取最近3天的数据用于测试：

```bash
npm run fetch:sample
```

#### 3. 测试 API 连接

测试 API 是否正常工作：

```bash
npm run fetch:test
```

### 交易模拟器

#### 1. 交互式命令行工具

运行交互式交易模拟器：

```bash
npm run trade
```

功能包括：
- 📝 手动输入交易参数（入场时间、方向、止损止盈等）
- ⚡ 快速交易模式（快速设置交易）
- 💾 保存交易历史记录

#### 2. 查看使用示例

```bash
npm run demo        # 运行所有示例
npm run demo:1      # 示例1: 简单的做多交易
npm run demo:2      # 示例2: 带止损止盈的做空交易
npm run demo:3      # 示例3: 触发止损的交易
npm run demo:4      # 示例4: 批量回测多个交易
```

#### 3. 编程方式使用

```javascript
const { TradingSimulator } = require('./trading-simulator');
const fs = require('fs');

// 加载数据
const klineData = JSON.parse(fs.readFileSync('./data/sample_data.json', 'utf8'));
const simulator = new TradingSimulator(klineData);

// 执行交易模拟
const result = simulator.simulateTrade({
  entryTime: '2025-02-06T08:00:00.000Z',  // 入场时间
  direction: 'long',                       // 做多
  holdMinutes: 60,                         // 持仓60分钟
  stopLoss: 151.5,                         // 止损价格
  takeProfit: 153.0,                       // 止盈价格
  lotSize: 1                               // 1手
});

console.log(result);
```

### 交易参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `entryTime` | String/Number | ✅ | 入场时间（ISO 8601 或 Unix 时间戳） |
| `direction` | String | ✅ | 交易方向：`'long'`（做多）或 `'short'`（做空） |
| `holdMinutes` | Number | ✅ | 持仓时间（分钟） |
| `entryPrice` | Number | ❌ | 入场价格（不填则使用实际收盘价） |
| `stopLoss` | Number | ❌ | 止损价格 |
| `takeProfit` | Number | ❌ | 止盈价格 |
| `lotSize` | Number | ❌ | 仓位大小（手数），默认1手 |

### 交易结果说明

模拟器会返回详细的交易结果：

```javascript
{
  success: true,
  entry: {
    time: 1738789200000,                    // 入场时间戳
    datetime: '2025-02-06T08:00:00.000Z',   // 入场时间
    price: 152.499,                         // 入场价格
    direction: 'long'                       // 交易方向
  },
  exit: {
    time: 1738792800000,                    // 出场时间戳
    datetime: '2025-02-06T09:00:00.000Z',   // 出场时间
    price: 152.569,                         // 出场价格
    reason: 'hold_time_reached'             // 出场原因
  },
  result: {
    pnl: 70,                                // 损益（美元）
    pnlPips: 7,                             // 损益（点数）
    pnlPercent: 0.0459,                     // 损益（百分比）
    holdMinutes: 60,                        // 实际持仓时间
    lotSize: 1                              // 仓位大小
  }
}
```

### 出场原因

| 原因 | 说明 |
|------|------|
| `hold_time_reached` | ⏰ 到达持仓时间，正常平仓 |
| `stop_loss` | ⛔ 触发止损，提前退出 |
| `take_profit` | 🎯 触发止盈，提前退出 |

### 批量回测

```javascript
const trades = [
  { entryTime: '2025-02-06T08:00:00.000Z', direction: 'long', holdMinutes: 60, ... },
  { entryTime: '2025-02-06T12:00:00.000Z', direction: 'short', holdMinutes: 90, ... },
  // ... 更多交易
];

const backtest = simulator.backtestMultiple(trades);

// backtest.statistics 包含：
// - totalTrades: 总交易数
// - winCount: 盈利次数
// - lossCount: 亏损次数
// - winRate: 胜率（%）
// - totalPnL: 总损益
// - avgWin: 平均盈利
// - avgLoss: 平均亏损
// - profitFactor: 盈亏比
```

## 数据格式

### JSON 格式

每条 K线数据包含以下字段：

```json
{
  "openTime": "1738789200000",
  "open": "152.602",
  "high": "152.608",
  "low": "152.589",
  "close": "152.589"
}
```

- `openTime`: 开盘时间（Unix 时间戳，毫秒）
- `open`: 开盘价
- `high`: 最高价
- `low`: 最低价
- `close`: 收盘价

### CSV 格式

CSV 文件包含表头和数据行：

```csv
timestamp,datetime,open,high,low,close
1738789200000,2025-02-06T07:00:00.000Z,152.602,152.608,152.589,152.589
```

## 数据说明

### 时间范围

- **起始日期**: 2025-01-01
- **结束日期**: 今天
- **数据频率**: 1分钟

### 交易时间

- 外汇市场是 24 小时交易的，每天通常有 1440 条 1分钟数据（24小时 × 60分钟）
- 周末和节假日可能没有交易数据

### API 限制

根据 GMO Coin API 文档：
- 1分钟级别的数据仅从 **2023-10-28** 开始提供
- 数据每天 **JST 06:00** (日本标准时间早上6点) 更新
- 脚本已内置请求频率控制（每10个请求休息1秒）

## 输出文件

数据会保存在 `data` 目录下：

- `usdjpy_1min_20250101_YYYYMMDD_bid.json` - JSON 格式数据
- `usdjpy_1min_20250101_YYYYMMDD_bid.csv` - CSV 格式数据

其中 `YYYYMMDD` 是实际的结束日期。

## 配置选项

可以在 [fetch-gmocoin-data.js](fetch-gmocoin-data.js) 文件顶部修改以下配置：

```javascript
const SYMBOL = 'USD_JPY';        // 交易对
const INTERVAL = '1min';         // 时间间隔
const PRICE_TYPE = 'BID';        // 价格类型: BID 或 ASK
```

### 可用时间间隔

- `1min`, `5min`, `10min`, `15min`, `30min`, `1hour` (需要 YYYYMMDD 日期格式)
- `4hour`, `8hour`, `12hour`, `1day`, `1week`, `1month` (需要 YYYY 日期格式)

### 可用交易对

- `USD_JPY` (美元/日元)
- `EUR_JPY` (欧元/日元)
- 其他外汇对（请参考 GMO Coin API 文档）

## API 文档

- GMO Coin Forex API: https://api.coin.z.com/fxdocs/en/

## 注意事项

1. 请合理使用 API，避免过于频繁的请求
2. 如果遇到请求失败，脚本会自动跳过并继续
3. 建议在非高峰时段运行脚本以获得更好的性能
4. 首次运行可能需要较长时间（取决于日期范围）

## 许可证

ISC
