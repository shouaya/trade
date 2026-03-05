/**
 * Backtest Results Table Schema
 * 回测结果表结构定义
 */

export const BACKTEST_RESULTS_DDL = `
  CREATE TABLE IF NOT EXISTS backtest_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    strategy_name VARCHAR(255) NOT NULL,
    strategy_type VARCHAR(50),
    parameters JSON,
    total_trades INT DEFAULT 0,
    winning_trades INT DEFAULT 0,
    losing_trades INT DEFAULT 0,
    win_rate DECIMAL(5, 4) DEFAULT 0,
    total_pnl DECIMAL(15, 2) DEFAULT 0,
    avg_pnl DECIMAL(15, 2) DEFAULT 0,
    max_drawdown DECIMAL(15, 2) DEFAULT 0,
    sharpe_ratio DECIMAL(10, 4) DEFAULT 0,
    profit_factor DECIMAL(10, 4) DEFAULT 0,
    avg_win DECIMAL(15, 2) DEFAULT 0,
    avg_loss DECIMAL(15, 2) DEFAULT 0,
    max_win DECIMAL(15, 2) DEFAULT 0,
    max_loss DECIMAL(15, 2) DEFAULT 0,
    score DECIMAL(15, 4) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_strategy_name (strategy_name),
    INDEX idx_total_pnl (total_pnl),
    INDEX idx_win_rate (win_rate),
    INDEX idx_sharpe_ratio (sharpe_ratio),
    INDEX idx_score (score)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;
