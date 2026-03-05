.PHONY: help up down restart logs ps shell mysql train analyze validate clean test

# ============================================================================
# 默认命令：显示帮助
# ============================================================================
help:
	@echo "════════════════════════════════════════════════════════════════"
	@echo "  Trading System - Make 命令集"
	@echo "════════════════════════════════════════════════════════════════"
	@echo ""
	@echo "📦 Docker 容器管理:"
	@echo "  make up              - 启动所有服务"
	@echo "  make down            - 停止所有服务"
	@echo "  make restart         - 重启所有服务"
	@echo "  make logs            - 查看日志（所有服务）"
	@echo "  make logs-train      - 查看训练服务日志"
	@echo "  make logs-backend    - 查看后端服务日志"
	@echo "  make logs-mysql      - 查看MySQL日志"
	@echo "  make ps              - 查看服务状态"
	@echo ""
	@echo "🔧 容器交互:"
	@echo "  make shell           - 进入train容器bash"
	@echo "  make shell-backend   - 进入backend容器bash"
	@echo "  make mysql           - 进入MySQL客户端"
	@echo "  make mysql-root      - 以root进入MySQL"
	@echo ""
	@echo "🎯 策略训练:"
	@echo "  make train           - 通用训练（需指定配置）"
	@echo "  make train-2024-rsi  - 训练2024年V3 RSI策略"
	@echo "  make train-quick     - 快速测试训练系统"
	@echo "  make train-group     - 大规模并行训练"
	@echo "  make train-monitor   - 监控并行训练进度"
	@echo ""
	@echo "🔄 滚动窗口训练:"
	@echo "  make rolling-all     - 执行完整滚动窗口训练（14个月）"
	@echo "  make rolling-month   - 训练指定月份（需MONTH=2025-01）"
	@echo "  make rolling-report  - 查看滚动窗口汇总报告"
	@echo "  make rolling-verify  - 验证所有月份结果"
	@echo ""
	@echo "📊 结果分析:"
	@echo "  make analyze         - 通用分析（需指定表名）"
	@echo "  make analyze-2024    - 分析2024年V3优化版结果"
	@echo "  make query-top10     - 查询多维度Top10策略"
	@echo "  make query-metrics   - 查询多指标Top策略（需指定表名）"
	@echo ""
	@echo "✅ 策略验证:"
	@echo "  make validate        - 验证策略"
	@echo "  make validate-top    - 验证Top策略"
	@echo ""
	@echo "💾 策略保存:"
	@echo "  make save-top3       - 保存Top 3策略"
	@echo "  make save-top10      - 保存去重Top 10策略"
	@echo ""
	@echo "🔍 数据库操作:"
	@echo "  make db-backup       - 备份数据库"
	@echo "  make db-tables       - 查看所有表"
	@echo "  make db-size         - 查看数据库大小"
	@echo "  make db-clean        - 清理旧的回测结果"
	@echo ""
	@echo "🧪 测试 & 开发:"
	@echo "  make test            - 运行测试"
	@echo "  make test-quick      - 快速系统测试"
	@echo "  make lint            - 代码检查"
	@echo ""
	@echo "🧹 清理:"
	@echo "  make clean           - 清理临时文件"
	@echo "  make clean-logs      - 清理日志文件"
	@echo "  make clean-all       - 清理所有（包括容器和数据）"
	@echo ""
	@echo "════════════════════════════════════════════════════════════════"

# ============================================================================
# Docker 容器管理
# ============================================================================

# 启动所有服务
up:
	@echo "🚀 启动所有服务..."
	docker-compose up -d
	@echo "✅ 服务已启动"
	@make ps

# 停止所有服务
down:
	@echo "⏹  停止所有服务..."
	docker-compose down
	@echo "✅ 服务已停止"

# 重启所有服务
restart:
	@echo "🔄 重启所有服务..."
	docker-compose restart
	@echo "✅ 服务已重启"

# 查看所有日志
logs:
	docker-compose logs -f --tail=100

# 查看训练服务日志
logs-train:
	docker-compose logs -f train --tail=100

# 查看后端服务日志
logs-backend:
	docker-compose logs -f backend --tail=100

# 查看MySQL日志
logs-mysql:
	docker-compose logs -f mysql --tail=100

# 查看服务状态
ps:
	@echo ""
	@echo "📊 服务状态:"
	@docker-compose ps
	@echo ""

# ============================================================================
# 容器交互
# ============================================================================

# 进入train容器
shell:
	@echo "🐚 进入train容器..."
	docker-compose run --rm train bash

