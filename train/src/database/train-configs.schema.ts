/**
 * Train Config Registry Table Schema
 * 训练配置注册表
 */

export const TRAIN_CONFIGS_DDL = `
  CREATE TABLE IF NOT EXISTS train_configs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    config_key VARCHAR(255) NOT NULL COMMENT '相对 train/ 的稳定键，例如 configs/training/foo.json',
    config_type VARCHAR(50) NOT NULL COMMENT 'training / validation / top-strategies / router / generated / config',
    config_name VARCHAR(255) NULL COMMENT 'JSON 内 name 字段',
    symbol VARCHAR(20) NULL COMMENT '交易品种',
    interval_type VARCHAR(20) NULL COMMENT 'K线周期',
    result_group VARCHAR(255) NULL COMMENT 'database.tableName',
    source_table VARCHAR(255) NULL COMMENT 'top-strategies.sourceTable',
    train_config_ref VARCHAR(255) NULL COMMENT 'top-strategies.trainConfig',
    training_year VARCHAR(10) NULL COMMENT '训练年份或主年标签',
    is_generated TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否为生成型配置',
    content_hash VARCHAR(64) NOT NULL COMMENT '配置内容 hash',
    content JSON NOT NULL COMMENT '完整 JSON 内容',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_config_key (config_key),
    INDEX idx_config_type (config_type),
    INDEX idx_config_name (config_name),
    INDEX idx_symbol_type (symbol, config_type),
    INDEX idx_result_group (result_group),
    INDEX idx_training_year (training_year)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;
