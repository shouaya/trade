#!/bin/bash

# 数据库修复脚本
# 修复trades表的字段定义问题

echo "🔧 修复数据库表结构..."

docker exec money-mysql mysql -uroot -prootpassword trading <<EOF 2>&1 | grep -v "Warning"

-- 修复 hold_minutes 字段(添加默认值)
ALTER TABLE trades
MODIFY COLUMN hold_minutes INT DEFAULT 0;

-- 修复 exit_reason 枚举值(添加 forced_close)
ALTER TABLE trades
MODIFY COLUMN exit_reason ENUM('stop_loss','take_profit','hold_time_reached','manual','forced_close') DEFAULT NULL;

-- 显示修改后的字段定义
SHOW COLUMNS FROM trades WHERE Field IN ('hold_minutes', 'exit_reason');

EOF

echo ""
echo "✅ 数据库修复完成!"
echo ""
echo "现在可以运行回测脚本了:"
echo "  node scripts/quick-test.js"
echo "  node scripts/run-multi-strategy-backtest.js 100"