# 进入backend容器
shell-backend:
	@echo "🐚 进入backend容器..."
	docker-compose exec backend bash

# 进入MySQL客户端（trader用户）
mysql:
	@echo "🗄️  连接MySQL数据库..."
	docker-compose exec mysql mysql -u trader -ptraderpass trading

# 进入MySQL客户端（root用户）
mysql-root:
	@echo "🗄️  以root连接MySQL..."
	docker-compose exec mysql mysql -u root -prootpassword trading

# ============================================================================
# 策略训练
# ============================================================================

# 通用训练（需要指定CONFIG变量）
train:
	@if [ -z "$(CONFIG)" ]; then \
		echo "❌ 请指定配置文件"; \
		echo "用法: make train CONFIG=configs/training/2024_v3_rsi_only.json"; \
		exit 1; \
	fi
	@echo "🎯 开始训练: $(CONFIG)"
	docker-compose run --rm train node scripts/train.js $(CONFIG)

# 训练2024年V3 RSI策略
train-2024-rsi:
	@echo "🎯 训练2024年V3 RSI策略..."
	docker-compose run --rm train npm run train:2024:v3:rsi

# 快速测试训练系统
train-quick:
	@echo "🧪 快速测试训练系统..."
	docker-compose run --rm train node scripts/quick-test.js

# 大规模并行训练
train-group:
	@echo "🚀 启动大规模并行训练..."
	@echo "⚠️  这将启动10个并行进程"
	@read -p "继续? [y/N] " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		docker-compose run --rm train bash scripts/launch-strategy-group-backtest.sh; \
	else \
		echo "已取消"; \
	fi

# 监控并行训练进度
train-monitor:
	@echo "📊 监控并行训练进度..."
	docker-compose run --rm train bash scripts/monitor-strategy-group-backtest.sh

# 停止并行训练
train-stop:
	@echo "⏹  停止并行训练..."
	docker-compose run --rm train bash scripts/stop-strategy-group-backtest.sh

# ============================================================================
# 滚动窗口训练
# ============================================================================

# 执行完整滚动窗口训练（14个月）
rolling-all:
	@echo "🔄 开始滚动窗口训练..."
	@echo "⏰ 预计耗时: 3-5小时"
	@echo "📅 训练月份: 2025-01 至 2026-02 (14个月)"
	@echo ""
	@read -p "确认开始训练? [y/N] " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		cd train && node scripts/run-rolling-window-training.js; \
	else \
		echo "已取消"; \
	fi

# 训练指定月份的滚动窗口策略
rolling-month:
	@if [ -z "$(MONTH)" ]; then \
		echo "❌ 请指定月份"; \
		echo "用法: make rolling-month MONTH=2025-01"; \
		echo "可用月份: 2025-01 到 2026-02"; \
		exit 1; \
	fi
	@echo "🎯 训练滚动窗口: $(MONTH)"
	@TRAIN_FILE=train/configs/rolling_window/train_$$(echo $(MONTH) | tr '-' '_').json; \
	if [ ! -f "$$TRAIN_FILE" ]; then \
		echo "❌ 配置文件不存在: $$TRAIN_FILE"; \
		exit 1; \
	fi; \
	echo "📄 配置文件: $$TRAIN_FILE"; \
	docker-compose run --rm train node scripts/train.js $$TRAIN_FILE

# 验证指定月份的最佳策略
rolling-validate:
	@if [ -z "$(MONTH)" ]; then \
		echo "❌ 请指定月份"; \
		echo "用法: make rolling-validate MONTH=2025-01"; \
		exit 1; \
	fi
	@echo "✅ 验证滚动窗口最佳策略: $(MONTH)"
	@VALIDATE_FILE=train/configs/rolling_window/validation/validate_$$(echo $(MONTH) | tr '-' '_').json; \
	if [ ! -f "$$VALIDATE_FILE" ]; then \
		echo "❌ 配置文件不存在: $$VALIDATE_FILE"; \
		exit 1; \
	fi; \
	docker-compose run --rm train node scripts/train.js $$VALIDATE_FILE

# 查看滚动窗口汇总报告
rolling-report:
	@if [ ! -f "train/reports/rolling_window_summary.json" ]; then \
		echo "❌ 报告文件不存在"; \
		echo "请先运行: make rolling-all"; \
		exit 1; \
	fi
	@echo "📊 滚动窗口汇总报告"
	@echo "════════════════════════════════════════════════════════════════"
	@cat train/reports/rolling_window_summary.json | python3 -m json.tool

