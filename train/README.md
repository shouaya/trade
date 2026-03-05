# Train - 策略训练和验证系统

基于 TypeScript 的外汇策略自动化训练和验证系统。

## 🎯 核心功能

1. **训练** - 搜索最佳策略参数
2. **验证** - 评估策略泛化能力
3. **保存** - 存储最佳策略到数据库
4. **滚动窗口** - 适应性训练

## 📦 快速开始

```bash
# 1. 启动服务
cd /path/to/money
make up

# 2. 初始化数据库
make db-init

# 3. 训练2024年策略
make train CONFIG=training/2024_atr

# 4. 验证策略（自动选出并保存 Top 10）
make validate CONFIG=validation/2024_atr_2025_validation
```

## 🔧 可用命令

### Docker 管理
```bash
make up              # 启动所有服务
make down            # 停止所有服务
make shell           # 进入train容器
make mysql           # 进入MySQL客户端
```

### 训练
```bash
# 年度训练
make train CONFIG=training/2024_atr
make train CONFIG=training/2025_atr

# 滚动窗口训练
make train CONFIG=training/2025_01_rolling
make train CONFIG=training/2025_02_rolling
```

### 验证
```bash
# 前向验证
make validate CONFIG=validation/2024_atr_2025_validation
make validate CONFIG=validation/2024_atr_2026_validation

# 反向验证
make validate CONFIG=validation/2025_atr_2024_validation
make validate CONFIG=validation/2025_atr_2026_validation
```

### 数据库
```bash
make db-init         # 初始化数据库表
make db-backup       # 备份数据库
make db-tables       # 查看所有表
```

## 📁 目录结构

```
train/
├── src/
│   ├── scripts/              # 执行脚本
│   │   ├── train.ts         # 通用训练/验证 ⭐
│   │   ├── save-top3-strategies.ts
│   │   └── init-db.ts
│   ├── services/             # 业务逻辑
│   ├── types/                # TypeScript 类型
│   ├── configs/              # 配置
│   └── database/             # 数据库 Schema
├── configs/
│   ├── training/             # 训练配置（年度+滚动窗口）
│   ├── validation/           # 验证配置（年度+滚动窗口）
│   └── top-strategies/       # Top策略配置
├── dist/                     # 编译输出
├── QUICK_START.md            # 快速开始
└── package.json
```

## 🎓 核心概念

### 训练 vs 验证

| 维度 | 训练 | 验证 |
|------|------|------|
| **目的** | 搜索最佳参数 | 评估泛化能力 |
| **参数组合数** | 大量（1000+） | 少量（<10） |
| **数据期** | 训练期（如2024） | 验证期（如2025） |
| **执行时间** | 长（1-3小时） | 短（5-30分钟） |

### 滚动窗口训练

每月使用过去12个月的数据训练策略，保持对市场的适应性。配置文件统一放在 training 目录。

```
training/2025_01_rolling.json: 使用 2024-01 到 2024-12 训练
training/2025_02_rolling.json: 使用 2024-02 到 2025-01 训练
training/2025_03_rolling.json: 使用 2024-03 到 2025-02 训练
...
```

## 📝 配置文件

所有配置使用 JSON 格式，统一位于 `configs/` 的两个标准目录：

- `training/` - 所有训练配置（年度训练 + 滚动窗口训练）
- `validation/` - 所有验证配置（年度验证 + 滚动窗口验证）

**命名规范：**
- 年度训练：`2024_atr.json`, `2025_atr.json`
- 滚动窗口训练：`2025_01_rolling.json`, `2025_02_rolling.json`, ...
- 年度验证：`2024_atr_2025_validation.json`
- 滚动窗口验证：`2025_01_rolling_2025_01_validation.json`, `2025_02_rolling_2025_02_validation.json`, ...

## 🗄️ 数据库表

- `klines` - K线数据（由 backend 管理）
- `backtest_results` - 训练/验证结果
- `strategies` - 最佳策略参数
- `trades` - 最佳策略交易记录
- `tasks` - 任务管理

## 🔨 开发

```bash
# TypeScript 编译
npm run build

# 类型检查
npm run type-check

# 监听模式
npm run build:watch
```

## 📚 文档

- [WORKFLOW.md](WORKFLOW.md) - 详细工作流和使用指南
- [CLAUDE.md](../CLAUDE.md) - AI 助手开发指南
- [src/database/README.md](src/database/README.md) - 数据库 Schema 说明

## ⚙️ 技术栈

- **语言**: TypeScript 5.3+
- **运行时**: Node.js 22+
- **数据库**: MySQL 8.0
- **容器**: Docker + Docker Compose

## 📊 性能

- 单个策略回测：~1-5秒（取决于K线数量）
- 1000个策略训练：~30-90分钟
- 滚动窗口14个月：~3-5小时

## 🐛 故障排查

### 编译错误
```bash
npm run clean && npm run build
```

### Docker 依赖错误
```bash
docker-compose run --rm train npm install
```

### 数据库连接错误
检查 MySQL 容器是否运行：
```bash
docker-compose ps mysql
```

## 📄 许可证

MIT
