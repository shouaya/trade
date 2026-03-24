const TRAIN_RUN_REQUESTS_DDL = `
  CREATE TABLE IF NOT EXISTS train_run_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    request_id VARCHAR(100) NOT NULL,
    config_id INT NOT NULL,
    config_key VARCHAR(255) NOT NULL,
    config_name VARCHAR(255) NULL,
    config_type VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL COMMENT 'train / validate',
    status VARCHAR(20) NOT NULL COMMENT 'queued / exporting / running / completed / failed / cancelled',
    requested_by VARCHAR(100) NULL,
    trigger_source VARCHAR(50) NOT NULL DEFAULT 'ui',
    command_text TEXT NULL,
    export_path VARCHAR(500) NULL,
    worker_pid INT NULL,
    execution_pid INT NULL,
    cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
    attempt_count INT NOT NULL DEFAULT 0,
    log_excerpt MEDIUMTEXT NULL,
    error_message TEXT NULL,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_request_id (request_id),
    INDEX idx_status_created (status, created_at),
    INDEX idx_config_id (config_id),
    INDEX idx_config_key (config_key),
    INDEX idx_action_status (action, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

module.exports = {
  TRAIN_RUN_REQUESTS_DDL
};