# 验证所有月份的数据库结果
rolling-verify:
	@echo "🔍 验证所有月份的数据库结果..."
	@docker-compose run --rm train node scripts/rolling-verify.js

# 查询指定月份的训练Top 10
rolling-top10:
	@if [ -z "$(MONTH)" ]; then \
		echo "❌ 请指定月份"; \
		echo "用法: make rolling-top10 MONTH=2025-01"; \
		exit 1; \
	fi
	@echo "📊 查询 $(MONTH) 训练Top 10策略"
	@docker-compose run --rm train node -e "\
		const mysql = require('mysql2/promise'); \
		require('dotenv').config(); \
		\
		(async () => { \
		  const db = await mysql.createConnection({ \
		    host: process.env.DB_HOST, \
		    port: process.env.DB_PORT, \
		    user: process.env.DB_USER, \
		    password: process.env.DB_PASSWORD, \
		    database: process.env.DB_NAME \
		  }); \
		  \
		  const month = '$(MONTH)'.replace('-', '_'); \
		  const [results] = await db.query(\`\
		    SELECT strategy_name, total_pnl, total_trades, win_rate, sharpe_ratio \
		    FROM backtest_results_rolling_\$${month}_train \
		    ORDER BY total_pnl DESC \
		    LIMIT 10 \
		  \`); \
		  \
		  console.table(results); \
		  await db.end(); \
		})().catch(console.error); \
	"

# 查询指定月份的验证结果
rolling-validate-result:
	@if [ -z "$(MONTH)" ]; then \
		echo "❌ 请指定月份"; \
		echo "用法: make rolling-validate-result MONTH=2025-01"; \
		exit 1; \
	fi
	@echo "📊 查询 $(MONTH) 验证结果"
	@docker-compose run --rm train node -e "\
		const mysql = require('mysql2/promise'); \
		require('dotenv').config(); \
		\
		(async () => { \
		  const db = await mysql.createConnection({ \
		    host: process.env.DB_HOST, \
		    port: process.env.DB_PORT, \
		    user: process.env.DB_USER, \
		    password: process.env.DB_PASSWORD, \
		    database: process.env.DB_NAME \
		  }); \
		  \
		  const month = '$(MONTH)'.replace('-', '_'); \
		  const [results] = await db.query(\`\
		    SELECT strategy_name, total_pnl, total_trades, win_rate, sharpe_ratio, profit_factor \
		    FROM backtest_results_rolling_\$${month}_validate \
		    ORDER BY total_pnl DESC \
		  \`); \
		  \
		  console.table(results); \
		  await db.end(); \
		})().catch(console.error); \
	"

# 对比所有月份验证结果
rolling-compare:
	@echo "📊 对比所有月份验证结果..."
	@docker-compose run --rm train node scripts/rolling-compare.js

# 生成训练汇总报告
rolling-training-report:
	@echo "📊 生成训练期汇总报告..."
	@docker-compose run --rm train node scripts/generate-training-summary.js

# 只运行验证步骤（跳过训练）
rolling-validate-all:
	@echo "🔄 开始滚动窗口验证（仅验证，跳过训练）..."
	@echo "⏰ 预计耗时: 1-2小时"
	@echo "📅 验证月份: 2025-01 至 2026-02 (14个月)"
	@echo ""
	@read -p "确认开始验证? [y/N] " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		docker-compose run --rm train node scripts/run-validation-only.js; \
	else \
		echo "已取消"; \
	fi

# ============================================================================
# 结果分析
# ============================================================================

# 通用分析（需要指定TABLE变量）
analyze:
	@if [ -z "$(TABLE)" ]; then \
		echo "❌ 请指定结果表名"; \
		echo "用法: make analyze TABLE=backtest_results_2024_v3_optimized"; \
		exit 1; \
	fi
	@echo "📊 分析结果表: $(TABLE)"
	docker-compose run --rm train node scripts/analyze.js $(TABLE) $(TOP)

# 分析2024年V3优化版结果
analyze-2024:
	@echo "📊 分析2024年V3优化版结果..."
	docker-compose run --rm train npm run analyze:2024:v3:opt

# 查询多维度Top10策略
query-top10:
	@echo "📊 查询多维度Top10策略..."
	docker-compose run --rm train npm run query:top10

