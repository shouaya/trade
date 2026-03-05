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
	@echo "📊 结果分析:"
	@echo "  make analyze         - 通用分析（需指定表名）"
	@echo "  make analyze-2024    - 分析2024年V3优化版结果"
	@echo "  make query-top10     - 查询多维度Top10策略"
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
