-- 为交易记录表添加指标字段

SET NAMES utf8mb4;

-- 添加入场时的指标值（如果已存在会报错，但不影响）
ALTER TABLE trades ADD COLUMN entry_rsi DECIMAL(5, 2) NULL COMMENT '入场时的RSI值' AFTER entry_index;
ALTER TABLE trades ADD COLUMN entry_macd DECIMAL(10, 5) NULL COMMENT '入场时的MACD值' AFTER entry_rsi;
ALTER TABLE trades ADD COLUMN entry_macd_signal DECIMAL(10, 5) NULL COMMENT '入场时的MACD信号线值' AFTER entry_macd;
ALTER TABLE trades ADD COLUMN entry_macd_histogram DECIMAL(10, 5) NULL COMMENT '入场时的MACD柱状图值' AFTER entry_macd_signal;

-- 添加出场时的指标值
ALTER TABLE trades ADD COLUMN exit_rsi DECIMAL(5, 2) NULL COMMENT '出场时的RSI值' AFTER exit_price;
ALTER TABLE trades ADD COLUMN exit_macd DECIMAL(10, 5) NULL COMMENT '出场时的MACD值' AFTER exit_rsi;
ALTER TABLE trades ADD COLUMN exit_macd_signal DECIMAL(10, 5) NULL COMMENT '出场时的MACD信号线值' AFTER exit_macd;
ALTER TABLE trades ADD COLUMN exit_macd_histogram DECIMAL(10, 5) NULL COMMENT '出场时的MACD柱状图值' AFTER exit_macd_signal;

-- 查看表结构
DESCRIBE trades;
