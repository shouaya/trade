# 💹 USD/JPY 交易模拟器

一个功能完整的外汇交易模拟和回测系统，支持 K 线可视化、技术指标分析、交易记录和回放功能。

## 🎯 功能特点

- **实时 K 线回放**: 按分钟回放历史 K 线数据
- **技术指标**: RSI(14) 和 MACD(12,26,9) 实时计算和显示
- **交易模拟**: 支持做多/做空、自定义入场价格、止损止盈
- **数据持久化**: MySQL 数据库存储 K 线数据和交易记录
- **API 后端**: Express REST API 提供数据服务
- **数据管理**: Adminer 可视化数据库管理界面

## 🚀 快速开始

### 1. 获取样本数据

```bash
npm run fetch:sample
```

### 2. 启动后端服务

```bash
docker-compose up -d
```

服务端口:
- API: http://localhost:3001
- Adminer: http://localhost:8080
- MySQL: localhost:3306

### 3. 导入数据到数据库

```bash
docker-compose exec api npm run import
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

```
money/
├── backend/                  # 后端 API
│   ├── routes/              # API 路由
│   ├── scripts/             # 数据导入脚本
│   └── sql/                 # 数据库初始化
├── frontend/                # 前端应用
│   ├── src/components/      # React 组件
│   ├── src/api/            # API 客户端
│   └── src/utils/          # 技术指标计算
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
# 获取样本数据
npm run fetch:sample

# 启动后端
docker-compose up -d

# 导入数据
docker-compose exec api npm run import

# 启动前端
cd frontend && npm run dev
```

## 📄 许可证

MIT
