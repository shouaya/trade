# 多策略回测系统使用指南

## 📋 概述

这是一个自动化策略回测系统,可以批量测试数千个策略组合,找出最优交易策略。

系统支持:
- ✅ **5种策略类型**: 网格交易、RSI、MACD及其组合
- ✅ **40,000+策略组合**: 自动生成大量参数组合
- ✅ **完整性能评估**: 胜率、盈亏、夏普比率、最大回撤等
- ✅ **自动保存**: Top 10策略和交易记录自动保存到数据库
- ✅ **实时进度**: 显示执行进度和预计剩余时间

## 🚀 快速开始

### 1. 快速测试 (推荐首次使用)

测试每种策略类型的1个示例,验证系统是否正常:

```bash
cd backend
node scripts/quick-test.js
```

**预计时间**: 10-20秒

---

### 2. 小规模测试

测试前100个策略:

```bash
node scripts/run-multi-strategy-backtest.js 100
```

**预计时间**: 约1分钟

---

### 3. 中等规模测试

测试前1000个策略:

```bash
node scripts/run-multi-strategy-backtest.js 1000
```

**预计时间**: 约8-10分钟

---

### 4. 完整测试

测试所有策略组合 (约40,000个):

```bash
node scripts/run-multi-strategy-backtest.js
```

**预计时间**: 约5-6小时

**建议**: 使用 `nohup` 或 `screen` 在后台运行:

```bash
# 使用 nohup 在后台运行
nohup node scripts/run-multi-strategy-backtest.js > backtest.log 2>&1 &

# 查看进度
tail -f backtest.log

# 查看进程
ps aux | grep "run-multi-strategy-backtest"
```

---

### 5. 测试特定策略类型

只测试特定类型的策略:

```bash
# 只测试RSI策略
node scripts/run-multi-strategy-backtest.js 1000 rsi_only

# 测试RSI和MACD组合策略
node scripts/run-multi-strategy-backtest.js 1000 rsi_and_macd,rsi_or_macd

# 测试网格策略
node scripts/run-multi-strategy-backtest.js 1000 grid_only
```

**可用策略类型**:
- `grid_only` - 纯网格交易
- `rsi_only` - 纯RSI指标
- `macd_only` - 纯MACD指标
- `rsi_and_macd` - RSI且MACD (两者必须同时满足)
- `rsi_or_macd` - RSI或MACD (任一满足即可)

---

## 📊 进度显示

运行时会实时显示:

```
📊 进度: 150/1000 (15.0%) | 已用时: 1.2分 | 剩余: 6.8分 | 速度: 0.48秒/策略
```

- **进度**: 当前进度百分比
- **已用时**: 已经运行的时间
- **剩余**: 预计剩余时间
- **速度**: 平均每个策略的处理时间

---

## 📁 输出结果

### 1. 控制台输出

显示 Top 10 最佳策略:

```
🏆 Top 10 最佳策略:

1. RSI-P14-OS30-OB70-MP5-H240-SL30-TP60
   类型: rsi_only
   交易次数: 123
   胜率: 65.85%
   总盈亏: $2,345.67
   夏普比率: 1.234
   ...
```

### 2. JSON文件

完整结果保存在:
```
backend/backtest-results/backtest-2026-03-03T12-34-56.json
```

包含所有策略的详细统计数据。

### 3. 数据库

Top 10 策略自动保存到数据库:

- **strategies 表**: 策略配置和描述
- **trades 表**: 所有交易记录(包含RSI、MACD值)

---

## 🔍 查看数据库中的结果

```bash
# 查看保存的策略
docker exec money-mysql mysql -uroot -prootpassword trading -e "
  SELECT id, name, description, is_active, created_at
  FROM strategies
  ORDER BY created_at DESC
  LIMIT 10;
"

# 查看某个策略的交易记录
docker exec money-mysql mysql -uroot -prootpassword trading -e "
  SELECT direction, entry_price, exit_price, pnl, exit_reason
  FROM trades
  WHERE strategy_name = 'RSI-P14-OS30-OB70-MP5-H240-SL30-TP60'
  LIMIT 10;
"

# 统计每个策略的交易次数
docker exec money-mysql mysql -uroot -prootpassword trading -e "
  SELECT strategy_name, COUNT(*) as trades, SUM(pnl) as total_pnl
  FROM trades
  GROUP BY strategy_name
  ORDER BY total_pnl DESC;
"
```

