# 2025年策略分组并行回测系统

## 概述

将560,196个策略分成10组,每组在**完整的2025年数据(1-12月)**上进行回测,实现10倍并行加速。

## 🆚 对比: 按月分组 vs 按策略分组

### 之前的方案 (按月分组)
- ❌ 每月独立回测,缺乏连续性
- ❌ RSI/MACD每月需要单独预热,计算不连续
- ❌ 单月表现不能代表全年表现
- ❌ 需要复杂的聚合逻辑来选择最终策略

### 新方案 (按策略分组) ✅
- ✅ 每个策略在完整12个月数据上测试
- ✅ RSI/MACD从年初开始连续累积计算
- ✅ 全年表现更有说服力
- ✅ 直接按评分排序,无需复杂聚合

## 系统架构

```
560,196个策略 → 分成10组 → 10个进程并行执行 → 统一结果表 → Top 10
```

### 核心组件

1. **策略分组**: 每组约56,020个策略
2. **数据范围**: 2025年1月1日 ~ 12月31日 (含60天预热期)
3. **并行进程**: 10个进程同时运行
4. **结果表**: `backtest_results_2025_full` (所有组共享)

## 分组详情

| 组号 | 策略范围 | 策略数量 |
|-----|---------|---------|
| 组1 | #0 ~ #56,019 | 56,020 |
| 组2 | #56,020 ~ #112,039 | 56,020 |
| 组3 | #112,040 ~ #168,059 | 56,020 |
| 组4 | #168,060 ~ #224,079 | 56,020 |
| 组5 | #224,080 ~ #280,099 | 56,020 |
| 组6 | #280,100 ~ #336,119 | 56,020 |
| 组7 | #336,120 ~ #392,139 | 56,020 |
| 组8 | #392,140 ~ #448,159 | 56,020 |
| 组9 | #448,160 ~ #504,179 | 56,020 |
| 组10 | #504,180 ~ #560,195 | 56,016 |

## 使用方法

### 1. 参数化脚本单组运行

```bash
node scripts/run-backtest-2025-group.js --group 1 --groups 10
```

### 2. 启动并行回测

```bash
bash scripts/launch-strategy-group-backtest.sh
```

系统会:
- 询问是否清理旧的结果表 `backtest_results_2025_full`
- 启动10个进程,每个处理一组策略
- 创建日志: `logs/strategy-group-backtest-2025/group-01.log` ~ `group-10.log`
- 记录PID到 `logs/strategy-group-backtest-2025/pids.txt`

### 3. 监控进度

```bash
# 实时监控所有组进度 (每30秒刷新)
bash scripts/monitor-strategy-group-backtest.sh

# 查看特定组日志
tail -f logs/strategy-group-backtest-2025/group-01.log

# 检查运行中的进程
ps aux | grep 'run-backtest-2025-group'
```

### 4. 查询结果

```bash
# 查看当前进度和Top 10
node scripts/query-strategy-group-results.js
```

### 5. 停止所有进程

```bash
bash scripts/stop-strategy-group-backtest.sh
```

## 性能预估

### 单组耗时估算

基于之前的月度回测数据:
- 单月处理560,196个策略: ~160分钟
- 12个月完整数据: ~160分钟 × 12 = **1,920分钟 (32小时)**
- 每组56,020个策略: ~32小时 / 10 = **3.2小时**

### 并行执行

- 10个进程并行: **总wall time约3.2小时**
- 相比单进程顺序执行(32小时): **加速10倍**

### 实际可能更快

因为:
1. K线数据只加载一次(12个月一起加载)
2. 不需要重复生成策略列表
3. 数据库连接复用更高效

**保守估计: 2-3小时完成全部回测**

## 数据库表结构

### 结果表 (共享)

