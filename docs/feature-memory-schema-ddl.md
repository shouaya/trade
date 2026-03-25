# Feature Memory Schema DDL Draft

## 文档定位

本文档是 [feature-memory-greenfield-prd.md](/Users/ts-changchang.zhuang/git/money/docs/feature-memory-greenfield-prd.md) 的数据库落地稿。

目标不是兼容旧 schema，而是给出一版可以直接开始实施的 MySQL 设计草案。

本文档回答 4 个问题：

1. 新系统最小可用 schema 是什么。
2. 每张表的主键、外键、唯一约束和索引如何设计。
3. 哪些字段应当作为未来向量数据库接入点。
4. 第一阶段到底先建哪些表，后建哪些表。

---

## 一、设计原则

### 1. MySQL 是事实真源

第一阶段默认：

- MySQL 保存全部业务事实
- 向量数据库不是主库
- 向量检索层未来可替换，但不改变业务主模型

### 2. 先做明确业务表，不做万能 JSON 主表

允许使用 JSON，但 JSON 只用于：

- 特征向量内容
- 参数内容
- 调试元数据
- 解释摘要

不允许再用一个“万能配置大表 + content JSON”承载整个系统知识。

### 3. 以 `window` 为核心挂载点

未来训练、匹配、评估、回写，统一围绕 `market_windows.id` 组织。

### 4. 以 `strategy parameter set` 为可执行最小单位

未来真正被检索、被评估、被复用的对象，不是泛泛的“策略类型”，而是：

- 某个策略定义
- 某一组参数集

所以策略定义和参数集必须拆表。

---

## 二、建议保留与删除

### 保留

- `klines`

### 不进入新体系核心

以下旧表建议直接停止扩展，并在 greenfield 实施后整体退场：

- `backtest_results`
- `strategies`
- `trades`
- `tasks`
- `train_configs`
- `training_config_details`
- `validation_config_details`
- `snapshot_config_details`
- `rolling_pool_details`
- `rolling_rule_details`
- `router_config_details`
- `policy_config_details`
- `generic_config_details`
- `train_run_requests`
- `train_goal_tracking`
- `train_artifacts`

---

## 三、最小可用一期表

第一期为了尽快替换“固定网格月月重排”，建议只先建下面 10 张表：

1. `train_runs`
2. `market_windows`
3. `feature_memories`
4. `feature_matches`
5. `strategy_definitions`
6. `strategy_parameter_sets`
7. `strategy_library_members`
8. `window_strategy_evaluations`
9. `window_best_actions`
10. `feature_writebacks`

第二期再补：

11. `feature_candidate_pools`
12. `feature_candidate_pool_items`
13. `unknown_feature_events`
14. `analysis_artifacts`
15. `feature_embeddings`

---

## 四、DDL 草案

以下 SQL 为草案级设计，目标是结构清晰、可直接开始实施。

## 4.1 train_runs

```sql
CREATE TABLE IF NOT EXISTS train_runs (
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
```

说明：

- `run_key` 取代旧时代的 `task_id / run_id / request_id`
- `train_runs` 是未来唯一运行主表

## 4.2 market_windows

