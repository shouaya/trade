const TRADES_DDL = `
  CREATE TABLE IF NOT EXISTS trades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    direction ENUM('long', 'short') NOT NULL,
    entry_time BIGINT NOT NULL,
    entry_price DECIMAL(20, 8) NOT NULL,
    entry_index INT,
    entry_rsi DECIMAL(6, 2),
    entry_macd DECIMAL(20, 8),
    entry_macd_signal DECIMAL(20, 8),
    entry_macd_histogram DECIMAL(20, 8),
    lot_size DECIMAL(10, 2) NOT NULL DEFAULT 1.00,
    hold_minutes INT,
    stop_loss DECIMAL(20, 8),
    take_profit DECIMAL(20, 8),
    exit_time BIGINT NOT NULL,
    exit_price DECIMAL(20, 8) NOT NULL,
    exit_rsi DECIMAL(6, 2),
    exit_macd DECIMAL(20, 8),
    exit_macd_signal DECIMAL(20, 8),
    exit_macd_histogram DECIMAL(20, 8),
    exit_reason ENUM(
      'stop_loss',
      'take_profit',
      'hold_time_reached',
      'trailing_stop',
      'rsi_revert',
      'no_overnight',
      'no_weekend',
      'backtest_end',
      'manual'
    ),
    gross_pnl DECIMAL(10, 2),
    commission_fee DECIMAL(10, 4),
    pnl DECIMAL(10, 2),
    pips DECIMAL(10, 2),
    percent DECIMAL(10, 4),
    actual_hold_minutes INT,
    strategy_name VARCHAR(255),
    train_id VARCHAR(100) NULL COMMENT 'root training lineage id',
    symbol VARCHAR(20) DEFAULT 'USDJPY',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_direction (direction),
    INDEX idx_entry_time (entry_time),
    INDEX idx_exit_time (exit_time),
    INDEX idx_strategy_name (strategy_name),
    INDEX idx_train_id (train_id),
    INDEX idx_symbol (symbol),
    INDEX idx_pnl (pnl)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

module.exports = {
  TRADES_DDL
};
