# 训练脚本说明

## 📁 脚本概览

### run-all-rolling.sh

**功能**: 批量执行滚动窗口训练和验证

**用途**:
- 一次性训练所有14个月的滚动窗口配置（2025-01 到 2026-02）
- 自动对每个训练结果进行验证
- 适合大规模批量处理

**使用方法**:

```bash
# 通过 Makefile（推荐）
make rolling-all                    # 训练 + 验证所有月份
make rolling-train                  # 只训练
make rolling-validate               # 只验证

# 直接运行脚本
bash train/scripts/run-all-rolling.sh                # 训练 + 验证
bash train/scripts/run-all-rolling.sh --train-only   # 只训练
bash train/scripts/run-all-rolling.sh --validate-only # 只验证

# 指定范围
bash train/scripts/run-all-rolling.sh --start 202501 --end 202512

# 查看帮助
bash train/scripts/run-all-rolling.sh --help
```

**选项**:
- `--train-only`: 只执行训练，跳过验证
- `--validate-only`: 只执行验证，跳过训练
- `--start YYYYMM`: 指定起始月份（默认：202501）
- `--end YYYYMM`: 指定结束月份（默认：202602）
- `--help, -h`: 显示帮助信息

**输出示例**:

```
================================================================================
🚀 批量滚动窗口训练和验证
================================================================================

ℹ️  配置范围: 2025-01 到 2026-02
ℹ️  执行训练: true
ℹ️  执行验证: true

ℹ️  共 14 个月份: 2025_01 2025_02 2025_03 ... 2026_02

================================================================================
📊 阶段 1: 训练所有滚动窗口
================================================================================

ℹ️  [1/14] 训练: training/2025_01_rolling
✅ 训练完成: training/2025_01_rolling

ℹ️  [2/14] 训练: training/2025_02_rolling
✅ 训练完成: training/2025_02_rolling
...

================================================================================
✅ 阶段 2: 验证所有滚动窗口
================================================================================

ℹ️  [1/14] 验证: validation/2025_01_rolling_2025_01_validation
✅ 验证完成: validation/2025_01_rolling_2025_01_validation
...

================================================================================
📋 执行汇总
================================================================================

ℹ️  总任务数: 28
✅ 成功: 28

🎉 批量处理完成!
```

**特性**:
- ✅ 实时进度显示
- ✅ 彩色日志输出（蓝色=信息，绿色=成功，黄色=警告，红色=错误）
- ✅ 错误追踪和汇总
- ✅ 失败任务列表
- ✅ 自动中断机制（遇到错误时停止）

**预计执行时间**:

假设单个训练需要 5-10 分钟：
- 14 个月训练：约 1.5-3 小时
- 14 个月验证：约 30-60 分钟
- **总计：约 2-4 小时**

**注意事项**:

1. **确保有足够的磁盘空间**: 每个训练会生成回测结果表和交易记录
2. **监控数据库大小**: 定期清理旧的 backtest_results 表
3. **资源占用**: 训练过程会占用大量 CPU 和内存
4. **网络稳定性**: 确保 Docker 容器网络稳定

**故障排查**:

如果某个月份失败：
```bash
# 查看具体错误
docker-compose logs train

# 单独重新训练失败的月份
make train CONFIG=training/2025_03_rolling

# 单独重新验证失败的月份
make validate CONFIG=validation/2025_03_rolling_2025_03_validation
```

## 🔄 工作流程

### 完整的滚动窗口工作流

```bash
# 1. 批量训练和验证所有滚动窗口（验证时自动选出并保存 Top 10）
make rolling-all

# 2. 查看保存的最佳策略
docker-compose exec mysql mysql -u trader -ptraderpass trading \
  -e "SELECT id, name, type, description FROM strategies ORDER BY created_at DESC LIMIT 10;"
```

### 部分月份处理

如果只需要处理部分月份：

```bash
# 只处理 2025 年（12个月）
bash train/scripts/run-all-rolling.sh --start 202501 --end 202512

# 只处理 Q1（1-3月）
bash train/scripts/run-all-rolling.sh --start 202501 --end 202503

# 只处理 2026 年的数据（2个月）
bash train/scripts/run-all-rolling.sh --start 202601 --end 202602
```

## 📊 性能优化建议

### 并行处理（高级用户）

如果有多核 CPU 和足够内存，可以并行处理：

```bash
# 终端 1: 处理 2025 年上半年
bash train/scripts/run-all-rolling.sh --start 202501 --end 202506

# 终端 2: 处理 2025 年下半年
bash train/scripts/run-all-rolling.sh --start 202507 --end 202512

# 终端 3: 处理 2026 年
bash train/scripts/run-all-rolling.sh --start 202601 --end 202602
```

**注意**: 并行处理会占用更多资源，确保系统有足够的 CPU 和内存。

### 分阶段处理

如果时间紧迫，可以分阶段处理：

```bash
# 第一阶段: 先完成所有训练
make rolling-all --train-only

# 中场休息: 检查训练结果，清理资源

# 第二阶段: 再完成所有验证
make rolling-all --validate-only
```

## 📝 日志和结果

### 查看训练日志

```bash
# 实时查看训练日志
docker-compose logs -f train

# 查看最近 100 行
docker-compose logs --tail=100 train
```

### 查看回测结果

```bash
# 查看所有回测结果表
make db-tables | grep backtest_results

# 查看某个月份的 Top 10 策略
docker-compose exec mysql mysql -u trader -ptraderpass trading -e "
  SELECT strategy_name, total_trades, win_rate, total_pnl, score
  FROM backtest_results_2025_01_rolling
  ORDER BY score DESC
  LIMIT 10;
"
```

## 🔧 故障恢复

### 从中断点继续

脚本目前不支持自动断点续传，如果中断需要手动处理：

1. 查看已完成的月份
2. 修改 `--start` 参数跳过已完成的月份

```bash
# 例如：前 5 个月已完成，从第 6 个月继续
bash train/scripts/run-all-rolling.sh --start 202506 --end 202602
```

### 清理和重新开始

如果需要完全重新开始：

```bash
# 1. 停止所有训练
pkill -f "make train"

# 2. 清理数据库（可选）
docker-compose exec mysql mysql -u trader -ptraderpass trading -e "
  DROP TABLE IF EXISTS backtest_results_2025_01_rolling;
  DROP TABLE IF EXISTS backtest_results_2025_02_rolling;
  -- ... 其他月份
"

# 3. 重新开始
make rolling-all
```
