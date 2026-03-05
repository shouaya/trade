#!/bin/bash

# TypeScript 迁移状态检查脚本

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║        TypeScript 迁移状态报告                                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# 统计 TypeScript 文件
TS_COUNT=$(find src -name "*.ts" -type f | wc -l | tr -d ' ')
echo "✅ 已转换 TypeScript 文件: $TS_COUNT 个"

# 统计 JavaScript 文件
JS_SERVICES=$(find services -name "*.js" -type f 2>/dev/null | wc -l | tr -d ' ')
JS_SCRIPTS=$(find scripts -name "*.js" -type f 2>/dev/null | wc -l | tr -d ' ')
JS_TOTAL=$((JS_SERVICES + JS_SCRIPTS))
echo "⏳ 剩余 JavaScript 文件: $JS_TOTAL 个 (services: $JS_SERVICES, scripts: $JS_SCRIPTS)"

# 计算完成百分比
TOTAL=$((TS_COUNT + JS_TOTAL))
if [ $TOTAL -gt 0 ]; then
    PERCENT=$(echo "scale=1; $TS_COUNT * 100 / $TOTAL" | bc)
    echo "📊 迁移进度: $PERCENT%"
fi

echo ""
echo "─────────────────────────────────────────────────────────────────"
echo "已转换的核心文件:"
echo "─────────────────────────────────────────────────────────────────"
find src -name "*.ts" -type f | sed 's|src/||' | sort | while read file; do
    echo "  ✅ $file"
done

echo ""
echo "─────────────────────────────────────────────────────────────────"
echo "剩余需要转换的关键文件:"
echo "─────────────────────────────────────────────────────────────────"

# 检查关键文件
if [ -f "services/strategy-executor.js" ]; then
    echo "  🔴 services/strategy-executor.js (666 行) - 最高优先级"
fi

if [ -f "scripts/train.js" ]; then
    echo "  🟡 scripts/train.js - 主入口"
fi

if [ -f "scripts/run-training.js" ]; then
    echo "  🟡 scripts/run-training.js - 训练执行器"
fi

if [ -f "scripts/run-rolling-window-training.js" ]; then
    echo "  🟡 scripts/run-rolling-window-training.js - 滚动窗口"
fi

echo ""
echo "─────────────────────────────────────────────────────────────────"
echo "构建状态:"
echo "─────────────────────────────────────────────────────────────────"

# 检查构建
if [ -d "dist" ]; then
    COMPILED=$(find dist -name "*.js" | wc -l | tr -d ' ')
    SIZE=$(du -sh dist/ | cut -f1)
    echo "  ✅ 编译输出: $COMPILED 个 JS 文件"
    echo "  ✅ 构建大小: $SIZE"
else
    echo "  ⚠️  未找到 dist/ 目录，请运行: npm run build"
fi

echo ""
echo "─────────────────────────────────────────────────────────────────"
echo "下一步建议:"
echo "─────────────────────────────────────────────────────────────────"
echo "  1. 转换 strategy-executor.js (最重要)"
echo "  2. 转换入口脚本 (train.js, run-training.js)"
echo "  3. 逐步转换工具脚本"
echo ""
echo "运行命令:"
echo "  npm run build       # 编译 TypeScript"
echo "  npm run type-check  # 类型检查"
echo ""
