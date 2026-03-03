#!/bin/bash

# ================================================================================
# 实时监控12个并行回测进程的进度
# ================================================================================

cd "$(dirname "$0")/.." || exit 1

LOGDIR="logs/parallel-backtest-2025"
START_TIME_FILE="$LOGDIR/start_time.txt"

# 清屏
clear

echo "================================================================================"
echo "📊 2025年12月并行回测 - 实时进度监控"
echo "================================================================================"
echo ""

# 读取启动时间
if [ -f "$START_TIME_FILE" ]; then
  START_TIME=$(cat "$START_TIME_FILE")
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))
  ELAPSED_MIN=$((ELAPSED / 60))
  ELAPSED_HOUR=$((ELAPSED_MIN / 60))
  ELAPSED_MIN_REMAIN=$((ELAPSED_MIN % 60))

  echo "⏰ 已运行时间: ${ELAPSED_HOUR}小时 ${ELAPSED_MIN_REMAIN}分钟"
  echo ""
fi

echo "📈 各月进度:"
echo ""

# 从日志文件中提取最新进度
for month in {01..12}; do
  LOGFILE="$LOGDIR/month-${month}.log"

  if [ -f "$LOGFILE" ]; then
    # 提取最后一行包含进度信息的行
    PROGRESS=$(grep -E "\[月${month#0}\] 进度:" "$LOGFILE" | tail -1)

    if [ -n "$PROGRESS" ]; then
      echo "  ${PROGRESS}"
    else
      # 如果没有进度信息,检查是否已完成
      if grep -q "✅.*月.*回测完成" "$LOGFILE"; then
        echo "  [月${month#0}] ✅ 已完成"
      else
        echo "  [月${month#0}] ⏳ 启动中..."
      fi
    fi
  else
    echo "  [月${month#0}] ⚠️  日志文件不存在"
  fi
done

echo ""
echo "================================================================================"
echo ""
echo "💡 命令:"
echo "  查看某月详细日志: tail -f $LOGDIR/month-01.log"
echo "  停止所有进程: bash scripts/stop-parallel-backtest.sh"
echo "  聚合结果: node scripts/aggregate-parallel-results.js"
echo ""
echo "⏱  每30秒自动刷新... (Ctrl+C 退出)"
echo ""

# 等待30秒后重新运行
sleep 30
exec "$0"
