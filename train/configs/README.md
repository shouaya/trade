# 配置文件目录结构说明

## 📁 目录组织

```
configs/
├── training/           # 训练配置 - 寻找最佳策略
├── validation/         # 验证配置 - 测试已知策略
└── top-strategies/     # 最佳策略集合
```

---

## 🎯 训练配置 (Training)

**目的**: 在历史数据上测试大量策略参数组合，寻找最佳策略

**文件**:
- `2024_v3_atr_optimization.json` - 2024年ATR优化训练（150个策略组合）
- `2024_v3_rsi_holdtime.json` - 2024年RSI持仓时间优化训练

**使用命令**:
```bash
# ATR优化训练
make train CONFIG=configs/training/2024_v3_atr_optimization.json

# RSI持仓时间优化训练
make train CONFIG=configs/training/2024_v3_rsi_holdtime.json
```

**特点**:
- 策略数量多（150+）
- 运行时间长
- 用于发现最佳参数组合

---

## ✅ 验证配置 (Validation)

**目的**: 使用训练阶段找到的最佳策略，在不同年份数据上验证其稳定性

**文件**:
- `2024_v3_atr_optimization_2025_validation.json` - 用2024最佳策略验证2025年数据
- `2024_v3_atr_optimization_2026_validation.json` - 用2024最佳策略验证2026年数据

**使用命令**:
```bash
# 2025年验证
make train CONFIG=configs/validation/2024_v3_atr_optimization_2025_validation.json

# 2026年验证
make train CONFIG=configs/validation/2024_v3_atr_optimization_2026_validation.json
```

**特点**:
- 策略数量少（6个）
- 运行时间短
- 验证跨年度稳定性

---

## 🏆 最佳策略集合 (Top Strategies)

**目的**: 保存训练和验证后确定的最佳策略配置

**文件**:
- `2024_v3_atr_top3.json` - 2024年Top 3策略
- `2024_v3_atr_best.json` - 2024年最佳单一策略
- `2025_v3_atr_top3.json` - 2025年Top 3策略
- `2025_v3_atr_best.json` - 2025年最佳单一策略

**用途**:
- 文档记录
- 实盘参考
- 跨年度对比分析

---

## 📊 完整工作流程

### 1. 训练阶段（2024年数据）
```bash
# 在2024年数据上测试150个ATR参数组合
make train CONFIG=configs/training/2024_v3_atr_optimization.json
```
**输出**: 找到最佳策略 `RSI-P14-OS30-OB70-MP1-H25-ATRSL4-ATRTP5`

### 2. 验证阶段（2025/2026年数据）
```bash
# 用2024最佳策略在2025年数据上验证
make train CONFIG=configs/validation/2024_v3_atr_optimization_2025_validation.json

# 用2024最佳策略在2026年数据上验证
make train CONFIG=configs/validation/2024_v3_atr_optimization_2026_validation.json
```
**输出**:
- 2025年: $2,322.50 (+20.9% vs 2024)
- 2026年: $6,561.00 (持续盈利)

### 3. 查看结果
```bash
# 查看2024训练结果
docker-compose run --rm train node scripts/query-top-by-metrics.js backtest_results_2024_v3_atr 10

# 查看2025验证结果
docker-compose run --rm train node scripts/query-top-by-metrics.js backtest_results_2025_v3_atr_validation 10

# 查看2026验证结果
docker-compose run --rm train node scripts/query-top-by-metrics.js backtest_results_2026_v3_atr_validation 10
```

---

## 🔑 关键区别

| 项目 | 训练 (Training) | 验证 (Validation) |
|------|----------------|------------------|
| **目的** | 寻找最佳策略 | 测试已知策略 |
| **策略数** | 很多（150+） | 很少（6个） |
| **数据** | 较早年份 | 后续年份 |
| **时间** | 较长 | 较短 |
| **命名** | `*_optimization.json` | `*_validation.json` |

---

## 📝 命名规范

### 训练配置命名
```
{年份}_v{版本}_{优化目标}_optimization.json
```
示例: `2024_v3_atr_optimization.json`

### 验证配置命名
```
{训练年份}_v{版本}_{优化目标}_optimization_{验证年份}_validation.json
```
示例: `2024_v3_atr_optimization_2025_validation.json`

这样命名可以清楚地看出：
- 使用哪个训练结果
- 在哪一年的数据上验证

---

## 🎓 简单记忆

- **训练** = 大海捞针，找最佳策略（测试150个参数组合）
- **验证** = 拿着找到的针，看看在其他地方是否还好用（只测试Top 6）

训练一次，验证多次！
