const { TABLES } = require('./table-names');

const TRAIN_ARTIFACTS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.TRAIN_ARTIFACTS} (
  id INT AUTO_INCREMENT PRIMARY KEY,
  artifact_key VARCHAR(255) NOT NULL COMMENT 'stable unique artifact key',
  artifact_type VARCHAR(64) NOT NULL COMMENT 'goal-tracking / feature-causality / cost-sensitivity / router-validation / ai-summary',
  train_id VARCHAR(100) NULL COMMENT 'root training lineage id',
  config_id INT NULL COMMENT 'linked train_configs.id when available',
  config_key VARCHAR(255) NULL COMMENT 'linked config key when available',
  symbol VARCHAR(20) NULL COMMENT 'market symbol',
  interval_type VARCHAR(20) NULL COMMENT 'market interval type',
  period_start_ms BIGINT NULL COMMENT 'artifact period start in ms',
  period_end_ms BIGINT NULL COMMENT 'artifact period end in ms',
  report_path VARCHAR(255) NULL COMMENT 'optional generated snapshot path',
  summary_path VARCHAR(255) NULL COMMENT 'optional AI summary path',
  summary_markdown MEDIUMTEXT NULL COMMENT 'optional AI summary body',
  payload_json JSON NOT NULL COMMENT 'full structured payload',
  metadata_json JSON NULL COMMENT 'artifact metadata',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_artifact_key (artifact_key),
  KEY idx_type_updated_at (artifact_type, updated_at),
  KEY idx_train_type_updated_at (train_id, artifact_type, updated_at),
  KEY idx_symbol_type_period (symbol, artifact_type, period_start_ms, period_end_ms),
  KEY idx_config_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

module.exports = {
  TRAIN_ARTIFACTS_DDL
};
