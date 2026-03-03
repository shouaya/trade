-- 创建 K 线数据表
CREATE TABLE IF NOT EXISTS klines (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    open_time BIGINT NOT NULL,
    open DECIMAL(10, 5) NOT NULL,
    high DECIMAL(10, 5) NOT NULL,
    low DECIMAL(10, 5) NOT NULL,
    close DECIMAL(10, 5) NOT NULL,
    volume DECIMAL(20, 8) DEFAULT 0,
    symbol VARCHAR(20) DEFAULT 'USDJPY',
    interval_type VARCHAR(10) DEFAULT '1m',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_kline (symbol, interval_type, open_time),
    INDEX idx_open_time (open_time),
    INDEX idx_symbol_time (symbol, open_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建交易记录表
CREATE TABLE IF NOT EXISTS trades (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- 交易基本信息
    direction ENUM('long', 'short') NOT NULL COMMENT '交易方向：long=做多, short=做空',
    entry_time BIGINT NOT NULL COMMENT '入场时间（毫秒时间戳）',
    entry_price DECIMAL(10, 5) NOT NULL COMMENT '入场价格',
    entry_index INT NOT NULL COMMENT '入场时的K线索引',

    -- 交易参数
    lot_size DECIMAL(10, 2) NOT NULL DEFAULT 1.00 COMMENT '仓位大小（手）',
    hold_minutes INT NOT NULL COMMENT '计划持仓时间（分钟）',
    stop_loss DECIMAL(10, 5) NULL COMMENT '止损价格',
    take_profit DECIMAL(10, 5) NULL COMMENT '止盈价格',

    -- 出场信息
    exit_time BIGINT NULL COMMENT '出场时间（毫秒时间戳）',
    exit_price DECIMAL(10, 5) NULL COMMENT '出场价格',
    exit_reason ENUM('stop_loss', 'take_profit', 'hold_time_reached', 'manual') NULL COMMENT '出场原因',

    -- 损益结果
    pnl DECIMAL(10, 2) NULL COMMENT '损益（USD）',
    pips DECIMAL(10, 2) NULL COMMENT '点数',
    percent DECIMAL(10, 4) NULL COMMENT '收益率（%）',
    actual_hold_minutes INT NULL COMMENT '实际持仓时间（分钟）',

    -- 策略和备注
    strategy_name VARCHAR(100) NULL COMMENT '策略名称',
    notes TEXT NULL COMMENT '备注',

    -- 元数据
    symbol VARCHAR(20) DEFAULT 'USDJPY' COMMENT '交易品种',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间',

    INDEX idx_entry_time (entry_time),
    INDEX idx_direction (direction),
    INDEX idx_exit_reason (exit_reason),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建策略配置表（可选，用于保存常用策略）
CREATE TABLE IF NOT EXISTS strategies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE COMMENT '策略名称',
    description TEXT NULL COMMENT '策略描述',
    parameters JSON NULL COMMENT '策略参数（JSON格式）',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;