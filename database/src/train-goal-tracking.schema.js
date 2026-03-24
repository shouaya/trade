const { TRAIN_GOAL_TRACKING_TABLE, TRAIN_CONFIGS_TABLE } = require('./table-names');

const TRAIN_GOAL_TRACKING_DDL = `
  CREATE TABLE IF NOT EXISTS ${TRAIN_GOAL_TRACKING_TABLE} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    train_id VARCHAR(100) NOT NULL COMMENT 'root training lineage id',
    config_id INT NOT NULL COMMENT 'training config registry id',
    config_key VARCHAR(255) NOT NULL COMMENT 'training config key',
    symbol VARCHAR(20) NULL COMMENT 'market symbol',
    report_path VARCHAR(255) NULL COMMENT 'generated markdown/json path under train/',
    goal_attainment_pct DECIMAL(8, 2) NOT NULL DEFAULT 0,
    adaptation_score_pct DECIMAL(8, 2) NOT NULL DEFAULT 0,
    validation_score_pct DECIMAL(8, 2) NOT NULL DEFAULT 0,
    router_score_pct DECIMAL(8, 2) NULL,
    stability_score_pct DECIMAL(8, 2) NOT NULL DEFAULT 0,
    profitable_validation_ratio DECIMAL(10, 4) NULL,
    router_positive_ratio DECIMAL(10, 4) NULL,
    router_beat_baseline_ratio DECIMAL(10, 4) NULL,
    monthly_pool_turnover_ratio DECIMAL(10, 4) NULL,
    avg_pool_size DECIMAL(10, 4) NULL,
    payload_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_train_goal_tracking (train_id, config_id),
    INDEX idx_train_id (train_id),
    INDEX idx_config_id (config_id),
    INDEX idx_symbol_updated_at (symbol, updated_at),
    CONSTRAINT fk_train_goal_tracking_config_id FOREIGN KEY (config_id) REFERENCES ${TRAIN_CONFIGS_TABLE}(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

module.exports = {
  TRAIN_GOAL_TRACKING_DDL
};
