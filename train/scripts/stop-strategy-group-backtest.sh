#!/bin/bash

# ================================================================================
# 停止所有策略组回测进程
# ================================================================================

echo "================================================================================"
echo "🛑 停止所有策略组回测进程"
echo "================================================================================"
echo ""

# 方法1: 通过PID文件停止
YEAR="${YEAR:-$(date +%Y)}"
LOGDIR="logs/strategy-group-backtest-${YEAR}"
PID_FILE="$LOGDIR/pids.txt"

if [ -f "$PID_FILE" ]; then
  echo "📋 从PID文件读取进程..."
  while read -r PID; do
    if ps -p "$PID" > /dev/null 2>&1; then
      echo "  停止进程 $PID"
      kill "$PID" 2>/dev/null || true
    fi
  done < "$PID_FILE"
  echo ""
fi

# 方法2: 通过进程名停止 (备用)
echo "🔍 查找并停止所有回测进程..."
pkill -9 -f 'group-backtest' 2>/dev/null || true
echo ""

# 检查是否还有进程在运行
REMAINING=$(pgrep -f 'group-backtest' | wc -l)

if [ "$REMAINING" -eq 0 ]; then
  echo "✅ 所有进程已停止"
else
  echo "⚠️  仍有 $REMAINING 个进程在运行"
  echo ""
  echo "运行中的进程:"
  ps aux | grep 'group-backtest' | grep -v grep
fi

echo ""
echo "================================================================================"
echo ""
