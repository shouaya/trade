# 2025年12月并行回测系统

## 概述

该系统将560,196个策略的回测任务分解为12个独立的月度进程,实现12倍的并行加速。

## 系统架构

```
策略生成 → 12个月度进程并行执行 → 结果聚合 → Top 10选择
```

### 核心组件

1. **参数生成器** (`strategy-parameter-generator.js`)
   - 生成560,196个策略组合
   - 止损: 6种 (null, 15, 20, 30, 40, 50 pips)
   - 止盈: 7种 (null, 30, 50, 80, 100, 150, 200 pips)
   - 持仓时间: 9种 (30, 60, 120, 180, 240, 360, 480, 720, 1440分钟)

2. **月度回测脚本** (`run-backtest-2025-m01.js` ~ `run-backtest-2025-m12.js`)
   - 每个脚本处理一个月的数据
   - 测试所有560,196个策略
   - 结果保存到独立的月度表 (`backtest_results_2025_01` ~ `backtest_results_2025_12`)

3. **启动器** (`launch-parallel-backtest.sh`)
   - 同时启动12个进程
   - 进程监控和日志管理

4. **结果聚合** (`aggregate-parallel-results.js`)
   - 从12个月度表中提取Top 100
   - 计算全年综合表现
   - 选择最终Top 10 (至少在6个月中表现优秀)

## 使用方法

### 1. 生成月度脚本

```bash
node scripts/generate-month-scripts.js
```

输出:
- 12个月度回测脚本 (`run-backtest-2025-m01.js` ~ `run-backtest-2025-m12.js`)

### 2. 启动并行回测

```bash
bash scripts/launch-parallel-backtest.sh
```

系统会:
- 询问是否清理旧的月度结果表
- 启动12个进程,每个处理一个月
- 创建日志文件: `logs/parallel-backtest-2025/month-01.log` ~ `month-12.log`
- 记录进程PID到 `logs/parallel-backtest-2025/pids.txt`

### 3. 监控进度

```bash
# 实时监控所有月份进度 (每30秒刷新)
bash scripts/monitor-parallel-backtest.sh

# 查看特定月份日志
tail -f logs/parallel-backtest-2025/month-01.log

# 查看所有日志
tail -f logs/parallel-backtest-2025/month-*.log

# 检查运行中的进程
ps aux | grep 'run-backtest-2025-m'
```

### 4. 停止所有进程

```bash
bash scripts/stop-parallel-backtest.sh
```

### 5. 聚合结果

当所有12个进程完成后:

```bash
node scripts/aggregate-parallel-results.js
```

输出:
- 从每个月的Top 100中选择候选策略
- 筛选在至少6个月中表现优秀的策略
- 计算全年综合指标
- 选出最终Top 10
- 保存到 `strategies` 表 (前缀: `2025-`)

## 性能预估

### 单进程顺序执行
- 560,196 策略 × 12 个月 = 6,722,352 次回测
- 预计耗时: ~6,722 分钟 (112 小时)

### 12进程并行执行
- 每个进程: 560,196 策略 × 1 个月
- 预计耗时: ~560 分钟 (9.3 小时)
- **加速比: 12倍**

## 评分系统

### 月度评分 (单月)
```javascript
score = totalPnl × 0.3 +
        winRate × 50 × 0.2 +
        sharpeRatio × 10 × 0.25 +
        profitFactor × 5 × 0.15 +
        (1 - maxDrawdown) × 20 × 0.1
```

### 最终评分 (全年)
```javascript
finalScore = avgScore + (monthCount / 12) × 10
```
- `avgScore`: 所有出现月份的平均评分
- `monthCount`: 策略进入Top 100的月份数
- 稳定性奖励: 出现月份越多,奖励越高

## 筛选标准

1. **月度筛选**: 每月选出Top 100策略 (至少10次交易)
2. **稳定性筛选**: 至少在6个月中进入Top 100
3. **综合排名**: 按最终评分排序,选出Top 10

## 数据库表结构

