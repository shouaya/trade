const {
  TRAIN_CONFIGS_TABLE,
  TRAINING_CONFIG_DETAILS_TABLE,
  VALIDATION_CONFIG_DETAILS_TABLE,
  SNAPSHOT_CONFIG_DETAILS_TABLE,
  ROUTER_CONFIG_DETAILS_TABLE,
  POLICY_CONFIG_DETAILS_TABLE,
  GENERIC_CONFIG_DETAILS_TABLE
} = require('./table-names');

const TRAIN_CONFIGS_DDL = `
  CREATE TABLE IF NOT EXISTS ${TRAIN_CONFIGS_TABLE} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    config_key VARCHAR(255) NOT NULL COMMENT 'stable key relative to train/',
    config_type VARCHAR(50) NOT NULL COMMENT 'training / validation / top-strategies / router / policy / generated / config',
    config_name VARCHAR(255) NULL COMMENT 'config display name',
    symbol VARCHAR(20) NULL COMMENT 'market symbol',
    interval_type VARCHAR(20) NULL COMMENT 'kline interval',
    result_group VARCHAR(255) NULL COMMENT 'database.tableName',
    source_table VARCHAR(255) NULL COMMENT 'snapshot source table',
    train_config_ref VARCHAR(255) NULL COMMENT 'linked training config key',
    training_year VARCHAR(10) NULL COMMENT 'training year label',
    train_id VARCHAR(100) NULL COMMENT 'root training lineage id',
    parent_config_id INT NULL COMMENT 'upstream config version id',
    version_no INT NOT NULL DEFAULT 1 COMMENT 'monotonic version within config key',
    status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'draft / active / archived',
    is_generated TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'generated config flag',
    content_hash VARCHAR(64) NOT NULL COMMENT 'canonical raw json hash',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_config_key_version (config_key, version_no),
    INDEX idx_config_type (config_type),
    INDEX idx_config_name (config_name),
    INDEX idx_symbol_type (symbol, config_type),
    INDEX idx_result_group (result_group),
    INDEX idx_training_year (training_year),
    INDEX idx_train_id (train_id),
    INDEX idx_parent_config_id (parent_config_id),
    INDEX idx_config_key_status (config_key, status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const TRAINING_CONFIG_DETAILS_DDL = `
  CREATE TABLE IF NOT EXISTS ${TRAINING_CONFIG_DETAILS_TABLE} (
    config_id INT PRIMARY KEY,
    start_time_ms BIGINT NULL,
    end_time_ms BIGINT NULL,
    start_iso VARCHAR(40) NULL,
    end_iso VARCHAR(40) NULL,
    validation_profile VARCHAR(50) NULL,
    router_config_path VARCHAR(255) NULL,
    policy_catalog_path VARCHAR(255) NULL,
    market_json JSON NULL,
    strategy_json JSON NULL,
    executor_json JSON NULL,
    output_json JSON NULL,
    validation_plan_json JSON NULL,
    regime_routing_json JSON NULL,
    raw_json JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_training_config_details_config_id FOREIGN KEY (config_id) REFERENCES ${TRAIN_CONFIGS_TABLE}(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const VALIDATION_CONFIG_DETAILS_DDL = `
  CREATE TABLE IF NOT EXISTS ${VALIDATION_CONFIG_DETAILS_TABLE} (
    config_id INT PRIMARY KEY,
    start_time_ms BIGINT NULL,
    end_time_ms BIGINT NULL,
    start_iso VARCHAR(40) NULL,
    end_iso VARCHAR(40) NULL,
    validation_profile VARCHAR(50) NULL,
    target_label VARCHAR(255) NULL,
    market_json JSON NULL,
    strategy_json JSON NULL,
    executor_json JSON NULL,
    output_json JSON NULL,
    validation_target_json JSON NULL,
    training_meta_json JSON NULL,
    raw_json JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_validation_config_details_config_id FOREIGN KEY (config_id) REFERENCES ${TRAIN_CONFIGS_TABLE}(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const SNAPSHOT_CONFIG_DETAILS_DDL = `
  CREATE TABLE IF NOT EXISTS ${SNAPSHOT_CONFIG_DETAILS_TABLE} (
    config_id INT PRIMARY KEY,
    artifact_type VARCHAR(80) NULL,
    generated_at VARCHAR(40) NULL,
    source_run_id VARCHAR(128) NULL,
    limit_n INT NULL,
    exact_match TINYINT(1) NOT NULL DEFAULT 0,
    market_json JSON NULL,
    executor_json JSON NULL,
    strategy_json JSON NULL,
    output_json JSON NULL,
    training_context_json JSON NULL,
    validation_targets_json JSON NULL,
    strategies_json JSON NULL,
    raw_json JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_snapshot_config_details_config_id FOREIGN KEY (config_id) REFERENCES ${TRAIN_CONFIGS_TABLE}(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const ROUTER_CONFIG_DETAILS_DDL = `
  CREATE TABLE IF NOT EXISTS ${ROUTER_CONFIG_DETAILS_TABLE} (
    config_id INT PRIMARY KEY,
    router_version VARCHAR(255) NULL,
    policy_catalog_path VARCHAR(255) NULL,
    execution_model_json JSON NULL,
    strategy_catalog_json JSON NULL,
    rules_json JSON NULL,
    training_meta_json JSON NULL,
    raw_json JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_router_config_details_config_id FOREIGN KEY (config_id) REFERENCES ${TRAIN_CONFIGS_TABLE}(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const POLICY_CONFIG_DETAILS_DDL = `
  CREATE TABLE IF NOT EXISTS ${POLICY_CONFIG_DETAILS_TABLE} (
    config_id INT PRIMARY KEY,
    router_version VARCHAR(255) NULL,
    catalog_version VARCHAR(255) NULL,
    generated_date VARCHAR(40) NULL,
    source_json JSON NULL,
    default_fallback_json JSON NULL,
    event_segments_json JSON NULL,
    daily_guards_json JSON NULL,
    training_meta_json JSON NULL,
    raw_json JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_policy_config_details_config_id FOREIGN KEY (config_id) REFERENCES ${TRAIN_CONFIGS_TABLE}(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const GENERIC_CONFIG_DETAILS_DDL = `
  CREATE TABLE IF NOT EXISTS ${GENERIC_CONFIG_DETAILS_TABLE} (
    config_id INT PRIMARY KEY,
    raw_json JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_generic_config_details_config_id FOREIGN KEY (config_id) REFERENCES ${TRAIN_CONFIGS_TABLE}(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

module.exports = {
  TRAIN_CONFIGS_DDL,
  TRAINING_CONFIG_DETAILS_DDL,
  VALIDATION_CONFIG_DETAILS_DDL,
  SNAPSHOT_CONFIG_DETAILS_DDL,
  ROUTER_CONFIG_DETAILS_DDL,
  POLICY_CONFIG_DETAILS_DDL,
  GENERIC_CONFIG_DETAILS_DDL
};
