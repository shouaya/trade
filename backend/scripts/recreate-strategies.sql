-- 完全重建 strategies 表以解决字符集问题

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- 删除旧表
DROP TABLE IF EXISTS strategies;

-- 重新创建表
CREATE TABLE strategies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE COMMENT '策略名称',
    description TEXT NULL COMMENT '策略描述',
    parameters JSON NULL COMMENT '策略参数（JSON格式）',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 插入示例策略
INSERT INTO strategies (name, description, parameters) VALUES
('默认策略', '标准止损止盈策略', '{"stopLossPips": 50, "takeProfitPips": 100, "holdMinutes": 60}'),
('激进策略', '短线快进快出', '{"stopLossPips": 30, "takeProfitPips": 60, "holdMinutes": 30}'),
('保守策略', '长线持有策略', '{"stopLossPips": 100, "takeProfitPips": 200, "holdMinutes": 240}');

-- 验证数据
SELECT * FROM strategies;
