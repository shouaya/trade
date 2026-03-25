const { TABLES } = require('./table-names');

const TRAIN_RUNS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.TRAIN_RUNS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_key VARCHAR(100) NOT NULL COMMENT 'stable run identifier',
  symbol VARCHAR(20) NOT NULL,
  interval_type VARCHAR(20) NOT NULL,
  mode VARCHAR(32) NOT NULL COMMENT 'bootstrap / rolling / exploration / evaluation / writeback',
  status VARCHAR(32) NOT NULL COMMENT 'queued / running / completed / failed / cancelled',
  feature_version VARCHAR(64) NOT NULL,
  strategy_space_version VARCHAR(64) NOT NULL,
  requested_window_type VARCHAR(20) NULL COMMENT 'monthly / weekly / daily / opening',
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  error_message TEXT NULL,
  notes_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_run_key (run_key),
  KEY idx_symbol_mode_status (symbol, mode, status),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const MARKET_WINDOWS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.MARKET_WINDOWS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  interval_type VARCHAR(20) NOT NULL,
  window_type VARCHAR(20) NOT NULL COMMENT 'monthly / weekly / daily / opening',
  window_key VARCHAR(80) NOT NULL COMMENT 'e.g. BTCJPY:daily:2025-03-18',
  window_start_ms BIGINT NOT NULL,
  window_end_ms BIGINT NOT NULL,
  parent_window_id BIGINT NULL,
  sequence_no INT NULL COMMENT 'ordering within parent window',
  is_complete TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_window_key (window_key),
  UNIQUE KEY uniq_symbol_interval_type_range (symbol, interval_type, window_type, window_start_ms, window_end_ms),
  KEY idx_symbol_window_type_start (symbol, window_type, window_start_ms),
  KEY idx_parent_window_id (parent_window_id),
  CONSTRAINT fk_market_windows_parent
    FOREIGN KEY (parent_window_id) REFERENCES ${TABLES.MARKET_WINDOWS}(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const FEATURE_MEMORIES_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.FEATURE_MEMORIES} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  window_id BIGINT NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  feature_version VARCHAR(64) NOT NULL,
  feature_schema_version VARCHAR(64) NOT NULL,
  feature_bucket VARCHAR(64) NULL,
  feature_vector_json JSON NOT NULL COMMENT 'normalized numeric vector',
  feature_summary_json JSON NULL COMMENT 'human-readable summary',
  confidence_seed DECIMAL(10, 6) NULL,
  quality_score DECIMAL(10, 6) NULL,
  source_type VARCHAR(32) NOT NULL DEFAULT 'observed' COMMENT 'observed / aggregated / opening-only',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_window_feature_version (window_id, feature_version),
  KEY idx_symbol_feature_version (symbol, feature_version),
  KEY idx_feature_bucket (feature_bucket),
  CONSTRAINT fk_feature_memories_window
    FOREIGN KEY (window_id) REFERENCES ${TABLES.MARKET_WINDOWS}(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const FEATURE_MATCHES_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.FEATURE_MATCHES} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT NOT NULL,
  target_feature_memory_id BIGINT NOT NULL,
  matched_feature_memory_id BIGINT NOT NULL,
  rank_no INT NOT NULL,
  distance_metric VARCHAR(32) NOT NULL DEFAULT 'cosine',
  distance_score DECIMAL(18, 10) NOT NULL,
  similarity_score DECIMAL(18, 10) NOT NULL,
  confidence_score DECIMAL(18, 10) NULL,
  match_reason_json JSON NULL,
  is_reused TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_run_target_match (run_id, target_feature_memory_id, matched_feature_memory_id),
  UNIQUE KEY uniq_run_target_rank (run_id, target_feature_memory_id, rank_no),
  KEY idx_target_similarity (target_feature_memory_id, similarity_score),
  KEY idx_matched_feature_memory_id (matched_feature_memory_id),
  CONSTRAINT fk_feature_matches_run
    FOREIGN KEY (run_id) REFERENCES ${TABLES.TRAIN_RUNS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_matches_target
    FOREIGN KEY (target_feature_memory_id) REFERENCES ${TABLES.FEATURE_MEMORIES}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_matches_matched
    FOREIGN KEY (matched_feature_memory_id) REFERENCES ${TABLES.FEATURE_MEMORIES}(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const STRATEGY_DEFINITIONS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.STRATEGY_DEFINITIONS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  strategy_key VARCHAR(100) NOT NULL,
  strategy_family VARCHAR(64) NOT NULL,
  strategy_type VARCHAR(64) NOT NULL,
  entry_logic_version VARCHAR(64) NOT NULL,
  exit_logic_version VARCHAR(64) NOT NULL,
  risk_logic_version VARCHAR(64) NOT NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_strategy_key (strategy_key),
  KEY idx_family_active (strategy_family, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const STRATEGY_PARAMETER_SETS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.STRATEGY_PARAMETER_SETS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  strategy_definition_id BIGINT NOT NULL,
  parameter_key VARCHAR(120) NOT NULL,
  parameters_json JSON NOT NULL,
  source_type VARCHAR(32) NOT NULL COMMENT 'seed / discovered / mutated / promoted / imported',
  status VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active / shadow / retired',
  discovered_run_id BIGINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_strategy_parameter_key (strategy_definition_id, parameter_key),
  KEY idx_source_type_status (source_type, status),
  KEY idx_discovered_run_id (discovered_run_id),
  CONSTRAINT fk_strategy_parameter_sets_definition
    FOREIGN KEY (strategy_definition_id) REFERENCES ${TABLES.STRATEGY_DEFINITIONS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_strategy_parameter_sets_discovered_run
    FOREIGN KEY (discovered_run_id) REFERENCES ${TABLES.TRAIN_RUNS}(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const STRATEGY_LIBRARY_MEMBERS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.STRATEGY_LIBRARY_MEMBERS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  strategy_parameter_set_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL COMMENT 'candidate / trusted / shadow / retired',
  promotion_score DECIMAL(18, 10) NULL,
  confidence_score DECIMAL(18, 10) NULL,
  sample_count INT NOT NULL DEFAULT 0,
  win_window_count INT NOT NULL DEFAULT 0,
  lose_window_count INT NOT NULL DEFAULT 0,
  last_verified_window_id BIGINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_symbol_parameter_set (symbol, strategy_parameter_set_id),
  KEY idx_symbol_status_score (symbol, status, promotion_score),
  KEY idx_last_verified_window_id (last_verified_window_id),
  CONSTRAINT fk_strategy_library_members_parameter_set
    FOREIGN KEY (strategy_parameter_set_id) REFERENCES ${TABLES.STRATEGY_PARAMETER_SETS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_strategy_library_members_last_window
    FOREIGN KEY (last_verified_window_id) REFERENCES ${TABLES.MARKET_WINDOWS}(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const FEATURE_CANDIDATE_POOLS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.FEATURE_CANDIDATE_POOLS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT NOT NULL,
  feature_memory_id BIGINT NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  pool_status VARCHAR(32) NOT NULL COMMENT 'reused / explored / fallback / mixed',
  confidence_score DECIMAL(18, 10) NULL,
  pool_size INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_run_feature_pool (run_id, feature_memory_id),
  KEY idx_symbol_pool_status (symbol, pool_status),
  CONSTRAINT fk_feature_candidate_pools_run
    FOREIGN KEY (run_id) REFERENCES ${TABLES.TRAIN_RUNS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_candidate_pools_feature_memory
    FOREIGN KEY (feature_memory_id) REFERENCES ${TABLES.FEATURE_MEMORIES}(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const FEATURE_CANDIDATE_POOL_ITEMS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.FEATURE_CANDIDATE_POOL_ITEMS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  feature_candidate_pool_id BIGINT NOT NULL,
  strategy_parameter_set_id BIGINT NOT NULL,
  rank_no INT NOT NULL,
  selection_reason VARCHAR(64) NULL,
  expected_risk_mode VARCHAR(32) NULL COMMENT 'trade / reduce / stop / explore_small',
  expected_confidence_score DECIMAL(18, 10) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_pool_rank (feature_candidate_pool_id, rank_no),
  UNIQUE KEY uniq_pool_parameter_set (feature_candidate_pool_id, strategy_parameter_set_id),
  KEY idx_strategy_parameter_set_id (strategy_parameter_set_id),
  CONSTRAINT fk_feature_candidate_pool_items_pool
    FOREIGN KEY (feature_candidate_pool_id) REFERENCES ${TABLES.FEATURE_CANDIDATE_POOLS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_candidate_pool_items_parameter_set
    FOREIGN KEY (strategy_parameter_set_id) REFERENCES ${TABLES.STRATEGY_PARAMETER_SETS}(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const WINDOW_STRATEGY_EVALUATIONS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.WINDOW_STRATEGY_EVALUATIONS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT NOT NULL,
  window_id BIGINT NOT NULL,
  feature_memory_id BIGINT NOT NULL,
  strategy_parameter_set_id BIGINT NOT NULL,
  evaluation_role VARCHAR(32) NOT NULL COMMENT 'retrieved / exploration / fallback / baseline',
  trade_count INT NOT NULL DEFAULT 0,
  win_trade_count INT NOT NULL DEFAULT 0,
  lose_trade_count INT NOT NULL DEFAULT 0,
  total_pnl DECIMAL(20, 8) NOT NULL DEFAULT 0,
  return_pct DECIMAL(18, 10) NOT NULL DEFAULT 0,
  max_drawdown_pct DECIMAL(18, 10) NOT NULL DEFAULT 0,
  profit_factor DECIMAL(18, 10) NULL,
  sharpe_ratio DECIMAL(18, 10) NULL,
  score DECIMAL(18, 10) NULL,
  metrics_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_run_window_strategy_role (run_id, window_id, strategy_parameter_set_id, evaluation_role),
  KEY idx_window_score (window_id, score),
  KEY idx_feature_memory_id (feature_memory_id),
  CONSTRAINT fk_window_strategy_evaluations_run
    FOREIGN KEY (run_id) REFERENCES ${TABLES.TRAIN_RUNS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_window_strategy_evaluations_window
    FOREIGN KEY (window_id) REFERENCES ${TABLES.MARKET_WINDOWS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_window_strategy_evaluations_feature_memory
    FOREIGN KEY (feature_memory_id) REFERENCES ${TABLES.FEATURE_MEMORIES}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_window_strategy_evaluations_parameter_set
    FOREIGN KEY (strategy_parameter_set_id) REFERENCES ${TABLES.STRATEGY_PARAMETER_SETS}(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const WINDOW_BEST_ACTIONS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.WINDOW_BEST_ACTIONS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT NOT NULL,
  window_id BIGINT NOT NULL,
  feature_memory_id BIGINT NOT NULL,
  best_strategy_parameter_set_id BIGINT NULL,
  action_type VARCHAR(32) NOT NULL COMMENT 'trade / reduce / stop / explore_small',
  risk_multiplier DECIMAL(10, 6) NOT NULL DEFAULT 1,
  selection_source VARCHAR(32) NOT NULL COMMENT 'retrieval / exploration / fallback / human_override',
  confidence_score DECIMAL(18, 10) NULL,
  rationale_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_run_window_best_action (run_id, window_id),
  KEY idx_window_action_type (window_id, action_type),
  CONSTRAINT fk_window_best_actions_run
    FOREIGN KEY (run_id) REFERENCES ${TABLES.TRAIN_RUNS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_window_best_actions_window
    FOREIGN KEY (window_id) REFERENCES ${TABLES.MARKET_WINDOWS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_window_best_actions_feature_memory
    FOREIGN KEY (feature_memory_id) REFERENCES ${TABLES.FEATURE_MEMORIES}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_window_best_actions_parameter_set
    FOREIGN KEY (best_strategy_parameter_set_id) REFERENCES ${TABLES.STRATEGY_PARAMETER_SETS}(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const UNKNOWN_FEATURE_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.UNKNOWN_FEATURE_EVENTS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT NOT NULL,
  window_id BIGINT NOT NULL,
  feature_memory_id BIGINT NOT NULL,
  reason_code VARCHAR(64) NOT NULL COMMENT 'low_similarity / low_sample_count / conflicting_matches / unstable_outcomes',
  fallback_action_type VARCHAR(32) NOT NULL COMMENT 'reduce / stop / explore_small',
  fallback_risk_multiplier DECIMAL(10, 6) NOT NULL DEFAULT 0,
  resolved_by_writeback TINYINT(1) NOT NULL DEFAULT 0,
  details_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_run_window_unknown (run_id, window_id),
  KEY idx_reason_code (reason_code),
  KEY idx_resolved_by_writeback (resolved_by_writeback),
  CONSTRAINT fk_unknown_feature_events_run
    FOREIGN KEY (run_id) REFERENCES ${TABLES.TRAIN_RUNS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_unknown_feature_events_window
    FOREIGN KEY (window_id) REFERENCES ${TABLES.MARKET_WINDOWS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_unknown_feature_events_feature_memory
    FOREIGN KEY (feature_memory_id) REFERENCES ${TABLES.FEATURE_MEMORIES}(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const FEATURE_WRITEBACKS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.FEATURE_WRITEBACKS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT NOT NULL,
  window_id BIGINT NOT NULL,
  feature_memory_id BIGINT NOT NULL,
  best_action_id BIGINT NOT NULL,
  writeback_type VARCHAR(32) NOT NULL COMMENT 'new_memory / memory_reinforced / memory_split / memory_demoted',
  writeback_payload_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_feature_memory_writeback_type (feature_memory_id, writeback_type),
  CONSTRAINT fk_feature_writebacks_run
    FOREIGN KEY (run_id) REFERENCES ${TABLES.TRAIN_RUNS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_writebacks_window
    FOREIGN KEY (window_id) REFERENCES ${TABLES.MARKET_WINDOWS}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_writebacks_feature_memory
    FOREIGN KEY (feature_memory_id) REFERENCES ${TABLES.FEATURE_MEMORIES}(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_writebacks_best_action
    FOREIGN KEY (best_action_id) REFERENCES ${TABLES.WINDOW_BEST_ACTIONS}(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const ANALYSIS_ARTIFACTS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.ANALYSIS_ARTIFACTS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  artifact_key VARCHAR(120) NOT NULL,
  artifact_type VARCHAR(64) NOT NULL COMMENT 'feature-audit / retrieval-report / evaluation-report / goal-tracking / ai-summary',
  run_id BIGINT NULL,
  window_id BIGINT NULL,
  symbol VARCHAR(20) NOT NULL,
  payload_json JSON NOT NULL,
  summary_markdown MEDIUMTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_artifact_key (artifact_key),
  KEY idx_type_symbol_created_at (artifact_type, symbol, created_at),
  KEY idx_run_id (run_id),
  KEY idx_window_id (window_id),
  CONSTRAINT fk_analysis_artifacts_run
    FOREIGN KEY (run_id) REFERENCES ${TABLES.TRAIN_RUNS}(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_analysis_artifacts_window
    FOREIGN KEY (window_id) REFERENCES ${TABLES.MARKET_WINDOWS}(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const FEATURE_EMBEDDINGS_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLES.FEATURE_EMBEDDINGS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  feature_memory_id BIGINT NOT NULL,
  embedding_provider VARCHAR(64) NOT NULL COMMENT 'local / openai / custom',
  embedding_model VARCHAR(64) NOT NULL,
  embedding_version VARCHAR(64) NOT NULL,
  vector_dim INT NOT NULL,
  storage_type VARCHAR(32) NOT NULL DEFAULT 'json' COMMENT 'json / external-vector-db',
  vector_json JSON NULL,
  external_ref VARCHAR(255) NULL COMMENT 'vector db primary id when offloaded',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_feature_embedding_version (feature_memory_id, embedding_provider, embedding_model, embedding_version),
  KEY idx_external_ref (external_ref),
  CONSTRAINT fk_feature_embeddings_feature_memory
    FOREIGN KEY (feature_memory_id) REFERENCES ${TABLES.FEATURE_MEMORIES}(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

module.exports = {
  ANALYSIS_ARTIFACTS_DDL,
  FEATURE_CANDIDATE_POOLS_DDL,
  FEATURE_CANDIDATE_POOL_ITEMS_DDL,
  FEATURE_EMBEDDINGS_DDL,
  FEATURE_MATCHES_DDL,
  FEATURE_MEMORIES_DDL,
  FEATURE_WRITEBACKS_DDL,
  MARKET_WINDOWS_DDL,
  STRATEGY_DEFINITIONS_DDL,
  STRATEGY_LIBRARY_MEMBERS_DDL,
  STRATEGY_PARAMETER_SETS_DDL,
  TRAIN_RUNS_DDL,
  UNKNOWN_FEATURE_EVENTS_DDL,
  WINDOW_BEST_ACTIONS_DDL,
  WINDOW_STRATEGY_EVALUATIONS_DDL,
};