```sql
CREATE TABLE IF NOT EXISTS market_windows (
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
    FOREIGN KEY (parent_window_id) REFERENCES market_windows(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

说明：

- 未来所有特征、匹配、评估和回写统一挂到 `window_id`

## 4.3 feature_memories

```sql
CREATE TABLE IF NOT EXISTS feature_memories (
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
    FOREIGN KEY (window_id) REFERENCES market_windows(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

说明：

- `feature_vector_json` 是第一阶段真实向量存储位
- 未来向量库只是同步层，不改变这张表语义

## 4.4 feature_matches

```sql
CREATE TABLE IF NOT EXISTS feature_matches (
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
    FOREIGN KEY (run_id) REFERENCES train_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_matches_target
    FOREIGN KEY (target_feature_memory_id) REFERENCES feature_memories(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_matches_matched
    FOREIGN KEY (matched_feature_memory_id) REFERENCES feature_memories(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

说明：

- 这张表是“为什么命中/没命中”的核心审计层

## 4.5 strategy_definitions

```sql
CREATE TABLE IF NOT EXISTS strategy_definitions (
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
```

说明：

- 策略定义只保存“逻辑身份”

## 4.6 strategy_parameter_sets

```sql
CREATE TABLE IF NOT EXISTS strategy_parameter_sets (
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
    FOREIGN KEY (strategy_definition_id) REFERENCES strategy_definitions(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_strategy_parameter_sets_discovered_run
    FOREIGN KEY (discovered_run_id) REFERENCES train_runs(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

说明：

- 参数集是未来最小可执行和可检索单位

## 4.7 strategy_library_members

```sql
CREATE TABLE IF NOT EXISTS strategy_library_members (
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
    FOREIGN KEY (strategy_parameter_set_id) REFERENCES strategy_parameter_sets(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_strategy_library_members_last_window
    FOREIGN KEY (last_verified_window_id) REFERENCES market_windows(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

说明：

- 这张表对应“当前这个 symbol 能用的动态策略库”

## 4.8 feature_candidate_pools

```sql
CREATE TABLE IF NOT EXISTS feature_candidate_pools (
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
    FOREIGN KEY (run_id) REFERENCES train_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_candidate_pools_feature_memory
    FOREIGN KEY (feature_memory_id) REFERENCES feature_memories(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 4.9 feature_candidate_pool_items

```sql
CREATE TABLE IF NOT EXISTS feature_candidate_pool_items (
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
    FOREIGN KEY (feature_candidate_pool_id) REFERENCES feature_candidate_pools(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_candidate_pool_items_parameter_set
    FOREIGN KEY (strategy_parameter_set_id) REFERENCES strategy_parameter_sets(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 4.10 window_strategy_evaluations

```sql
CREATE TABLE IF NOT EXISTS window_strategy_evaluations (
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
    FOREIGN KEY (run_id) REFERENCES train_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_window_strategy_evaluations_window
    FOREIGN KEY (window_id) REFERENCES market_windows(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_window_strategy_evaluations_feature_memory
    FOREIGN KEY (feature_memory_id) REFERENCES feature_memories(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_window_strategy_evaluations_parameter_set
    FOREIGN KEY (strategy_parameter_set_id) REFERENCES strategy_parameter_sets(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

说明：

- 未来替代旧 `backtest_results` 的，是更明确的“窗口-策略评估事实表”

## 4.11 window_best_actions

```sql
CREATE TABLE IF NOT EXISTS window_best_actions (
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
    FOREIGN KEY (run_id) REFERENCES train_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_window_best_actions_window
    FOREIGN KEY (window_id) REFERENCES market_windows(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_window_best_actions_feature_memory
    FOREIGN KEY (feature_memory_id) REFERENCES feature_memories(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_window_best_actions_parameter_set
    FOREIGN KEY (best_strategy_parameter_set_id) REFERENCES strategy_parameter_sets(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 4.12 unknown_feature_events

```sql
CREATE TABLE IF NOT EXISTS unknown_feature_events (
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
    FOREIGN KEY (run_id) REFERENCES train_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_unknown_feature_events_window
    FOREIGN KEY (window_id) REFERENCES market_windows(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_unknown_feature_events_feature_memory
    FOREIGN KEY (feature_memory_id) REFERENCES feature_memories(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 4.13 feature_writebacks

```sql
CREATE TABLE IF NOT EXISTS feature_writebacks (
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
    FOREIGN KEY (run_id) REFERENCES train_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_writebacks_window
    FOREIGN KEY (window_id) REFERENCES market_windows(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_writebacks_feature_memory
    FOREIGN KEY (feature_memory_id) REFERENCES feature_memories(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_feature_writebacks_best_action
    FOREIGN KEY (best_action_id) REFERENCES window_best_actions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 4.14 analysis_artifacts

```sql
CREATE TABLE IF NOT EXISTS analysis_artifacts (
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
    FOREIGN KEY (run_id) REFERENCES train_runs(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_analysis_artifacts_window
    FOREIGN KEY (window_id) REFERENCES market_windows(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 4.15 feature_embeddings

```sql
CREATE TABLE IF NOT EXISTS feature_embeddings (
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
    FOREIGN KEY (feature_memory_id) REFERENCES feature_memories(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

说明：

- 第一期可只写 `vector_json`
- 第二期接入向量库时再填 `external_ref`

---

## 五、建议索引策略

重点查询路径应围绕 6 类场景设计。

### 1. 某个 symbol 的最近窗口

依赖：

- `market_windows.idx_symbol_window_type_start`

### 2. 某个窗口的特征内容

依赖：

- `feature_memories.uniq_window_feature_version`

### 3. 某次运行的 top-k 相似匹配

依赖：

- `feature_matches.uniq_run_target_rank`
- `feature_matches.idx_target_similarity`

### 4. 某个 symbol 当前可用策略库

依赖：

- `strategy_library_members.idx_symbol_status_score`

### 5. 某个窗口所有策略评估表现

依赖：

- `window_strategy_evaluations.idx_window_score`

### 6. 未知特征事件排查

依赖：

- `unknown_feature_events.idx_reason_code`
- `unknown_feature_events.idx_resolved_by_writeback`

---

## 六、一期实施顺序

建议不要一次性把 15 张表全落地。

### Phase 1

先建：

- `train_runs`
- `market_windows`
- `feature_memories`
- `strategy_definitions`
- `strategy_parameter_sets`
- `strategy_library_members`
- `window_strategy_evaluations`
- `window_best_actions`
- `feature_writebacks`

原因：

- 这 9 张表已经足够替代“固定网格月月全量重排”的主干逻辑

### Phase 2

再建：

- `feature_matches`
- `feature_candidate_pools`
- `feature_candidate_pool_items`
- `unknown_feature_events`

原因：

- 这一层开始把检索、候选池和未知场景保守处理补完整

### Phase 3

最后建：

- `analysis_artifacts`
- `feature_embeddings`

原因：

- 这两张表分别面向报告和未来向量检索扩展

---

## 七、建议的代码模块映射

数据库之外，代码也建议同步按新模型重组：

- `train/src/modules/feature-memory/`
- `train/src/modules/strategy-library/`
- `train/src/modules/retrieval/`
- `train/src/modules/exploration/`
- `train/src/modules/writeback/`

而不是继续把核心逻辑散落在：

- `generate-validation-artifacts`
- `rolling-artifact-builder`
- `router-artifact-builder`

这些更偏旧时代产物导向的入口里。

---

## 八、结论

如果下一步开始重建数据库，最重要的不是“把旧表改得更漂亮”，而是：

- 让 `window`
- `feature memory`
- `strategy parameter set`
- `evaluation`
- `writeback`

成为真正的一等公民。

一句话总结：

**未来 schema 的中心不该再是 config 和 result_group，而应是 feature memory 和 window lifecycle。**
