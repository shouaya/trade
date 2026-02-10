# 快速开始指南

## 5分钟快速上手

### 第一步：安装依赖

```bash
npm install
```

### 第二步：获取数据

```bash
npm run fetch:sample
```

这会拉取最近3天的数据（约4000条），用时约5秒。

### 第三步：运行示例

```bash
npm run demo:1
```

你会看到类似这样的输出：

```
======================================================================
📍 入场信息:
   时间: 2025-02-06T08:00:00.000Z
   方向: 做多 📈
   价格: 152.499

🚪 出场信息:
   时间: 2025-02-06T09:00:00.000Z
   价格: 152.569
   原因: ⏰ 到达持仓时间
   持仓: 60 分钟 (预期 60 分钟)

💰 交易结果:
   ✅ 损益: $70 (+0.0459%)
   点数: +7 pips
   仓位: 1 手
======================================================================
```

恭喜！你已经完成了第一次交易模拟！

## 尝试交互式工具

```bash
npm run trade
```

按照提示输入交易参数，体验完整的交易模拟流程。

## 示例说明

### 示例 1：简单做多
```bash
npm run demo:1
```
- 不设止损止盈
- 到时间自动平仓

### 示例 2：带止损止盈的做空
```bash
npm run demo:2
```
- 设置止损和止盈
- 展示风险管理

### 示例 3：触发止损
```bash
npm run demo:3
```
- 演示止损如何保护你的资金

### 示例 4：批量回测
```bash
npm run demo:4
```
- 测试多个交易
- 查看统计数据

## 交易参数简明指南

| 参数 | 说明 | 示例 |
|------|------|------|
| 入场时间 | 开始交易的时间 | `2025-02-06T08:00:00.000Z` |
| 方向 | `long`（做多）或 `short`（做空） | `long` |
| 持仓时间 | 多少分钟后平仓 | `60` |
| 止损 | 亏损到这个价格就退出 | `151.5` |
| 止盈 | 盈利到这个价格就退出 | `153.0` |
| 仓位 | 交易多少手 | `1` |

## 做多 vs 做空

### 做多（Long）
- 预期价格会**上涨**
- 低买高卖
- 止损应该设在**入场价格下方**
- 止盈应该设在**入场价格上方**

**示例**：
```javascript
{
  direction: 'long',
  entryPrice: 152.0,
  stopLoss: 151.5,    // 比入场价低
  takeProfit: 153.0   // 比入场价高
}
```

### 做空（Short）
- 预期价格会**下跌**
- 高卖低买
- 止损应该设在**入场价格上方**
- 止盈应该设在**入场价格下方**

**示例**：
```javascript
{
  direction: 'short',
  entryPrice: 152.0,
  stopLoss: 152.5,    // 比入场价高
  takeProfit: 151.0   // 比入场价低
}
```

## 常见问题

### Q: 为什么我的交易失败了？
A: 检查以下几点：
1. 入场时间是否在数据范围内
2. 持仓时间是否太长（超出数据范围）
3. 止损止盈设置是否合理

### Q: 如何查看数据的时间范围？
A: 运行交互式工具 `npm run trade`，它会自动显示数据的时间范围。

### Q: 如何获取更多数据？
A: 运行 `npm run fetch` 获取 2025 年至今的所有数据（需要较长时间）。

### Q: 损益是如何计算的？
A:
- 1 pip = 0.01（对于 USD/JPY）
- 1 标准手 = $10/pip
- 损益 = 点数 × $10 × 手数

**示例**：
```
做多 1 手
入场：152.00
出场：152.10
点数：+10 pips
损益：10 × $10 × 1 = $100
```

### Q: 为什么实际交易可能有差异？
A: 模拟器未考虑：
1. 滑点（实际成交价与预期价的差异）
2. 手续费和点差
3. 流动性问题
4. 市场急剧波动

## 进阶使用

### 1. 编程方式使用

创建文件 `my-test.js`：

```javascript
const fs = require('fs');
const { TradingSimulator } = require('./trading-simulator');

// 加载数据
const data = JSON.parse(fs.readFileSync('./data/sample_data.json', 'utf8'));
const simulator = new TradingSimulator(data);

// 执行交易
const result = simulator.simulateTrade({
  entryTime: '2025-02-06T08:00:00.000Z',
  direction: 'long',
  holdMinutes: 60,
  stopLoss: 151.5,
  takeProfit: 153.0,
  lotSize: 1
});

console.log(`损益: $${result.result.pnl}`);
```

运行：
```bash
node my-test.js
```

### 2. 批量测试策略

```javascript
const trades = [];

// 测试每天早上8点做多
for (let hour = 8; hour <= 16; hour++) {
  trades.push({
    entryTime: `2025-02-06T${String(hour).padStart(2, '0')}:00:00.000Z`,
    direction: 'long',
    holdMinutes: 60,
    lotSize: 1
  });
}

const results = simulator.backtestMultiple(trades);
console.log(results.statistics);
```

## 下一步

1. 阅读 [README.md](README.md) 了解完整功能
2. 查看 [TRADING_SIMULATOR.md](TRADING_SIMULATOR.md) 了解原理
3. 浏览 [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) 了解架构

## 技巧和最佳实践

### 1. 风险回报比
建议设置止盈是止损的 2-3 倍：
```javascript
{
  stopLoss: 151.5,     // 风险：50 pips
  takeProfit: 153.0    // 回报：100 pips
}
// 风险回报比 = 1:2
```

### 2. 测试不同时间段
```javascript
// 早上
entryTime: '2025-02-06T08:00:00.000Z'

// 下午
entryTime: '2025-02-06T14:00:00.000Z'

// 晚上
entryTime: '2025-02-06T20:00:00.000Z'
```

### 3. 测试不同持仓时间
```javascript
// 超短线
holdMinutes: 15

// 短线
holdMinutes: 60

// 中线
holdMinutes: 240
```

## 资源链接

- [GMO Coin API 文档](https://api.coin.z.com/fxdocs/en/)
- [USD/JPY 外汇知识](https://www.investopedia.com/terms/forex/u/usd-jpy-us-dollar-japanese-yen-currency-pair.asp)

---

祝你交易愉快！如有问题，请查阅完整文档。📈💰