### 月度结果表 (12个)
```sql
CREATE TABLE backtest_results_2025_01 (
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
  INDEX idx_strategy_name (strategy_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 最终策略表
```sql
-- 保存最终Top 10
INSERT INTO strategies (name, description, parameters)
VALUES ('2025-{strategy_name}', '{全年统计}', '{参数JSON}')
```

## 文件清单

### 核心脚本
- `strategy-parameter-generator.js` - 参数空间定义
- `run-backtest-2025-month-template.js` - 月度脚本模板
- `generate-month-scripts.js` - 生成12个月度脚本
- `run-backtest-2025-m01.js` ~ `run-backtest-2025-m12.js` - 月度回测脚本
- `aggregate-parallel-results.js` - 结果聚合

### Shell脚本
- `launch-parallel-backtest.sh` - 启动12个并行进程
- `stop-parallel-backtest.sh` - 停止所有进程
- `monitor-parallel-backtest.sh` - 实时监控进度

### 日志文件
- `logs/parallel-backtest-2025/month-01.log` ~ `month-12.log` - 月度日志
- `logs/parallel-backtest-2025/pids.txt` - 进程PID记录
- `logs/parallel-backtest-2025/start_time.txt` - 启动时间

## 故障排查

### 进程没有启动
```bash
# 检查脚本权限
ls -la scripts/*.sh

# 手动执行权限设置
chmod +x scripts/launch-parallel-backtest.sh
chmod +x scripts/stop-parallel-backtest.sh
chmod +x scripts/monitor-parallel-backtest.sh
```

### 数据库连接过载
如果12个进程同时连接导致数据库压力过大:
1. 修改 `launch-parallel-backtest.sh` 中的 `sleep 2` 为更大的值 (如 `sleep 5`)
2. 调整MySQL连接池配置

### 内存不足
每个进程需要加载一个月的K线数据 (~30,000-50,000条):
```bash
# 监控内存使用
top -pid $(pgrep -f 'run-backtest-2025-m' | head -1)

# 如果内存不足,可以分批执行:
# 先执行1-6月
for month in {01..06}; do
  nohup node scripts/run-backtest-2025-m${month}.js > logs/parallel-backtest-2025/month-${month}.log 2>&1 &
done

# 等待完成后再执行7-12月
for month in {07..12}; do
  nohup node scripts/run-backtest-2025-m${month}.js > logs/parallel-backtest-2025/month-${month}.log 2>&1 &
done
```

### 某个月的进程崩溃
```bash
# 查看该月日志
tail -100 logs/parallel-backtest-2025/month-03.log

# 单独重新运行该月
node scripts/run-backtest-2025-m03.js
```

## 优化建议

### 进一步加速
1. **增加并行度**: 将每月拆分为周,实现52周并行 (52倍加速)
2. **使用更快的指标计算**: 优化RSI/MACD计算算法
3. **预计算指标**: 为所有K线预计算RSI/MACD,存入数据库

### 参数空间优化
根据初步结果,可以缩小参数范围:
```javascript
// 例如,如果发现30分钟持仓时间从未进入Top 10
maxHoldMinutes: [60, 120, 180, 240, 360, 480, 720, 1440] // 去掉30
```

### 增量训练
在完成2025年训练后:
```bash
# 对2024年数据进行验证
node scripts/validate-2024.js

# 对2026年数据进行验证
node scripts/validate-2026.js
```

## 下一步

1. ✅ 参数空间扩展 (40K → 560K策略)
2. ✅ 12进程并行系统搭建
3. 🔄 执行2025年并行回测
4. ⏳ 聚合结果并选出Top 10
5. ⏳ 在2024和2026年数据上验证
6. ⏳ 实盘测试最佳策略

## 版本历史

- **v3.0** (2025-03-03): 12进程并行系统,560K策略,细化止损/止盈/持仓时间
- **v2.0** (2025-03-02): 扩展到118K策略,增加持仓时间维度
- **v1.0** (2025-03-01): 初始版本,40K策略

---

**文档更新**: 2025-03-03
**作者**: Trading System
