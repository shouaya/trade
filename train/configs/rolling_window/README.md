# 滚动窗口训练策略 (Rolling Window Training)

## 概述

滚动窗口训练策略是一种**动态策略优化方法**，每个月使用过去12个月的数据训练出当月的最佳策略，然后只在该月进行验证。这种方法模拟了真实交易场景中的策略更新流程。

## 策略原理

### 传统方法 vs 滚动窗口方法

**传统方法（固定窗口）**:
- 使用整年数据（如2024年）训练出一个策略
- 该策略在未来所有月份使用
- 问题：市场环境变化时，策略可能不再适用

**滚动窗口方法**:
- 每月使用最近12个月的数据训练新策略
- 每月策略根据最新市场环境动态调整
- 优点：策略始终与最新市场状态保持一致

### 执行时间线示例

```
2025年1月执行:
  训练数据: 2024-01-01 至 2024-12-31 (12个月)
  验证数据: 2025-01-01 至 2025-01-31 (1个月)

2025年2月执行:
  训练数据: 2024-02-01 至 2025-01-31 (12个月) ← 窗口向前滑动
  验证数据: 2025-02-01 至 2025-02-28 (1个月)

2025年3月执行:
  训练数据: 2024-03-01 至 2025-02-28 (12个月) ← 继续滑动
  验证数据: 2025-03-01 至 2025-03-31 (1个月)

...依此类推到2026年2月
```

## 文件结构

```
configs/rolling_window/
├── README.md                      # 本文档
├── train_2025_01.json            # 2025年1月训练配置
├── train_2025_02.json            # 2025年2月训练配置
├── ...                           # 其他月份训练配置
├── train_2026_02.json            # 2026年2月训练配置
└── validation/
    ├── validate_2025_01.json     # 2025年1月验证配置
    ├── validate_2025_02.json     # 2025年2月验证配置
    ├── ...                       # 其他月份验证配置
    └── validate_2026_02.json     # 2026年2月验证配置
```

## 使用方法

### 方法1: 自动化批量执行（推荐）

运行自动化脚本，一次性完成所有14个月的训练和验证：

```bash
cd /Users/ts-changchang.zhuang/git/money/train
node scripts/run-rolling-window-training.js
```

脚本会自动：
1. 依次处理每个月（2025-01 到 2026-02）
2. 对每个月执行：训练(150个策略组合) → 找最佳策略 → 验证
3. 生成汇总报告

**预计耗时**: 约3-5小时（取决于机器性能）

### 方法2: 单月手动执行

如果只想处理某个特定月份：

```bash
# 1. 训练阶段
node scripts/train.js configs/rolling_window/train_2025_01.json

# 2. 查询最佳策略
# (通过数据库查询 backtest_results_rolling_2025_01_train 表)

# 3. 验证阶段
# 修改 validation/validate_2025_01.json 填入最佳策略参数
node scripts/train.js configs/rolling_window/validation/validate_2025_01.json
```

### 方法3: 使用Docker Compose

```bash
# 训练
docker-compose run --rm train node scripts/train.js configs/rolling_window/train_2025_01.json

# 验证
docker-compose run --rm train node scripts/train.js configs/rolling_window/validation/validate_2025_01_final.json
```

## 参数配置

每个训练配置测试 **150个策略组合**:

| 参数 | 选项 | 说明 |
|------|------|------|
| maxHoldMinutes | [5, 10, 15, 20, 25, 30] | 持仓时间（分钟）- 6种 |
| atrSlMultiplier | [2.0, 2.5, 3.0, 3.5, 4.0] | ATR止损倍数 - 5种 |
| atrTpMultiplier | [3.0, 4.0, 5.0, 6.0, 7.0] | ATR止盈倍数 - 5种 |

总组合数: 6 × 5 × 5 = **150个策略**

## 结果查看

### 查看训练结果

```sql
-- 查看2025年1月训练的Top 10策略
SELECT
  strategy_name,
  total_pnl,
  total_trades,
  win_rate,
  sharpe_ratio
FROM backtest_results_rolling_2025_01_train
ORDER BY total_pnl DESC
LIMIT 10;
```

### 查看验证结果

```sql
-- 查看2025年1月验证结果
SELECT
  strategy_name,
  total_pnl,
  total_trades,
  win_rate,
  sharpe_ratio
FROM backtest_results_rolling_2025_01_validate
ORDER BY total_pnl DESC
LIMIT 1;
```

### 查看汇总报告

运行自动化脚本后，报告会保存在：
```
train/reports/rolling_window_summary.json
```

## 数据库表命名规则

- 训练结果表: `backtest_results_rolling_{YYYY}_{MM}_train`
- 验证结果表: `backtest_results_rolling_{YYYY}_{MM}_validate`

例如:
- `backtest_results_rolling_2025_01_train` - 2025年1月训练结果
- `backtest_results_rolling_2025_01_validate` - 2025年1月验证结果

## 预期结果

完成所有14个月的训练和验证后，你将获得：

1. **每月最佳策略**: 14个月，每月一个针对当月市场优化的策略
2. **验证盈亏**: 每月策略在该月的实际表现
3. **汇总统计**:
   - 总盈亏
   - 平均月度盈亏
   - 月度盈利率（几个月盈利/总月数）
   - 最佳/最差月份

4. **策略演变分析**: 可以看到策略参数如何随市场环境变化

## 与传统方法对比

完成后，可以对比：

| 方法 | 训练数据 | 验证期 | 策略数 |
|------|---------|--------|--------|
| **2024固定策略** | 2024全年 | 2025全年 + 2026前2月 | 1个 |
| **2025固定策略** | 2025全年 | 2026前2月 | 1个 |
| **滚动窗口策略** | 每月最近12个月 | 当月 | 14个（每月一个）|

## 注意事项

1. **计算资源**:
   - 每月训练150个策略组合，共14个月 = 2100次训练
   - 确保有足够的计算资源和时间

2. **数据库空间**:
   - 会创建28个新表（14个训练表 + 14个验证表）
   - 确保MySQL有足够存储空间

3. **过拟合风险**:
   - 虽然每月使用12个月数据训练，但仍需警惕过度优化
   - 建议关注策略的稳定性而非单月最高盈利

4. **执行顺序**:
   - 必须按时间顺序执行（从2025-01开始）
   - 因为每月的训练数据依赖前面的月份

## 扩展与改进

### 可能的优化方向

1. **动态窗口大小**: 根据市场波动性调整训练窗口（6个月 vs 12个月）
2. **集成学习**: 组合多个策略而非只选最佳
3. **实时更新**: 缩短更新周期（周级别而非月级别）
4. **市场状态识别**: 根据市场状态（趋势/震荡）选择不同策略

## 问题排查

### 训练失败
- 检查数据库连接
- 确认K线数据完整性
- 查看日志文件

### 验证结果为空
- 确保训练步骤已完成
- 检查最佳策略参数是否正确填入验证配置

### 性能慢
- 考虑并行执行多个月份
- 减少策略组合数（降低参数搜索空间）

## 联系与支持

如有问题，请查看：
- 主训练脚本: `scripts/train.js`
- 自动化脚本: `scripts/run-rolling-window-training.js`
- 配置生成器: `scripts/generate-rolling-window-configs.js`

---

**最后更新**: 2026-03-05
**版本**: v1.0