```sql
CREATE TABLE backtest_results_2025_full (
  id INT AUTO_INCREMENT PRIMARY KEY,
  strategy_id INT NOT NULL,
  strategy_name VARCHAR(255) NOT NULL,
  strategy_type VARCHAR(50) NOT NULL,
  parameters JSON NOT NULL,
  total_trades INT DEFAULT 0,
  win_rate DECIMAL(5, 4) DEFAULT 0,
  total_pnl DECIMAL(10, 2) DEFAULT 0,
  avg_pnl DECIMAL(10, 2) DEFAULT 0,
  sharpe_ratio DECIMAL(10, 3) DEFAULT 0,
  profit_factor DECIMAL(10, 2) DEFAULT 0,
  max_drawdown DECIMAL(5, 4) DEFAULT 0,
  score DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_score (score DESC),
  INDEX idx_strategy_name (strategy_name),
  UNIQUE KEY unique_strategy_name (strategy_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## 评分系统

与之前相同:

```javascript
score = totalPnl × 0.3 +
        winRate × 50 × 0.2 +
        sharpeRatio × 10 × 0.25 +
        profitFactor × 5 × 0.15 +
        (1 - maxDrawdown) × 20 × 0.1
```

筛选标准:
- 最小交易次数: 10次
- 按综合评分降序排序
- 选出Top 10

## 关键优势

### 1. RSI/MACD计算准确性

每个策略的RSI和MACD从2025年1月1日开始连续累积计算:
- ✅ 1月1日有60天的预热数据
- ✅ RSI14从年初开始正确计算
- ✅ MACD(12,26,9)从年初开始正确计算
- ✅ 全年指标保持连续性

### 2. 策略表现的连续性

- 每个策略有完整的12个月表现记录
- 可以评估策略在不同市场环境下的稳定性
- 避免了月度分割导致的不连续性

### 3. 结果更可靠

- 全年综合评分比单月评分更有参考价值
- 一次性得到最终Top 10,无需复杂聚合
- 直接可用于2024和2026年验证

## 断点续传

系统支持断点续传:
- 每组脚本在启动时检查已完成的策略
- 跳过已写入数据库的策略
- 崩溃后可直接重启,从断点继续

## 文件清单

### 核心脚本
- `run-backtest-2025-group.js` - 参数化策略组回测脚本（主入口）

### Shell脚本
- `launch-strategy-group-backtest.sh` - 启动10个并行进程
- `monitor-strategy-group-backtest.sh` - 实时监控进度
- `stop-strategy-group-backtest.sh` - 停止所有进程

### 工具脚本
- `query-strategy-group-results.js` - 查询结果和Top 10

### 日志文件
- `logs/strategy-group-backtest-2025/group-01.log` ~ `group-10.log`
- `logs/strategy-group-backtest-2025/pids.txt`
- `logs/strategy-group-backtest-2025/start_time.txt`

## 故障排查

### 数据库连接过载

如果10个进程同时连接导致压力过大:
1. 修改 `launch-strategy-group-backtest.sh` 中的 `sleep 2` 为更大值
2. 或分批启动(先启动5个,完成后再启动另外5个)

### 内存不足

每个进程需要加载12个月的K线数据(~500,000条):
- 单进程内存需求: ~200-300MB
- 10进程总计: ~2-3GB

如果内存不足:
- 减少并行数(例如只启动5个进程)
- 增加系统内存

### 某组进程崩溃

```bash
# 查看日志
tail -100 logs/strategy-group-backtest-2025/group-03.log

# 单独重新运行该组
node scripts/run-backtest-2025-group.js --group 3 --groups 10
```

## 下一步

完成回测后:

1. **查询Top 10**
   ```bash
   node scripts/query-strategy-group-results.js
   ```

2. **在2024年验证**
   ```bash
   node scripts/validate-2024.js
   ```

3. **在2026年验证**
   ```bash
   node scripts/validate-2026.js
   ```

4. **实盘测试**
   - 选择验证通过的策略
   - 在模拟账户测试
   - 小资金实盘验证

## 对比总结

|  | 按月分组 | 按策略分组 (新) |
|---|---------|----------------|
| 并行度 | 12进程 | 10进程 |
| 单次数据范围 | 1个月 | 12个月 |
| RSI/MACD准确性 | 每月独立,不连续 | 全年连续 |
| 结果说服力 | 单月表现 | 全年表现 ✅ |
| 后续处理 | 需要聚合12个月 | 直接得到Top 10 ✅ |
| 预计耗时 | ~3小时 | ~3小时 |

---

**推荐使用新方案**: 策略分组并行回测

**文档更新**: 2025-03-03
**作者**: Trading System