# 查询多指标Top策略（盈亏、胜率、夏普、盈亏比）
query-metrics:
	@if [ -z "$(TABLE)" ]; then \
		echo "❌ 请指定结果表名"; \
		echo "用法: make query-metrics TABLE=backtest_results_2024_v3_holdtime"; \
		exit 1; \
	fi
	@echo "📊 查询多指标Top策略: $(TABLE)"
	docker-compose run --rm train node scripts/query-top-by-metrics.js $(TABLE) $(TOP)

# ============================================================================
# 策略验证
# ============================================================================

# 验证策略
validate:
	@echo "✅ 验证策略..."
	docker-compose run --rm train npm run validate

# 验证Top策略
validate-top:
	@echo "✅ 验证Top策略..."
	docker-compose run --rm train npm run validate:top

# ============================================================================
# 策略保存
# ============================================================================

# 保存Top 3策略
save-top3:
	@echo "💾 保存Top 3策略..."
	docker-compose run --rm train npm run save:top3

# 保存去重Top 10策略
save-top10:
	@echo "💾 保存去重Top 10策略..."
	docker-compose run --rm train npm run save:top10

# ============================================================================
# 数据库操作
# ============================================================================

# 备份数据库
db-backup:
	@echo "💾 备份数据库..."
	@mkdir -p backups
	@TIMESTAMP=$$(date +%Y%m%d_%H%M%S); \
	docker-compose exec mysql mysqldump -u root -prootpassword trading > backups/trading_$$TIMESTAMP.sql
	@echo "✅ 备份完成: backups/trading_$$TIMESTAMP.sql"

# 查看所有表
db-tables:
	@echo "📋 数据库表列表:"
	@docker-compose exec mysql mysql -u trader -ptraderpass trading -e "SHOW TABLES;"

# 查看数据库大小
db-size:
	@echo "📊 数据库大小:"
	@docker-compose exec mysql mysql -u trader -ptraderpass trading -e "\
		SELECT \
			table_name AS 'Table', \
			ROUND(((data_length + index_length) / 1024 / 1024), 2) AS 'Size (MB)' \
		FROM information_schema.TABLES \
		WHERE table_schema = 'trading' \
		ORDER BY (data_length + index_length) DESC;"

# 清理旧的回测结果（保留最近7天）
db-clean:
	@echo "🧹 清理旧的回测结果（保留最近7天）..."
	@read -p "确认清理? [y/N] " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		docker-compose exec mysql mysql -u trader -ptraderpass trading -e "\
			DELETE FROM backtest_results WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY);"; \
		echo "✅ 清理完成"; \
	else \
		echo "已取消"; \
	fi

# 查看回测结果统计
db-stats:
	@echo "📊 回测结果统计:"
	@docker-compose exec mysql mysql -u trader -ptraderpass trading -e "\
		SELECT \
			DATE(created_at) as date, \
			COUNT(*) as strategies, \
			AVG(total_pnl) as avg_pnl, \
			MAX(total_pnl) as max_pnl \
		FROM backtest_results \
		GROUP BY DATE(created_at) \
		ORDER BY date DESC \
		LIMIT 10;"

# ============================================================================
# 测试 & 开发
# ============================================================================

# 运行测试
test:
	@echo "🧪 运行测试..."
	docker-compose run --rm train npm test

# 快速系统测试
test-quick:
	@echo "🧪 快速系统测试..."
	docker-compose run --rm train node scripts/quick-test.js

# 代码检查
lint:
	@echo "🔍 代码检查..."
	@echo "⚠️  lint功能待实现"

# ============================================================================
# 清理
# ============================================================================

# 清理临时文件
clean:
	@echo "🧹 清理临时文件..."
	find . -name "*.log" -type f -delete
	find . -name ".DS_Store" -type f -delete
	find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete
	@echo "✅ 清理完成"

