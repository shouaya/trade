-- 修复数据库字符集问题

-- 设置数据库默认字符集
ALTER DATABASE trading CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- 删除有乱码的策略数据
DELETE FROM strategies WHERE id > 0;

-- 重新插入正确的策略数据
INSERT INTO strategies (name, description, parameters) VALUES
('默认策略', '标准止损止盈策略', '{"stopLossPips": 50, "takeProfitPips": 100, "holdMinutes": 60}'),
('激进策略', '短线快进快出', '{"stopLossPips": 30, "takeProfitPips": 60, "holdMinutes": 30}'),
('保守策略', '长线持有策略', '{"stopLossPips": 100, "takeProfitPips": 200, "holdMinutes": 240}');

-- 显示结果
SELECT * FROM strategies;
