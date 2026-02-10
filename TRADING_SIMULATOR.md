# 交易模拟器详细说明

## 核心功能

交易模拟器允许你回到过去任意时刻，模拟执行交易策略，并计算实际的损益结果。

## 工作原理

### 1. 入场逻辑

- 输入入场时间（可以是任意历史时刻）
- 选择交易方向（做多或做空）
- 设置入场价格（可选，不填则使用当时的实际收盘价）

### 2. 持仓监控

模拟器会从入场时刻开始，逐根 K线检查以下条件：

#### 做多（Long）交易
- **止损触发**：如果价格下跌到或低于止损价格
- **止盈触发**：如果价格上涨到或高于止盈价格
- **时间到期**：如果到达预设的持仓时间

#### 做空（Short）交易
- **止损触发**：如果价格上涨到或高于止损价格
- **止盈触发**：如果价格下跌到或低于止盈价格
- **时间到期**：如果到达预设的持仓时间

### 3. 触发优先级

在每根 K线内，模拟器会先检查 `high` 和 `low` 来判断：

**做多交易**：
1. 先检查 `low` 是否触发止损（价格可能先下跌）
2. 再检查 `high` 是否触发止盈（价格可能后上涨）

**做空交易**：
1. 先检查 `high` 是否触发止损（价格可能先上涨）
2. 再检查 `low` 是否触发止盈（价格可能后下跌）

这确保了模拟的真实性，因为止损通常比止盈更重要。

### 4. 损益计算

#### USD/JPY 点数计算
- 1 pip = 0.01
- 例如：从 152.50 到 152.60 = 10 pips

#### 损益计算公式

**做多**：
```
价格差 = 出场价格 - 入场价格
点数 = 价格差 × 100
损益 = 点数 × 每点价值 × 手数
```

**做空**：
```
价格差 = 入场价格 - 出场价格
点数 = 价格差 × 100
损益 = 点数 × 每点价值 × 手数
```

其中：
- 标准手（1 lot）= 100,000 单位货币
- USD/JPY 每点价值 = $10（标准手）

#### 示例

假设做多 1 手 USD/JPY：
- 入场价格：152.50
- 出场价格：152.60
- 价格差：0.10
- 点数：10 pips
- 损益：10 × $10 × 1 = **$100**

## 使用场景

### 场景 1：测试止损止盈设置

```javascript
const trade = {
  entryTime: '2025-02-06T08:00:00.000Z',
  direction: 'long',
  entryPrice: 152.0,
  holdMinutes: 120,
  stopLoss: 151.5,     // 50 pips 止损
  takeProfit: 153.0,   // 100 pips 止盈
  lotSize: 1
};
```

**目的**：测试 1:2 的风险回报比是否有效。

### 场景 2：测试持仓时间策略

```javascript
const trade = {
  entryTime: '2025-02-06T08:00:00.000Z',
  direction: 'long',
  holdMinutes: 60,     // 只持仓1小时
  lotSize: 1
};
```

**目的**：测试短线交易策略，不设置止损止盈，到时间就平仓。

### 场景 3：批量回测策略

```javascript
// 测试"每天早上8点做多，持仓2小时"的策略
const trades = [];
for (let day = 6; day <= 10; day++) {
  trades.push({
    entryTime: `2025-02-0${day}T08:00:00.000Z`,
    direction: 'long',
    holdMinutes: 120,
    stopLoss: 151.0,
    takeProfit: 154.0,
    lotSize: 1
  });
}

const backtest = simulator.backtestMultiple(trades);
console.log(backtest.statistics);
```

**目的**：测试固定时间入场策略的效果。

### 场景 4：风险管理测试

```javascript
// 测试不同止损距离的影响
const stopLossTests = [10, 20, 30, 50].map(pips => ({
  entryTime: '2025-02-06T08:00:00.000Z',
  direction: 'long',
  entryPrice: 152.0,
  holdMinutes: 180,
  stopLoss: 152.0 - (pips / 100),
  takeProfit: 152.0 + (pips * 2 / 100),  // 1:2 风险回报比
  lotSize: 1
}));

const results = simulator.backtestMultiple(stopLossTests);
```

**目的**：找到最优的止损距离。

## 统计指标说明

### 胜率（Win Rate）
```
胜率 = (盈利交易数 / 总交易数) × 100%
```

### 盈亏比（Profit Factor）
```
盈亏比 = 总盈利金额 / 总亏损金额
```

- 盈亏比 > 1：整体盈利
- 盈亏比 = 1：盈亏平衡
- 盈亏比 < 1：整体亏损

### 平均盈利/平均亏损
```
平均盈利 = 总盈利金额 / 盈利交易数
平均亏损 = 总亏损金额 / 亏损交易数
```

### 期望值（Expected Value）
```
期望值 = (胜率 × 平均盈利) - ((1 - 胜率) × 平均亏损)
```

如果期望值 > 0，说明策略长期来看是盈利的。

## 注意事项

### 1. 数据质量
- 模拟器的准确性依赖于历史数据的质量
- 1分钟 K线数据可能无法完全反映真实的价格波动
- 建议使用较小的止损止盈距离时格外小心

### 2. 滑点和手续费
- 当前版本未考虑滑点（Slippage）
- 未扣除交易手续费和点差
- 实际交易结果可能会有差异

### 3. 市场环境
- 历史表现不代表未来结果
- 不同市场环境下，同一策略可能有完全不同的表现
- 建议在多个时间段进行回测

### 4. 过度拟合
- 避免过度优化参数来适应历史数据
- 使用样本外数据验证策略的有效性
- 保持策略的简单性和鲁棒性

## 高级用法

### 自定义交易策略

你可以基于 `TradingSimulator` 类开发自己的策略回测系统：

```javascript
const { TradingSimulator } = require('./trading-simulator');

class MyStrategy {
  constructor(simulator) {
    this.simulator = simulator;
  }

  // 基于移动平均线的策略示例
  findEntrySignals(klineData, period = 20) {
    const signals = [];

    for (let i = period; i < klineData.length - 120; i++) {
      // 计算简单移动平均线
      const ma = this.calculateMA(klineData, i, period);
      const currentPrice = parseFloat(klineData[i].close);

      // 价格突破均线 = 做多信号
      if (currentPrice > ma) {
        signals.push({
          entryTime: parseInt(klineData[i].openTime),
          direction: 'long',
          holdMinutes: 60,
          stopLoss: currentPrice - 0.3,
          takeProfit: currentPrice + 0.6,
          lotSize: 1
        });
      }
    }

    return signals;
  }

  calculateMA(data, index, period) {
    let sum = 0;
    for (let i = index - period; i < index; i++) {
      sum += parseFloat(data[i].close);
    }
    return sum / period;
  }

  backtest(klineData) {
    const signals = this.findEntrySignals(klineData);
    return this.simulator.backtestMultiple(signals);
  }
}

// 使用自定义策略
const klineData = require('./data/sample_data.json');
const simulator = new TradingSimulator(klineData);
const strategy = new MyStrategy(simulator);
const results = strategy.backtest(klineData);

console.log(results.statistics);
```

## 实际应用建议

1. **先测试，后实战**：在真实交易前充分回测
2. **保守估计**：考虑滑点和手续费的影响
3. **风险控制**：使用合理的止损和仓位管理
4. **持续优化**：定期评估和调整策略
5. **情绪管理**：模拟器可以帮助你建立对策略的信心

## 技术支持

如有问题或建议，请参考：
- [README.md](README.md) - 项目总览
- [demo.js](demo.js) - 使用示例
- [trading-simulator.js](trading-simulator.js) - 核心代码

祝交易顺利！ 📈💰
