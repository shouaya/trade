#!/bin/bash

# ================================================================================
# 2025年12月并行回测启动脚本
# 同时启动12个进程,每个进程处理一个月的数据
# ================================================================================

echo "================================================================================"
echo "🚀 启动2025年12月并行回测"
echo "================================================================================"
echo ""
echo "配置:"
echo "  - 策略数量: 560,196"
echo "  - 并行进程: 12个 (每个月1个)"
echo "  - 预计耗时: ~560分钟 (9.3小时)"
echo ""
echo "================================================================================"
echo ""

# 切换到backend目录
cd "$(dirname "$0")/.." || exit 1

# 创建日志目录
LOGDIR="logs/parallel-backtest-2025"
mkdir -p "$LOGDIR"

echo "📁 日志目录: $LOGDIR"
echo ""

# 清理旧的月度结果表 (可选)
read -p "是否清理旧的月度结果表? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "🗑️  清理旧的月度结果表..."
  mysql -h localhost -P 3306 -u root -prootpassword trading <<EOF
    DROP TABLE IF EXISTS backtest_results_2025_01;
    DROP TABLE IF EXISTS backtest_results_2025_02;
    DROP TABLE IF EXISTS backtest_results_2025_03;
    DROP TABLE IF EXISTS backtest_results_2025_04;
    DROP TABLE IF EXISTS backtest_results_2025_05;
    DROP TABLE IF EXISTS backtest_results_2025_06;
    DROP TABLE IF EXISTS backtest_results_2025_07;
    DROP TABLE IF EXISTS backtest_results_2025_08;
    DROP TABLE IF EXISTS backtest_results_2025_09;
    DROP TABLE IF EXISTS backtest_results_2025_10;
    DROP TABLE IF EXISTS backtest_results_2025_11;
    DROP TABLE IF EXISTS backtest_results_2025_12;
EOF
  echo "✅ 清理完成"
  echo ""
fi

# 记录启动时间
START_TIME=$(date +%s)
echo "⏰ 开始时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

echo "🚀 启动12个并行进程..."
echo ""

# 启动12个月份的回测进程
# 使用明确的月份列表以确保兼容性
for month in 01 02 03 04 05 06 07 08 09 10 11 12; do
  SCRIPT="scripts/run-backtest-2025-m${month}.js"
  LOGFILE="$LOGDIR/month-${month}.log"

  echo "  [月${month}] 启动: node ${SCRIPT}"
  echo "         日志: ${LOGFILE}"

  nohup node "$SCRIPT" > "$LOGFILE" 2>&1 &
  PID=$!
  echo "         PID: ${PID}"
  echo ""

  # 记录PID到文件
  echo "$PID" >> "$LOGDIR/pids.txt"

  # 短暂延迟,避免同时启动导致数据库连接过载
  sleep 2
done

echo "================================================================================"
echo "✅ 12个进程已全部启动!"
echo ""
echo "监控命令:"
echo "  查看所有进程: ps aux | grep 'run-backtest-2025-m'"
echo "  查看某月日志: tail -f $LOGDIR/month-01.log"
echo "  查看所有日志: tail -f $LOGDIR/month-*.log"
echo "  停止所有进程: bash scripts/stop-parallel-backtest.sh"
echo ""
echo "进度监控:"
echo "  实时监控脚本: bash scripts/monitor-parallel-backtest.sh"
echo ""
echo "================================================================================"
echo ""

# 保存启动时间
echo "$START_TIME" > "$LOGDIR/start_time.txt"

echo "💡 提示: 进程在后台运行,可以安全关闭此终端"
echo ""
