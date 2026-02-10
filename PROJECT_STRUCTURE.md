# 项目结构说明

```
money/
├── README.md                    # 项目总览和使用说明
├── TRADING_SIMULATOR.md         # 交易模拟器详细说明
├── PROJECT_STRUCTURE.md         # 本文件 - 项目结构说明
├── package.json                 # 项目配置和依赖
├── .gitignore                   # Git 忽略文件配置
│
├── 数据拉取相关文件
│   ├── fetch-gmocoin-data.js   # 主数据拉取脚本（2025-今天）
│   ├── fetch-sample.js         # 示例数据拉取脚本（最近3天）
│   └── test-fetch.js           # API 连接测试脚本
│
├── 交易模拟器相关文件
│   ├── trading-simulator.js    # 核心模拟器类
│   ├── trade-cli.js            # 交互式命令行工具
│   └── demo.js                 # 使用示例和演示
│
└── data/                        # 数据目录
    ├── sample_data.json        # 示例数据（最近3天）
    ├── usdjpy_1min_*.json      # 完整历史数据
    ├── usdjpy_1min_*.csv       # CSV 格式数据
    └── trade_history.json      # 交易历史记录
```

## 文件说明

### 核心文件

#### `trading-simulator.js`
交易模拟器核心类，包含：
- `TradingSimulator` 类：主模拟器
- `simulateTrade()` 方法：单个交易模拟
- `backtestMultiple()` 方法：批量回测
- `calculatePnL()` 方法：损益计算
- 辅助函数：结果格式化输出

**主要功能**：
- 解析和索引 K线数据
- 检测止损止盈触发
- 计算交易损益
- 生成回测统计

#### `trade-cli.js`
交互式命令行工具，提供：
- 数据文件选择界面
- 交易参数输入界面
- 手动模式：完全自定义交易参数
- 快速模式：快速设置交易
- 交易记录保存功能

**使用方式**：
```bash
npm run trade
```

#### `demo.js`
使用示例脚本，包含4个示例：
1. 简单的做多交易（无止损止盈）
2. 带止损止盈的做空交易
3. 触发止损的交易示例
4. 批量回测多个交易

**使用方式**：
```bash
npm run demo        # 运行所有示例
npm run demo:1      # 运行示例1
npm run demo:2      # 运行示例2
npm run demo:3      # 运行示例3
npm run demo:4      # 运行示例4
```

### 数据拉取文件

#### `fetch-gmocoin-data.js`
完整的数据拉取脚本，功能：
- 拉取从 2025-01-01 到今天的所有数据
- 自动生成日期范围
- 请求频率控制（防止 API 限流）
- 同时保存 JSON 和 CSV 格式
- 详细的进度显示

**配置选项**：
```javascript
const SYMBOL = 'USD_JPY';        // 交易对
const INTERVAL = '1min';         // 时间间隔
const PRICE_TYPE = 'BID';        // BID 或 ASK
```

#### `fetch-sample.js`
示例数据拉取脚本，功能：
- 快速拉取最近3天的数据
- 用于测试和演示
- 显示数据示例

#### `test-fetch.js`
API 连接测试脚本，用于：
- 验证 API 是否正常工作
- 测试单日数据获取
- 查看响应格式

### 数据文件

#### `data/sample_data.json`
示例数据文件，包含：
- 最近3天的 1分钟 K线数据
- 约 4000+ 条数据
- 用于快速测试和演示

#### `data/usdjpy_1min_*.json`
完整历史数据文件，包含：
- 2025 年至今的所有数据
- 约 400+ 天的数据
- 每天约 1440 条数据（24小时 × 60分钟）

#### `data/usdjpy_1min_*.csv`
CSV 格式数据文件，包含：
- 与 JSON 文件相同的数据
- 方便在 Excel 中分析
- 格式：timestamp, datetime, open, high, low, close

#### `data/trade_history.json`
交易历史记录，包含：
- 通过 CLI 工具执行的交易记录
- 完整的交易参数和结果
- 时间戳标记