---

## ⚙️ 策略参数空间

当前参数配置 (可在 `strategy-parameter-generator.js` 中修改):

### 网格参数
- 网格层数: 5, 10, 20
- 范围百分比: 0.5%, 1%, 2%
- 每格利润: 0.1%, 0.2%, 0.3%

### RSI参数
- 周期: 7, 14, 21
- 超卖阈值: 20, 25, 30
- 超买阈值: 70, 75, 80

### MACD参数
- 快速周期: 8, 12
- 慢速周期: 21, 26
- 信号周期: 7, 9

### 风控参数
- 最大持仓数: 1, 3, 5
- 止损(pips): null, 30, 50
- 止盈(pips): null, 60, 100
- 最大持仓时间: 60分, 240分, 1440分

---

## 📈 评估指标

策略按以下综合评分排序:

```
评分 = (总盈亏 × 胜率 × 夏普比率) / (最大回撤 + 1)
```

其他指标:
- **交易次数**: 总交易数
- **胜率**: 盈利交易 / 总交易
- **总盈亏**: 累计盈亏 (USD)
- **夏普比率**: 风险调整后收益
- **盈利因子**: 总盈利 / 总亏损
- **最大回撤**: 最大资金回撤百分比

---

## 🛠️ 故障排查

### 问题: 没有K线数据

```
❌ 没有找到K线数据,请先导入数据
```

**解决**: 确保已导入 2026/1/2 - 2026/2/28 的1分钟K线数据

### 问题: 数据库连接失败

**解决**: 确保MySQL容器正在运行:
```bash
docker-compose ps
docker-compose up -d money-mysql
```

### 问题: 数据库字段错误

如果看到以下错误:
```
❌ Field 'hold_minutes' doesn't have a default value
❌ Data truncated for column 'exit_reason'
```

**解决**: 运行数据库修复脚本:
```bash
docker exec money-mysql mysql -uroot -prootpassword trading -e "
ALTER TABLE trades
MODIFY COLUMN hold_minutes INT DEFAULT 0,
MODIFY COLUMN exit_reason ENUM('stop_loss','take_profit','hold_time_reached','manual','forced_close') DEFAULT NULL;
" 2>&1 | grep -v "Warning"
```

### 问题: 内存不足

**解决**: 限制策略数量:
```bash
node scripts/run-multi-strategy-backtest.js 100
```

---

## 📝 自定义参数

修改 `backend/services/strategy-parameter-generator.js` 中的 `PARAMETER_SPACE` 对象:

```javascript
const PARAMETER_SPACE = {
  rsi: {
    period: [10, 14, 20],  // 修改这里
    oversold: [25, 30],     // 添加或删除值
    overbought: [70, 75]
  },
  // ...
};
```

修改后重新运行回测脚本。

---

## 🎯 完整使用流程

### 第一步: 确保数据已导入

```bash
# 检查K线数据
docker exec money-mysql mysql -uroot -prootpassword trading -e "
  SELECT COUNT(*) as count,
         MIN(FROM_UNIXTIME(open_time/1000)) as start,
         MAX(FROM_UNIXTIME(open_time/1000)) as end
  FROM klines
  WHERE symbol='USDJPY' AND interval_type='1min';
"
```

应该看到约58,000条数据,时间范围 2026-01-02 到 2026-02-28。

---

### 第二步: 运行快速测试

```bash
cd /Users/ts-changchang.zhuang/git/money/backend
node scripts/quick-test.js
```

等待约2-3分钟,验证系统正常工作。

---

### 第三步: 运行中等规模测试

推荐先测试1000个策略:

```bash
node scripts/run-multi-strategy-backtest.js 1000
```

约10分钟后,会显示Top 10最佳策略。

---

### 第四步: 查看结果

#### 控制台输出

```
🏆 Top 10 最佳策略:

1. RSI-P14-OS30-OB70-MP5-H240-SL30-TP60
   类型: rsi_only
   交易次数: 245
   胜率: 68.16%
   总盈亏: $3,456.78
   夏普比率: 1.567
   ...
```