# 清理日志文件
clean-logs:
	@echo "🧹 清理日志文件..."
	@read -p "确认清理所有日志? [y/N] " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		rm -rf train/logs/*; \
		rm -rf backend/logs/*; \
		echo "✅ 日志清理完成"; \
	else \
		echo "已取消"; \
	fi

# 清理所有（危险操作）
clean-all:
	@echo "⚠️  警告：这将删除所有容器、数据卷和临时文件！"
	@read -p "确认清理? [y/N] " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		docker-compose down -v; \
		make clean; \
		make clean-logs; \
		echo "✅ 全部清理完成"; \
	else \
		echo "已取消"; \
	fi

# ============================================================================
# 快捷组合命令
# ============================================================================

# 完整的训练流程：训练 -> 分析 -> 保存Top3
train-full-2024:
	@echo "🎯 执行完整训练流程..."
	@make train-2024-rsi
	@make analyze-2024
	@make save-top3
	@echo "✅ 完整流程执行完成"

# 重启服务并查看状态
restart-check:
	@make restart
	@sleep 3
	@make ps

# 开发环境初始化
dev-init:
	@echo "🔧 初始化开发环境..."
	@make up
	@sleep 5
	@make db-tables
	@make test-quick
	@echo "✅ 开发环境就绪"

# ============================================================================
# 帮助文档
# ============================================================================

# 显示训练配置示例
help-train:
	@echo "════════════════════════════════════════════════════════════════"
	@echo "  训练配置示例"
	@echo "════════════════════════════════════════════════════════════════"
	@echo ""
	@echo "1. 使用预定义配置:"
	@echo "   make train-2024-rsi"
	@echo ""
	@echo "2. 使用自定义配置:"
	@echo "   make train CONFIG=configs/training/custom.json"
	@echo ""
	@echo "3. 大规模并行训练:"
	@echo "   make train-group"
	@echo "   make train-monitor  # 另一个终端监控"
	@echo ""
	@echo "════════════════════════════════════════════════════════════════"

# 显示分析命令示例
help-analyze:
	@echo "════════════════════════════════════════════════════════════════"
	@echo "  分析命令示例"
	@echo "════════════════════════════════════════════════════════════════"
	@echo ""
	@echo "1. 分析指定表:"
	@echo "   make analyze TABLE=backtest_results_2024_v3_optimized"
	@echo ""
	@echo "2. 指定Top N:"
	@echo "   make analyze TABLE=backtest_results_2024_v3_optimized TOP=20"
	@echo ""
	@echo "3. 预定义分析:"
	@echo "   make analyze-2024"
	@echo ""
	@echo "4. 多维度查询:"
	@echo "   make query-top10"
	@echo ""
	@echo "════════════════════════════════════════════════════════════════"

# 显示数据库命令示例
help-db:
	@echo "════════════════════════════════════════════════════════════════"
	@echo "  数据库命令示例"
	@echo "════════════════════════════════════════════════════════════════"
	@echo ""
	@echo "1. 进入MySQL:"
	@echo "   make mysql          # trader用户"
	@echo "   make mysql-root     # root用户"
	@echo ""
	@echo "2. 查看数据:"
	@echo "   make db-tables      # 所有表"
	@echo "   make db-size        # 表大小"
	@echo "   make db-stats       # 回测统计"
	@echo ""
	@echo "3. 维护:"
	@echo "   make db-backup      # 备份"
	@echo "   make db-clean       # 清理旧数据"
	@echo ""
	@echo "════════════════════════════════════════════════════════════════"

# 显示滚动窗口命令示例
help-rolling:
	@echo "════════════════════════════════════════════════════════════════"
	@echo "  滚动窗口训练命令示例"
	@echo "════════════════════════════════════════════════════════════════"
	@echo ""
	@echo "📖 什么是滚动窗口策略?"
	@echo "   每个月使用过去12个月的数据训练最佳策略，然后只在当月验证"
	@echo "   这样可以让策略始终适应最新的市场环境"
	@echo ""
	@echo "🎯 完整流程（推荐）:"
	@echo "   make rolling-all           # 执行完整14个月训练（3-5小时）"
	@echo "   make rolling-report        # 查看汇总报告"
	@echo "   make rolling-compare       # 对比所有月份结果"
	@echo ""
	@echo "📅 单月训练:"
	@echo "   make rolling-month MONTH=2025-01          # 训练指定月份"
	@echo "   make rolling-validate MONTH=2025-01       # 验证指定月份"
	@echo "   make rolling-top10 MONTH=2025-01          # 查看训练Top10"
	@echo "   make rolling-validate-result MONTH=2025-01  # 查看验证结果"
	@echo ""
	@echo "🔍 结果查询:"
	@echo "   make rolling-verify        # 验证所有月份数据"
	@echo "   make rolling-compare       # 对比所有月份最佳策略"
	@echo ""
	@echo "💡 示例工作流:"
	@echo "   1. make rolling-all                      # 执行完整训练"
	@echo "   2. make rolling-compare                  # 查看所有月份对比"
	@echo "   3. make rolling-top10 MONTH=2025-01      # 查看某月训练详情"
	@echo "   4. make rolling-validate-result MONTH=2025-01  # 查看验证详情"
	@echo ""
	@echo "📊 月份范围: 2025-01 至 2026-02 (14个月)"
	@echo ""
	@echo "════════════════════════════════════════════════════════════════"
