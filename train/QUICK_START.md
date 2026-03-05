# 快速开始指南

## 🎯 统一的配置格式

所有命令使用 `TYPE/NAME` 格式，其中：
- `TYPE` 是配置类型目录（**只有两个标准目录：training, validation**）
- `NAME` 是配置文件名（不含 .json 后缀）

## 📖 基本用法

### 1. 训练

```bash
# 年度训练
make train CONFIG=training/2024_atr
make train CONFIG=training/2025_atr

# 滚动窗口训练（单月）
make train CONFIG=training/2025_01_rolling
make train CONFIG=training/2025_02_rolling
make train CONFIG=training/2025_03_rolling
```

### 2. 验证

```bash
# 前向验证
make validate CONFIG=validation/2024_atr_2025_validation
make validate CONFIG=validation/2024_atr_2026_validation

# 反向验证
make validate CONFIG=validation/2025_atr_2024_validation
make validate CONFIG=validation/2025_atr_2026_validation
```

## 📁 配置文件目录结构

**只有两个标准目录：**

```
configs/
├── training/              # 所有训练配置
│   ├── 2024_atr.json     # 年度训练
│   ├── 2025_atr.json     # 年度训练
│   ├── 2025_01_rolling.json  # 滚动窗口训练
│   ├── 2025_02_rolling.json  # 滚动窗口训练
│   └── ... (14个滚动窗口配置)
└── validation/            # 所有验证配置
    ├── 2024_atr_2025_validation.json  # 年度验证
    ├── 2024_atr_2026_validation.json  # 年度验证
    ├── 2025_01_rolling_2025_01_validation.json  # 滚动窗口验证
    ├── 2025_02_rolling_2025_02_validation.json  # 滚动窗口验证
    └── ... (14个滚动窗口验证)
```

## 🚀 典型工作流

### 场景 1: 年度训练 + 验证

```bash
# 1. 训练 2024 年
make train CONFIG=training/2024_atr

# 2. 用 2025 年验证（自动选出并保存 Top 10 策略）
make validate CONFIG=validation/2024_atr_2025_validation
```

### 场景 2: 滚动窗口训练

```bash
# 训练 2025-01 月（使用 2024 全年数据）
make train CONFIG=training/2025_01_rolling

# 训练 2025-02 月（使用 2024-02 到 2025-01 数据）
make train CONFIG=training/2025_02_rolling

# ... 依次训练所有月份
```

### 场景 3: 批量滚动窗口训练 + 验证

使用一键命令训练和验证所有滚动窗口（2025-01 到 2026-02，共14个月）：

```bash
# 训练 + 验证所有滚动窗口
make rolling-all

# 只训练所有滚动窗口
make rolling-train

# 只验证所有滚动窗口
make rolling-validate

# 高级用法：指定范围（从2025-01到2025-12）
bash train/scripts/run-all-rolling.sh --start 202501 --end 202512
```

**这个命令会自动：**
1. 依次训练所有滚动窗口配置
2. 每个训练完成后自动进行验证
3. 显示实时进度和彩色日志
4. 统计成功/失败数量
5. 列出所有失败的配置

## 💡 常用命令

```bash
# Docker 管理
make up              # 启动服务
make down            # 停止服务
make shell           # 进入容器

# 数据库
make db-init         # 初始化数据库
make db-backup       # 备份数据库
make mysql           # 进入 MySQL

# 查看日志
make logs            # 所有日志
make logs-train      # 训练日志

# 查看帮助
make help
```

## ❓ 常见问题

### Q: 忘记 CONFIG 参数会怎样？
A: 系统会显示详细的使用说明：
```bash
$ make train
❌ 请指定配置文件（格式: TYPE/NAME，不含.json后缀）

📖 使用方法:
  make train CONFIG=training/2024_atr                  # 年度训练
  make train CONFIG=rolling_window/train_2025_01       # 滚动窗口
  ...
```

### Q: 如何查看可用的配置文件？
A: 查看两个标准目录：
```bash
ls train/configs/training/
ls train/configs/validation/
```

### Q: 配置文件格式是什么？
A: 所有配置文件使用相同的 JSON 格式，参见 [README.md](README.md)

## 📚 更多文档

- [README.md](README.md) - 完整文档
- [WORKFLOW.md](WORKFLOW.md) - 详细工作流（如果存在）
- [SIMPLIFICATION_SUMMARY.md](SIMPLIFICATION_SUMMARY.md) - 精简总结（如果存在）