#### 查看数据库

```bash
# 查看保存的策略
docker exec money-mysql mysql -uroot -prootpassword trading -e "
  SELECT id, name, description
  FROM strategies
  ORDER BY id DESC
  LIMIT 10;
"

# 查看某个策略的交易记录数量
docker exec money-mysql mysql -uroot -prootpassword trading -e "
  SELECT strategy_name, COUNT(*) as trades
  FROM trades
  GROUP BY strategy_name
  ORDER BY strategy_name;
"
```

---

### 第五步: 在复盘页面查看

1. 打开复盘页面: http://localhost:5173/test-playback.html
2. 选择策略名称
3. 查看在K线图上标记的交易点
4. 分析RSI/MACD指标值

---

### 第六步: 调整参数 (可选)

如果想测试不同的参数范围,编辑:

```bash
vi backend/services/strategy-parameter-generator.js
```

修改 `PARAMETER_SPACE` 对象中的参数值,然后重新运行测试。

---

### 第七步: 运行完整测试 (可选)

测试所有40,000+策略 (需要5-6小时):

```bash
# 后台运行
nohup node scripts/run-multi-strategy-backtest.js > backtest.log 2>&1 &

# 记录进程ID
echo $! > backtest.pid

# 实时查看进度
tail -f backtest.log

# 停止测试 (如果需要)
kill $(cat backtest.pid)
```

---

## 💡 使用技巧

### 1. 分类型测试

```bash
# 只测试RSI策略
node scripts/run-multi-strategy-backtest.js 500 rsi_only

# 测试MACD策略
node scripts/run-multi-strategy-backtest.js 500 macd_only

# 测试组合策略
node scripts/run-multi-strategy-backtest.js 500 rsi_and_macd
```

### 2. 导出结果到CSV

```bash
docker exec money-mysql mysql -uroot -prootpassword trading -e "
  SELECT * FROM trades
  WHERE strategy_name = 'RSI-P14-OS30-OB70-MP5-H240-SL30-TP60'
  INTO OUTFILE '/tmp/trades.csv'
  FIELDS TERMINATED BY ','
  ENCLOSED BY '\"'
  LINES TERMINATED BY '\n';
"
```

### 3. 比较多个策略

```bash
docker exec money-mysql mysql -uroot -prootpassword trading -e "
  SELECT
    strategy_name,
    COUNT(*) as trades,
    ROUND(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as win_rate,
    ROUND(SUM(pnl), 2) as total_pnl,
    ROUND(AVG(pnl), 2) as avg_pnl
  FROM trades
  GROUP BY strategy_name
  ORDER BY total_pnl DESC
  LIMIT 20;
"
```

---

## 📊 结果分析示例

### 查看最赚钱的策略

```sql
SELECT
  s.name,
  s.description,
  COUNT(t.id) as trade_count,
  SUM(t.pnl) as total_pnl
FROM strategies s
LEFT JOIN trades t ON s.name = t.strategy_name
GROUP BY s.id
ORDER BY total_pnl DESC
LIMIT 10;
```

### 查看胜率最高的策略

```sql
SELECT
  strategy_name,
  COUNT(*) as total_trades,
  SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
  ROUND(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as win_rate
FROM trades
GROUP BY strategy_name
HAVING COUNT(*) >= 50
ORDER BY win_rate DESC
LIMIT 10;
```

### 分析交易时段

```sql
SELECT
  HOUR(FROM_UNIXTIME(entry_time/1000)) as hour,
  COUNT(*) as trades,
  ROUND(AVG(pnl), 2) as avg_pnl
FROM trades
WHERE strategy_name = 'RSI-P14-OS30-OB70-MP5-H240-SL30-TP60'
GROUP BY hour
ORDER BY hour;
```

---

## 🎯 下一步

1. ✅ 运行快速测试验证系统
2. ✅ 运行中等规模测试 (1000个策略)
3. ✅ 分析Top 10结果
4. ✅ 在复盘页面查看交易详情
5. ⚙️ 根据结果调整参数空间
6. 🚀 运行完整测试找到最优策略
7. 📈 将最优策略应用到实盘模拟
