#!/bin/bash

# ================================================================================
# 策略分组并行回测启动脚本
# 同时启动10个进程,每个进程处理一组策略(完整12个月数据)
# ================================================================================

echo "================================================================================"
YEAR="${YEAR:-$(date +%Y)}"
GROUPS="${GROUPS:-10}"
RESULT_TABLE="${RESULT_TABLE:-backtest_results_${YEAR}_full}"
LOGDIR="logs/strategy-group-backtest-${YEAR}"

echo "🚀 启动${YEAR}年策略分组并行回测"
echo "================================================================================"
echo ""
echo "配置:"
echo "  - 策略总数: 560,196"
echo "  - 并行进程: ${GROUPS}个"
echo "  - 时间范围: ${YEAR}年配置区间"
echo "  - 预计耗时: ~30小时/组 (并行执行,总wall time ~30小时)"
echo ""
echo "================================================================================"
echo ""

# 切换到backend目录
cd "$(dirname "$0")/.." || exit 1

# 创建日志目录
mkdir -p "$LOGDIR"

echo "📁 日志目录: $LOGDIR"
echo ""

# 清理旧的结果表 (可选)
read -p "是否清理旧的结果表 ${RESULT_TABLE}? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "🗑️  清理旧的结果表..."
  mysql -h localhost -P 3306 -u root -prootpassword trading <<EOF
    DROP TABLE IF EXISTS ${RESULT_TABLE};
EOF
  echo "✅ 清理完成"
  echo ""
fi

# 记录启动时间
START_TIME=$(date +%s)
echo "⏰ 开始时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

echo "🚀 启动10个并行进程..."
echo ""

# 启动策略组的回测进程
for ((g=1; g<=GROUPS; g++)); do
  group=$(printf "%02d" "$g")
  GROUP_NUM=${group#0}
  SCRIPT="scripts/group-backtest.js --year ${YEAR} --group ${GROUP_NUM} --groups ${GROUPS} --resultTable ${RESULT_TABLE}"
  LOGFILE="$LOGDIR/group-${group}.log"

  echo "  [组${group}] 启动: node ${SCRIPT}"
  echo "         日志: ${LOGFILE}"

  nohup node $SCRIPT > "$LOGFILE" 2>&1 &
  PID=$!
  echo "         PID: ${PID}"
  echo ""

  # 记录PID到文件
  echo "$PID" >> "$LOGDIR/pids.txt"

  # 短暂延迟,避免同时启动导致数据库连接过载
  sleep 2
done

echo "================================================================================"
echo "✅ ${GROUPS}个进程已全部启动!"
echo ""
echo "监控命令:"
echo "  查看所有进程: ps aux | grep 'group-backtest'"
echo "  查看某组日志: tail -f $LOGDIR/group-01.log"
echo "  查看所有日志: tail -f $LOGDIR/group-*.log"
echo "  停止所有进程: bash scripts/stop-strategy-group-backtest.sh"
echo ""
echo "进度监控:"
echo "  实时监控脚本: bash scripts/monitor-strategy-group-backtest.sh"
echo ""
echo "================================================================================"
echo ""

# 保存启动时间
echo "$START_TIME" > "$LOGDIR/start_time.txt"

echo "💡 提示: 进程在后台运行,可以安全关闭此终端"
echo ""
