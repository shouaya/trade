# 💹 Trading System

这是一个按领域拆分的交易系统仓库：

- `backend/`：API 服务与运行时后端逻辑
- `frontend/`：Vite 前端
- `train/`：训练、回测、验证、router 验证与相关报告链路
- `database/`：共享数据库 schema、初始化 SQL 与 DB helper

## 🎯 功能特点

- **实时 K 线回放**: 按分钟回放历史 K 线数据
- **技术指标**: RSI(14) 和 MACD(12,26,9) 实时计算和显示
- **交易模拟**: 支持做多/做空、自定义入场价格、止损止盈
- **数据持久化**: MySQL 数据库存储 K 线数据、交易记录与训练结果
- **API 后端**: Express REST API 提供数据服务
- **数据管理**: Adminer 可视化数据库管理界面

## 🚀 快速开始

训练系统快速上手入口：

- [TRAIN_OPERATOR_GUIDE.md](/Users/ts-changchang.zhuang/git/money/TRAIN_OPERATOR_GUIDE.md)
- [train/METHODOLOGY.md](/Users/ts-changchang.zhuang/git/money/train/METHODOLOGY.md)
- [train/PLAYBOOK.md](/Users/ts-changchang.zhuang/git/money/train/PLAYBOOK.md)

### 1. 启动基础服务

```bash
docker compose up -d mysql api frontend adminer
```

服务端口:
- API: http://localhost:3001
- Adminer: http://localhost:8080
- MySQL: localhost:3306

### 2. 初始化 train 数据库对象

```bash
docker compose run --rm train sh -lc "npm install && npm run build && npm run init-db"
```

### 3. 导入数据到数据库

```bash
docker compose exec api npm run import
```

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

## 📊 Adminer 数据库管理

访问 http://localhost:8080

登录信息:
- 系统: MySQL
- 服务器: mysql
- 用户名: trader
- 密码: traderpass
- 数据库: trading

## 🔧 API 接口

### K 线数据

```bash
# 获取 K 线数据
GET /api/klines?symbol=USDJPY&interval=1m&limit=1000

# 批量插入 K 线
POST /api/klines/bulk
```

### 交易记录

```bash
# 获取交易列表
GET /api/trades

# 创建交易记录
POST /api/trades

# 获取交易统计
GET /api/trades/stats/summary
```

## 📁 项目结构

```text
money/
├── database/                 # 共享数据库 schema / SQL / DB helper
├── backend/                  # 后端 API
│   ├── routes/              # API 路由
│   ├── scripts/             # 数据导入脚本
│   └── lib/                 # 后端运行时辅助逻辑
├── frontend/                # 前端应用
│   ├── src/components/      # React 组件
│   ├── src/api/            # API 客户端
│   └── src/utils/          # 技术指标计算
├── train/                   # 训练 / 验证 / router 验证
│   ├── src/scripts/         # 正式运行入口
│   ├── src/services/        # 训练主链路服务
│   ├── configs/             # 训练 / 验证 / router 配置
│   └── scripts/             # 仅保留少量配套辅助脚本
├── data/                    # 原始数据文件
└── docker-compose.yml       # Docker 配置
```

## 🎮 使用说明

1. **回放控制**: 使用播放/暂停按钮控制 K 线回放
2. **选择方向**: 做多或做空
3. **设置价格**: 使用当前价格或指定自定义价格
4. **配置参数**: 持仓时间、止损止盈、仓位大小
5. **开始交易**: 交易结果自动保存到数据库

## 🛠️ 开发命令

```bash
# 启动基础服务
docker compose up -d mysql api frontend adminer

# 初始化 train
docker compose run --rm train sh -lc "npm install && npm run build && npm run init-db"

# 导入数据
docker compose exec api npm run import

# 启动前端
cd frontend && npm run dev
```

## 📄 许可证

MIT