## NPM 脚本

在 `package.json` 中定义的便捷脚本：

### 数据拉取
```bash
npm run fetch           # 拉取完整数据（2025-今天）
npm run fetch:sample    # 拉取示例数据（最近3天）
npm run fetch:test      # 测试 API 连接
```

### 交易模拟
```bash
npm run trade           # 启动交互式命令行工具
npm run demo            # 运行所有示例
npm run demo:1          # 运行示例1
npm run demo:2          # 运行示例2
npm run demo:3          # 运行示例3
npm run demo:4          # 运行示例4
```

## 依赖说明

### `axios` (^1.13.5)
- HTTP 客户端
- 用于调用 GMO Coin API
- 支持 Promise 和 async/await

### `readline-sync` (^1.4.10)
- 同步命令行输入工具
- 用于交互式 CLI 工具
- 支持多种输入类型（文本、数字、Yes/No）

## 开发流程

### 1. 首次使用
```bash
# 安装依赖
npm install

# 获取示例数据
npm run fetch:sample

# 运行示例
npm run demo
```

### 2. 数据拉取
```bash
# 测试 API
npm run fetch:test

# 拉取完整数据（需要较长时间）
npm run fetch
```

### 3. 交易模拟
```bash
# 方式1：交互式工具
npm run trade

# 方式2：查看示例
npm run demo:1

# 方式3：编程方式
node
> const { TradingSimulator } = require('./trading-simulator')
> // ... 自定义代码
```

## 扩展开发

### 添加新的交易策略

1. 创建新文件 `strategies/my-strategy.js`
2. 导入 `TradingSimulator`
3. 实现策略逻辑
4. 使用 `backtestMultiple()` 进行回测

示例：
```javascript
const { TradingSimulator } = require('./trading-simulator');
const fs = require('fs');

class MyStrategy {
  constructor(klineData) {
    this.simulator = new TradingSimulator(klineData);
  }

  findSignals() {
    // 实现你的策略逻辑
    return trades;
  }

  backtest() {
    const trades = this.findSignals();
    return this.simulator.backtestMultiple(trades);
  }
}

module.exports = MyStrategy;
```

### 添加新的数据源

1. 创建新文件 `fetch-[source].js`
2. 实现数据获取逻辑
3. 统一数据格式：
```javascript
{
  openTime: "1738789200000",  // Unix 时间戳（毫秒）
  open: "152.602",
  high: "152.608",
  low: "152.589",
  close: "152.589"
}
```

### 添加新的指标

在 `trading-simulator.js` 中添加新方法：
```javascript
class TradingSimulator {
  // 现有方法...

  calculateRSI(period = 14) {
    // 实现 RSI 指标
  }

  calculateMACD() {
    // 实现 MACD 指标
  }
}
```

## 注意事项

1. **数据文件大小**：完整数据文件可能较大（10MB+），建议添加到 `.gitignore`
2. **API 限流**：遵守 GMO Coin API 的使用限制
3. **时区问题**：所有时间使用 UTC（Z），注意转换
4. **浮点数精度**：价格计算使用字符串存储，避免精度问题

## 性能优化

- 数据索引：使用 `Map` 进行 O(1) 时间复杂度查找
- 批量处理：`backtestMultiple()` 方法复用模拟器实例
- 文件缓存：避免重复读取大文件

## 故障排查

### 问题：数据文件不存在
```bash
npm run fetch:sample  # 先获取示例数据
```

### 问题：API 请求失败
```bash
npm run fetch:test    # 测试 API 连接
```

### 问题：交易模拟失败
- 检查入场时间是否在数据范围内
- 确保持仓时间足够短（数据范围内）
- 验证止损止盈价格设置是否合理

## 更新日志

- **2025-02-10**：初始版本发布
  - 实现数据拉取功能
  - 实现交易模拟器
  - 添加交互式 CLI 工具
  - 完成文档编写

## 许可证

ISC
