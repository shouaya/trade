ifeq ($(OS),Windows_NT)
SHELL := C:/Windows/System32/bash.exe
MAKESHELL := C:/Windows/System32/bash.exe
else
SHELL := /bin/bash
endif

.SHELLFLAGS := -lc

define require_var
$(if $($(1)),,$(error 缺少参数 $(1). 示例: $(2)))
endef

.PHONY: help up down restart logs logs-train ps shell mysql db-init db-backup db-tables import clear-klines reimport-klines train validate rolling-all rolling-train rolling-validate weekly-rolling weekly-rolling-history clean

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
	@echo "  make db-init         - 重建所有核心表（klines/backtest_results/strategies/trades/tasks）"
	@echo "  make db-backup       - 备份数据库"
	@echo "  make db-tables       - 查看所有表"
	@echo "  make clear-klines type=fx symbol=USD_JPY interval=1min startDate=20250101 endDate=20250131"
	@echo "  make import type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20250101 endDate=20250131"
	@echo "  make reimport-klines type=coin symbol=BTC_JPY interval=1min startDate=20250101 endDate=20250131"
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
	@echo "  make weekly-rolling CUTOFF=2026-01-30    # 运行周度rolling MVP"
	@echo "  make weekly-rolling-history START=2024-04-05 END=2026-02-20   # 批量回放周度rolling"
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
	@echo "🗄️  重建所有核心表..."
	@docker-compose exec api sh -lc "npm install && npm run init-db"
	@docker-compose run --rm train sh -lc "npm install && npm run build && npm run init-db"
	@echo "✅ backend + train 表初始化完成"

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
# K线导入/清理
# ============================================================================

clear-klines:
	@$(call require_var,type,make clear-klines type=fx symbol=USD_JPY interval=1min startDate=20250101 endDate=20250131)
	@$(call require_var,symbol,make clear-klines type=fx symbol=USD_JPY interval=1min startDate=20250101 endDate=20250131)
	@$(call require_var,interval,make clear-klines type=fx symbol=USD_JPY interval=1min startDate=20250101 endDate=20250131)
	@echo "🧹 清除K线: type=$(type) symbol=$(symbol) interval=$(interval) start=$(startDate) end=$(endDate)"
	@docker-compose exec api sh -lc "npm run clear-klines -- type=$(type) symbol=$(symbol) interval=$(interval) startDate=$(startDate) endDate=$(endDate)"

import:
	@$(call require_var,type,make import type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20250101 endDate=20250131)
	@$(call require_var,symbol,make import type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20250101 endDate=20250131)
	@$(call require_var,interval,make import type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20250101 endDate=20250131)
	@$(call require_var,startDate,make import type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20250101 endDate=20250131)
	@$(call require_var,endDate,make import type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20250101 endDate=20250131)
	@echo "📥 导入K线: type=$(type) symbol=$(symbol) interval=$(interval) priceType=$(priceType) start=$(startDate) end=$(endDate)"
	@docker-compose exec api sh -lc "npm run import -- type=$(type) symbol=$(symbol) interval=$(interval) priceType=$(if $(priceType),$(priceType),BOTH) startDate=$(startDate) endDate=$(endDate)"

reimport-klines:
	@$(call require_var,type,make reimport-klines type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20250101 endDate=20250131)
	@$(call require_var,symbol,make reimport-klines type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20250101 endDate=20250131)
	@$(call require_var,interval,make reimport-klines type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20250101 endDate=20250131)
	@$(call require_var,startDate,make reimport-klines type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20250101 endDate=20250131)
	@$(call require_var,endDate,make reimport-klines type=fx symbol=USD_JPY interval=1min priceType=BOTH startDate=20250101 endDate=20250131)
	@$(MAKE) clear-klines type=$(type) symbol=$(symbol) interval=$(interval) startDate=$(startDate) endDate=$(endDate)
	@$(MAKE) import type=$(type) symbol=$(symbol) interval=$(interval) priceType=$(if $(priceType),$(priceType),BOTH) startDate=$(startDate) endDate=$(endDate)

# ============================================================================
# 1. 训练流程 - 通过 CONFIG 参数指定配置文件
# ============================================================================

# 通用训练命令（需要指定CONFIG参数，格式: TYPE/NAME）
train:
	@$(call require_var,CONFIG,make train CONFIG=training/2024_atr)
	@echo "🎯 开始训练: $(CONFIG).json"
	@docker-compose run --rm train sh -c "npm install && npm run build && npm run train configs/$(CONFIG).json"

# ============================================================================
# 2. 验证流程 - 通过 CONFIG 参数指定配置文件
# ============================================================================

# 通用验证命令（需要指定CONFIG参数，格式: TYPE/NAME）
validate:
	@$(call require_var,CONFIG,make validate CONFIG=validation/2024_atr_2025_validation)
	@echo "✅ 开始验证: $(CONFIG).json"
	@docker-compose run --rm train sh -c "npm install && npm run build && npm run validate configs/$(CONFIG).json"

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

# 周度 rolling MVP
weekly-rolling:
	@$(call require_var,CUTOFF,make weekly-rolling CUTOFF=2026-01-30)
	@echo "📅 开始周度 rolling: cutoff=$(CUTOFF)"
	@docker-compose run --rm train sh -c "npm install && npm run build && node scripts/weekly-rolling-run.js --cutoff=$(CUTOFF)"

weekly-rolling-history:
	@$(call require_var,START,make weekly-rolling-history START=2024-04-05 END=2026-02-20)
	@$(call require_var,END,make weekly-rolling-history START=2024-04-05 END=2026-02-20)
	@echo "📚 开始批量周度 rolling: start=$(START) end=$(END)"
	@docker-compose run --rm train sh -c "npm install && npm run build && node scripts/weekly-rolling-history.js --start=$(START) --end=$(END)"

# ============================================================================
# 清理
# ============================================================================

clean:
	@echo "🧹 清理临时文件..."
	find . -name "*.log" -type f -delete
	find . -name ".DS_Store" -type f -delete
	find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	@echo "✅ 清理完成"
