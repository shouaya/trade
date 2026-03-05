# 配置文件目录结构说明

## 📁 目录组织

**只有两个标准目录：**

```
configs/
├── training/           # 所有训练配置（年度 + 滚动窗口）
└── validation/         # 所有验证配置（年度 + 滚动窗口）
```

---

## 🎯 训练配置 (training/)

**目的**: 在历史数据上测试大量策略参数组合，寻找最佳策略

### 年度训练配置
- `2024_atr.json` - 2024年全年数据训练
- `2025_atr.json` - 2025年全年数据训练

### 滚动窗口训练配置（14个月）
- `2025_01_rolling.json` - 使用 2024-01 到 2024-12 数据训练
- `2025_02_rolling.json` - 使用 2024-02 到 2025-01 数据训练
- ...
- `2026_02_rolling.json` - 使用 2025-02 到 2026-01 数据训练

**使用命令**:
```bash
# 年度训练
make train CONFIG=training/2024_atr
make train CONFIG=training/2025_atr

# 滚动窗口训练
make train CONFIG=training/2025_01_rolling
make train CONFIG=training/2025_02_rolling
```

**特点**:
- 策略数量多（150+ 组合）
- 运行时间长（1-3小时）
- 用于发现最佳参数组合

---

## ✅ 验证配置 (validation/)

**目的**: 使用训练阶段找到的最佳策略，在不同时期数据上验证其稳定性

### 年度验证配置
- `2024_atr_2025_validation.json` - 用2024最佳策略验证2025年
- `2024_atr_2026_validation.json` - 用2024最佳策略验证2026年
- `2025_atr_2024_validation.json` - 用2025最佳策略验证2024年（反向）
- `2025_atr_2026_validation.json` - 用2025最佳策略验证2026年

### 滚动窗口验证配置（14个月）
- `2025_01_rolling_2025_01_validation.json` - 验证2025-01月策略
- `2025_02_rolling_2025_02_validation.json` - 验证2025-02月策略
- ...
- `2026_02_rolling_2026_02_validation.json` - 验证2026-02月策略

**使用命令**:
```bash
# 年度验证
make validate CONFIG=validation/2024_atr_2025_validation
make validate CONFIG=validation/2024_atr_2026_validation

# 滚动窗口验证
make validate CONFIG=validation/2025_01_rolling_2025_01_validation
make validate CONFIG=validation/2025_02_rolling_2025_02_validation
```

**特点**:
- 策略数量少（<10个）
- 运行时间短（5-30分钟）
- 验证跨时期稳定性

---

## 📊 完整工作流程

### 工作流 1: 年度训练 + 前向验证

```bash
# 1. 在2024年数据上训练
make train CONFIG=training/2024_atr

# 2. 在2025年数据上验证（自动选出并保存 Top 10）
make validate CONFIG=validation/2024_atr_2025_validation

# 3. 在2026年数据上验证
make validate CONFIG=validation/2024_atr_2026_validation
```

### 工作流 2: 滚动窗口训练

```bash
# 每月训练一次，使用过去12个月数据
make train CONFIG=training/2025_01_rolling  # 2025-01月策略
make train CONFIG=training/2025_02_rolling  # 2025-02月策略
# ... 依次训练所有月份

# 验证各月策略
make validate CONFIG=validation/2025_01_rolling_2025_01_validation
make validate CONFIG=validation/2025_02_rolling_2025_02_validation
```

### 工作流 3: 批量滚动窗口训练

创建脚本 `scripts/train-all-rolling.sh`:
```bash
#!/bin/bash
for i in {01..12}; do
  make train CONFIG=training/2025_${i}_rolling
done
for i in {01..02}; do
  make train CONFIG=training/2026_${i}_rolling
done
```

---

## 🔑 关键区别

| 项目 | 训练 (Training) | 验证 (Validation) |
|------|----------------|------------------|
| **目的** | 寻找最佳策略 | 测试已知策略 |
| **策略数** | 很多（150+） | 很少（<10） |
| **数据期** | 训练期 | 验证期（未来） |
| **时间** | 长（1-3小时） | 短（5-30分钟） |
| **目录** | `training/` | `validation/` |

---

## 📝 命名规范

### 年度训练配置
```
{年份}_atr.json
```
示例: `2024_atr.json`, `2025_atr.json`

### 滚动窗口训练配置
```
{年份}_{月份}_rolling.json
```
示例: `2025_01_rolling.json`, `2025_12_rolling.json`

### 年度验证配置
```
{训练年份}_atr_{验证年份}_validation.json
```
示例: `2024_atr_2025_validation.json`

### 滚动窗口验证配置
```
{年份}_{月份}_rolling_{年份}_{月份}_validation.json
```
示例: `2025_01_rolling_2025_01_validation.json`

**命名规则**:
- 年度配置: 使用年份标识
- 滚动窗口配置: **必须包含 `_rolling` 关键字**
- 验证配置: **必须包含 `_validation` 后缀**

---

## 🎓 简单记忆

- **训练** = 大海捞针，找最佳策略（测试150个参数组合）
- **验证** = 拿着找到的针，看看在其他时期是否还好用（只测试Top策略）
- **年度** = 整年数据一次训练
- **滚动窗口** = 每月用过去12个月数据训练，保持策略新鲜度

**核心原则**: 训练一次，验证多次！

---

## 💡 统一命令格式

所有命令使用 `TYPE/NAME` 格式（不含 .json 后缀）：

```bash
make train CONFIG=training/2024_atr
make train CONFIG=training/2025_01_rolling
make validate CONFIG=validation/2024_atr_2025_validation
make validate CONFIG=validation/2025_01_rolling_2025_01_validation
```

**优势**:
- 简洁统一
- 易于记忆
- 自动补全友好
