.PHONY: help up down restart logs logs-train ps shell mysql db-init db-backup db-tables train validate rolling-all rolling-train rolling-validate clean

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
	@echo "  make logs            - 查看所有服务日志"
	@echo "  make logs-train      - 查看训练服务日志"
	@echo "  make ps              - 查看服务状态"
	@echo ""
	@echo "🔧 容器交互:"
	@echo "  make shell           - 进入train容器bash"
	@echo "  make mysql           - 进入MySQL客户端"
	@echo ""
	@echo "🗄️  数据库:"
	@echo "  make db-init         - 初始化数据库（创建表）"
	@echo "  make db-backup       - 备份数据库"
	@echo "  make db-tables       - 查看所有表"
	@echo ""
	@echo "🎯 核心流程:"
	@echo "  1. 训练 - 通过 TYPE/CONFIG 格式指定配置文件"
	@echo "     make train CONFIG=training/2024_atr                      # 年度训练"
	@echo "     make train CONFIG=training/2025_atr                      # 年度训练"
	@echo "     make train CONFIG=training/2025_01_rolling               # 滚动窗口"
	@echo ""
	@echo "  2. 验证 - 通过 TYPE/CONFIG 格式指定配置文件（自动保存 Top 10）"
	@echo "     make validate CONFIG=validation/2024_atr_2025_validation     # 年度验证"
	@echo "     make validate CONFIG=validation/2025_01_rolling_2025_01_validation  # 滚动验证"
	@echo ""
	@echo "🔄 批量操作:"
	@echo "  make rolling-all        # 训练+验证所有滚动窗口（2025-01到2026-02）"
	@echo "  make rolling-train      # 只训练所有滚动窗口"
	@echo "  make rolling-validate   # 只验证所有滚动窗口"
	@echo ""
	@echo "🧹 清理:"
	@echo "  make clean           - 清理临时文件"
	@echo ""
	@echo "════════════════════════════════════════════════════════════════"

# ============================================================================
# Docker 容器管理
# ============================================================================

up:
	@echo "🚀 启动所有服务..."
	docker-compose up -d
	@echo "✅ 服务已启动"

down:
	@echo "⏹  停止所有服务..."
	docker-compose down
	@echo "✅ 服务已停止"

restart:
	@echo "🔄 重启所有服务..."
	docker-compose restart
	@echo "✅ 服务已重启"

logs:
	docker-compose logs -f --tail=100

logs-train:
	docker-compose logs -f train --tail=100

ps:
	@echo ""
	@echo "📊 服务状态:"
	@docker-compose ps
	@echo ""

shell:
	@echo "🐚 进入train容器..."
	docker-compose run --rm train bash

mysql:
	@echo "🗄️  连接MySQL数据库..."
	docker-compose exec mysql mysql -u trader -ptraderpass trading

# ============================================================================
# 数据库操作
# ============================================================================

db-init:
	@echo "🗄️  初始化数据库..."
	@docker-compose run --rm train sh -c "npm install && npm run build && npm run init-db"

db-backup:
	@echo "💾 备份数据库..."
	@mkdir -p backups
	@TIMESTAMP=$$(date +%Y%m%d_%H%M%S); \
	docker-compose exec mysql mysqldump -u root -prootpassword trading > backups/trading_$$TIMESTAMP.sql
	@echo "✅ 备份完成: backups/trading_$$TIMESTAMP.sql"

db-tables:
	@echo "📋 数据库表列表:"
	@docker-compose exec mysql mysql -u trader -ptraderpass trading -e "SHOW TABLES;"

# ============================================================================
# 1. 训练流程 - 通过 CONFIG 参数指定配置文件
# ============================================================================

# 通用训练命令（需要指定CONFIG参数，格式: TYPE/NAME）
train:
	@if [ -z "$(CONFIG)" ]; then \
		echo "❌ 请指定配置文件（格式: TYPE/NAME，不含.json后缀）"; \
		echo ""; \
		echo "📖 使用方法:"; \
		echo "  make train CONFIG=training/2024_atr                     # 年度训练"; \
		echo "  make train CONFIG=training/2025_atr                     # 年度训练"; \
		echo "  make train CONFIG=training/2025_01_rolling              # 滚动窗口"; \
		echo "  make train CONFIG=training/2025_02_rolling              # 滚动窗口"; \
		echo ""; \
		exit 1; \
	fi
	@CONFIG_PATH="$(CONFIG).json"; \
	echo "🎯 开始训练: $$CONFIG_PATH"; \
	docker-compose run --rm train sh -c "npm install && npm run build && npm run train configs/$$CONFIG_PATH"

# ============================================================================
# 2. 验证流程 - 通过 CONFIG 参数指定配置文件
# ============================================================================

# 通用验证命令（需要指定CONFIG参数，格式: TYPE/NAME）
validate:
	@if [ -z "$(CONFIG)" ]; then \
		echo "❌ 请指定配置文件（格式: TYPE/NAME，不含.json后缀）"; \
		echo ""; \
		echo "📖 使用方法:"; \
		echo "  make validate CONFIG=validation/2024_atr_2025_validation            # 年度验证"; \
		echo "  make validate CONFIG=validation/2024_atr_2026_validation            # 年度验证"; \
		echo "  make validate CONFIG=validation/2025_01_rolling_2025_01_validation  # 滚动验证"; \
		echo "  make validate CONFIG=validation/2025_02_rolling_2025_02_validation  # 滚动验证"; \
		echo ""; \
		exit 1; \
	fi
	@CONFIG_PATH="$(CONFIG).json"; \
	echo "✅ 开始验证: $$CONFIG_PATH"; \
	docker-compose run --rm train sh -c "npm install && npm run build && npm run validate configs/$$CONFIG_PATH"

# ============================================================================
# 3. 批量操作
# ============================================================================

# 批量滚动窗口训练+验证（默认：训练+验证全部）
rolling-all:
	@echo "🔄 开始批量滚动窗口处理..."
	@bash train/scripts/run-all-rolling.sh

# 只训练所有滚动窗口
rolling-train:
	@echo "🎯 只训练所有滚动窗口..."
	@bash train/scripts/run-all-rolling.sh --train-only

# 只验证所有滚动窗口
rolling-validate:
	@echo "✅ 只验证所有滚动窗口..."
	@bash train/scripts/run-all-rolling.sh --validate-only

# ============================================================================
# 清理
# ============================================================================

clean:
	@echo "🧹 清理临时文件..."
	find . -name "*.log" -type f -delete
	find . -name ".DS_Store" -type f -delete
	find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	@echo "✅ 清理完成"
