#!/bin/bash

# ================================================================================
# 停止所有并行回测进程
# ================================================================================

echo "🛑 停止所有并行回测进程..."
echo ""

cd "$(dirname "$0")/.." || exit 1

LOGDIR="logs/parallel-backtest-2025"
PIDFILE="$LOGDIR/pids.txt"

if [ -f "$PIDFILE" ]; then
  echo "📋 从PID文件读取进程..."
  while read -r pid; do
    if ps -p "$pid" > /dev/null 2>&1; then
      echo "  停止 PID $pid..."
      kill "$pid"
    else
      echo "  PID $pid 已不存在"
    fi
  done < "$PIDFILE"

  rm "$PIDFILE"
  echo ""
  echo "✅ 所有进程已停止"
else
  echo "⚠️  PID文件不存在,尝试查找进程..."
  echo ""

  # 查找所有回测进程
  PIDS=$(pgrep -f "run-backtest-2025-m")

  if [ -z "$PIDS" ]; then
    echo "ℹ️  没有找到运行中的回测进程"
  else
    echo "找到以下进程:"
    echo "$PIDS" | while read -r pid; do
      echo "  PID: $pid"
    done
    echo ""

    read -p "是否停止这些进程? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      echo "$PIDS" | xargs kill
      echo "✅ 进程已停止"
    else
      echo "❌ 取消操作"
    fi
  fi
fi

echo ""
