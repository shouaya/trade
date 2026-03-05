/**
 * Trades Table Schema
 * 交易记录表结构定义
 */

export const TRADES_DDL = `
  CREATE TABLE IF NOT EXISTS trades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    direction ENUM('long', 'short') NOT NULL,
    entry_time BIGINT NOT NULL,
    entry_price DECIMAL(10, 5) NOT NULL,
    entry_index INT,
    entry_rsi DECIMAL(6, 2),
    entry_macd DECIMAL(10, 5),
    entry_macd_signal DECIMAL(10, 5),
    entry_macd_histogram DECIMAL(10, 5),
    lot_size DECIMAL(10, 2) NOT NULL,
    hold_minutes INT,
    stop_loss DECIMAL(10, 5),
    take_profit DECIMAL(10, 5),
    exit_time BIGINT NOT NULL,
    exit_price DECIMAL(10, 5) NOT NULL,
    exit_rsi DECIMAL(6, 2),
    exit_macd DECIMAL(10, 5),
    exit_macd_signal DECIMAL(10, 5),
    exit_macd_histogram DECIMAL(10, 5),
    exit_reason ENUM(
      'stop_loss',
      'take_profit',
      'hold_time_reached',
      'trailing_stop',
      'rsi_revert',
      'no_overnight',
      'no_weekend',
      'backtest_end'
    ),
    pnl DECIMAL(10, 2),
    pips DECIMAL(10, 2),
    percent DECIMAL(10, 4),
    actual_hold_minutes INT,
    strategy_name VARCHAR(255),
    symbol VARCHAR(20) DEFAULT 'USDJPY',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_direction (direction),
    INDEX idx_entry_time (entry_time),
    INDEX idx_exit_time (exit_time),
    INDEX idx_strategy_name (strategy_name),
    INDEX idx_symbol (symbol),
    INDEX idx_pnl (pnl)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;
