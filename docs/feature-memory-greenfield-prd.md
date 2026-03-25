# Feature Memory Greenfield PRD

## 文档定位

本文档不是在现有 `train` 数据结构上继续打补丁。

本文档的前提是：

- 当前系统仍处于探索阶段。
- 不需要兼容旧数据。
- 不需要兼容旧表结构。
- 不需要为了保留旧脚本而牺牲第一性原理。

因此，本 PRD 采用 `greenfield` 视角重新定义：

1. 系统真正要学习的对象是什么。
2. 数据库真正需要保存的核心资产是什么。
3. 哪些旧表和旧概念应该整体退出。
4. 未来如何平滑接入向量数据库，而不是一开始就被向量库绑定。

对应的数据库 DDL 草案见：

- [feature-memory-schema-ddl.md](/Users/ts-changchang.zhuang/git/money/docs/feature-memory-schema-ddl.md)

---

## 一、第一性原理

### 1. 系统不是在找“固定冠军参数”

系统的目标不是：

- 维护一套固定的 512 参数组合；
- 每个月重新全量回测；
- 从中挑一个当月冠军。

这类做法即使改成 `history-only rolling`，也依然主要是“事后筛选系统”。

### 2. 系统真正要学习的是“市场状态 -> 应对方式”

系统真正应沉淀的知识是：

- 当前市场状态是什么。
- 这个状态是否在历史里出现过。
- 历史上最相似的状态里，哪组策略和参数更有效。
- 如果没有相似状态，应当保守、减仓还是停止。
- 当本次窗口结束后，这个新状态和最佳应对方式如何回写入系统。

因此，系统真正要维护的是：

1. 市场状态记忆。
2. 状态与候选策略池的映射。
3. 状态与最佳策略组合的映射。
4. 状态未命中时的保守策略。
5. 状态回写后的知识增长。

### 3. 策略库应当增长，参数集应当演化

参数不应长期被视为固定输入。

长期目标应当是：

- 新状态出现时可以发现新参数簇；
- 已存在状态下可以淘汰无效参数簇；
- 策略库和参数库都随时间增长与收缩。

也就是说，系统不是“固定网格 + 月月重排”，而是“可成长的经验库”。

---

## 二、Greenfield 目标

### 1. 总目标

构建一个：

**Feature Memory Driven Symbol-Specific Strategy Machine**

中文可定义为：

**特征记忆驱动的单品种自适应策略机器**

### 2. 核心能力

该系统必须具备以下能力：

1. 从任意月/周/日/开盘窗口提取特征向量。
2. 在历史库中查找最相似的状态。
3. 返回相应候选策略池与最佳策略组合。
4. 根据置信度决定：
   - 直接复用
   - 降风险复用
   - 保守停止
   - 进入探索模式
5. 在窗口结束后，把新的状态和最佳策略写回知识库。

### 3. 成功标准

未来系统的成功，不是“某一轮收益最高”，而是：

1. 随着时间推进，特征命中率上升。
2. 未知状态占比下降。
3. 未知状态时的保守机制有效抑制大亏。
4. 命中状态时，策略复用比默认策略更稳定。
5. 策略库和参数库增长具有可解释性，而不是无边界膨胀。

---

## 三、明确放弃的旧概念

以下内容不应作为新系统的核心骨架继续保留。

### 1. 放弃“训练表 + 验证表 + 结果表”的主导思维

旧思维更像：

- 训练配置
- 验证配置
- 某个结果表
- 某个 router 文件

这更适合批处理回测系统，不适合特征记忆系统。

新系统应以：

- `feature memory`
- `strategy library`
- `match / retrieval / exploration`

作为主骨架。

### 2. 放弃“固定参数网格月月全量重排”

以下行为不应再视为主训练流程：

- 每个 rolling 月重新对 512 参数做完整回测；
- 只因它是 `history-only` 就默认正确；
- 用全量重排结果充当长期策略维护机制。

大网格扫描只应保留为：

- 冷启动
- 未知特征探索
- 明确的 research 任务

### 3. 放弃“万能 JSON 配置表”作为系统知识主存储

`train_configs + content JSON + 各种 detail 表` 这种结构适合配置管理，
但不适合作为未来特征记忆系统的核心知识存储。

未来应把：

- 配置
- 特征记忆
- 策略库
- 检索结果
- 探索记录
- 验证记录

拆成明确业务表，而不是继续堆入 JSON。

### 4. 放弃“保留旧系统兼容性”的约束

所有新设计都以：

- 业务正确
- 结构清晰
- 可追踪
- 可扩展到向量检索

为第一优先级。

不为旧表、旧字段、旧脚本路径做保留。

---

## 四、新系统的顶层模块

greenfield 后建议把 `train` 拆成 6 个业务模块。

### 1. Feature Extraction

输入：

- klines
- symbol
- timeframe / window

输出：

- 标准化特征向量
- 人类可读特征摘要
- feature version

### 2. Feature Memory

负责保存：

- 历史特征样本
- 每个样本对应的窗口
- 是否已命中已有模式
- 样本最终归因与标签

### 3. Strategy Library

负责保存：

- 已发现的策略定义
- 参数集
- 版本
- 是否启用
- 来源

### 4. Retrieval & Matching

负责：

- 相似特征检索
- top-k 匹配
- 置信度计算
- 已知 / 未知状态判断

### 5. Exploration

负责：

- 未知状态下的策略探索
- 参数空间扩展 / 收缩
- 新策略 / 新参数发现
- 探索成本与结果记录

### 6. Evaluation & Writeback

负责：

- 窗口结束后的最佳策略确认
- 结果落库
- 记忆回写
- 更新状态到策略的映射强度

---

## 五、推荐的新数据库主模型

以下设计优先基于 MySQL。

原因：

- 当前项目主数据源已是 MySQL。
- 事务、审计、可追溯、关联查询都更成熟。
- 可以先把业务模型跑通，再决定是否把“相似检索层”升级为向量数据库。

## 5.1 必保留表

### `klines`

继续保留。

它仍然是整个系统最底层的事实数据。

---

## 5.2 新主表

### `train_runs`

用途：

- 记录一次完整训练/学习任务

建议字段：

- `id`
- `run_key`
- `symbol`
- `interval_type`
- `mode`
  - `bootstrap`
  - `rolling`
  - `exploration`
  - `evaluation`
- `status`
  - `queued`
  - `running`
  - `completed`
  - `failed`
- `started_at`
- `completed_at`
- `feature_version`
- `strategy_space_version`
- `notes_json`

说明：

- 未来不再用 `tasks + train_run_requests` 双轨并存。
- `train_runs` 直接成为唯一的运行主表。

### `market_windows`

用途：

- 统一保存月/周/日/开盘窗口

建议字段：

- `id`
- `symbol`
- `interval_type`
- `window_type`
  - `monthly`
  - `weekly`
  - `daily`
  - `opening`
- `window_start_ms`
- `window_end_ms`
- `window_key`
- `parent_window_id`
- `is_complete`

说明：

- 所有特征、匹配、验证、回写都挂到 `market_windows`
- 不再散落在多个配置与结果表中

### `feature_memories`

用途：

- 保存一个窗口对应的标准化特征记忆

建议字段：

- `id`
- `window_id`
- `symbol`
- `feature_version`
- `feature_schema_version`
- `feature_vector_json`
- `feature_summary_json`
- `feature_bucket`
- `confidence_seed`
- `created_at`

说明：

- `feature_vector_json` 先用 MySQL JSON 保存
- 将来可同步到向量库

### `feature_matches`

用途：

- 保存某次检索时，当前窗口与历史窗口的匹配结果

建议字段：

- `id`
- `run_id`
- `target_feature_memory_id`
- `matched_feature_memory_id`
- `rank_no`
- `distance_score`
- `similarity_score`
- `match_reason_json`
- `is_reused`
- `created_at`

说明：

- 这张表是“为什么命中/为什么没命中”的关键证据表

### `strategy_definitions`

用途：

- 保存策略类型定义

建议字段：

- `id`
- `strategy_key`
- `strategy_family`
- `strategy_type`
- `entry_logic_version`
- `exit_logic_version`
- `risk_logic_version`
- `is_active`
- `created_at`

### `strategy_parameter_sets`

用途：

- 保存具体参数集

建议字段：

- `id`
- `strategy_definition_id`
- `parameter_key`
- `parameters_json`
- `source_type`
  - `seed`
  - `discovered`
  - `mutated`
  - `promoted`
- `is_active`
- `created_at`

说明：

- 以后“策略”与“参数集”必须拆开
- 不再把一个长策略名当成主身份

### `strategy_library_members`

用途：

- 保存某个 symbol 当前可用策略库成员

建议字段：

- `id`
- `symbol`
- `strategy_parameter_set_id`
- `status`
  - `candidate`
  - `trusted`
  - `shadow`
  - `retired`
- `promotion_score`
- `sample_count`
- `created_at`
- `updated_at`

### `feature_candidate_pools`

用途：

- 保存某类特征对应的候选策略池

建议字段：

- `id`
- `feature_memory_id`
- `symbol`
- `pool_status`
  - `reused`
  - `explored`
  - `fallback`
- `confidence_score`
- `pool_size`
- `created_at`

### `feature_candidate_pool_items`

用途：

- 候选池成员明细

建议字段：

- `id`
- `feature_candidate_pool_id`
- `strategy_parameter_set_id`
- `rank_no`
- `selection_reason`
- `expected_risk_mode`
- `created_at`

### `window_strategy_evaluations`

用途：

- 保存一个窗口中某个策略参数集的真实验证表现

建议字段：

- `id`
- `run_id`
- `window_id`
- `feature_memory_id`
- `strategy_parameter_set_id`
- `evaluation_role`
  - `retrieved`
  - `exploration`
  - `fallback`
- `total_pnl`
- `return_pct`
- `max_drawdown_pct`
- `trade_count`
- `score`
- `created_at`

### `window_best_actions`

用途：

- 保存某个窗口最终确认的最佳应对方式

建议字段：

- `id`
- `window_id`
- `feature_memory_id`
- `best_strategy_parameter_set_id`
- `action_type`
  - `trade`
  - `reduce`
  - `stop`
  - `explore_small`
- `risk_multiplier`
- `selection_source`
  - `retrieval`
  - `exploration`
  - `fallback`
- `confidence_score`
- `created_at`

### `unknown_feature_events`

用途：

- 显式保存未知状态事件

建议字段：

- `id`
- `run_id`
- `window_id`
- `feature_memory_id`
- `reason_code`
  - `low_similarity`
  - `low_sample_count`
  - `conflicting_matches`
  - `unstable_outcomes`
- `fallback_action_type`
- `fallback_risk_multiplier`
- `resolved_by_writeback`
- `created_at`

### `feature_writebacks`

用途：

- 保存窗口结束后的知识回写

建议字段：

- `id`
- `run_id`
- `window_id`
- `feature_memory_id`
- `best_action_id`
- `writeback_type`
  - `new_memory`
  - `memory_reinforced`
  - `memory_split`
  - `memory_demoted`
- `writeback_payload_json`
- `created_at`

---

## 5.3 报告与产物表

### `analysis_artifacts`

用途：

- 统一保存结构化分析产物

建议字段：

- `id`
- `artifact_key`
- `artifact_type`
  - `feature-audit`
  - `retrieval-report`
  - `evaluation-report`
  - `goal-tracking`
  - `ai-summary`
- `run_id`
- `window_id`
- `symbol`
- `payload_json`
- `summary_markdown`
- `created_at`

说明：

- 以后不再围绕 `config_key` 组织分析世界
- 而是围绕 `run_id / window_id / symbol`

---

## 六、建议删除或逐步退出的旧表

如果完全按 greenfield 重做，以下表不建议继续作为核心主表保留：

### 应整体退场

- `backtest_results`
- `strategies`
- `train_configs`
- `training_config_details`
- `validation_config_details`
- `snapshot_config_details`
- `rolling_pool_details`
- `rolling_rule_details`
- `router_config_details`
- `policy_config_details`
- `generic_config_details`
- `train_goal_tracking`
- `train_artifacts`
- `train_run_requests`
- `tasks`

### 可作为过渡期保留，但不应继续扩张

- `trades`

说明：

- `trades` 在新系统里仍有价值，但建议后续重命名或重构为更明确的执行/评估明细表。
- 如果完全按新系统落地，也可以重做成：
  - `strategy_trade_executions`
  - `window_trade_summaries`

---

## 七、未来向量数据库规划

## 7.1 为什么先不以向量库为中心

当前阶段更重要的是先定义业务对象：

- 什么是 feature memory
- 什么是 match
- 什么是 unknown event
- 什么是 writeback

如果这些业务对象还没明确，
直接引入向量数据库只会让问题从“没有架构”变成“有检索技术但没有业务定义”。

因此第一阶段建议：

- MySQL 作为唯一事实真源
- 向量检索先做可插拔接口

## 7.2 向量库适合承接什么

未来适合进入向量库的对象是：

- `feature_memory.id`
- `symbol`
- `window_type`
- `feature_version`
- `embedding_vector`
- 少量 metadata

向量库只做一件事：

- top-k 相似特征检索

业务解释、策略选择、回写、审计仍回到 MySQL 完成。

## 7.3 推荐的接入方式

建议未来增加一层抽象：

- `FeatureRetrievalProvider`

第一版实现：

- `MysqlFeatureRetrievalProvider`
  - 直接读取 `feature_vector_json`
  - 程序内做 cosine / euclidean 相似度

第二版实现：

- `VectorDbFeatureRetrievalProvider`
  - 调用向量库 ANN 检索
  - 返回 memory ids

这样业务层不会被向量库绑死。

---

## 八、推荐的训练主流程

greenfield 后的主流程建议定义如下。

### 阶段 A：Bootstrap

用于冷启动。

流程：

1. 切窗口
2. 提取特征
3. 因为记忆库为空，进入探索模式
4. 运行较大参数探索
5. 确认最佳策略
6. 写入 feature memory 与 strategy library

### 阶段 B：Rolling Retrieval

用于常规月/周/日窗口。

流程：

1. 提取当前窗口特征
2. 从记忆库检索 top-k 相似状态
3. 计算置信度
4. 生成候选池
5. 仅对少量候选做验证
6. 产出 action

### 阶段 C：Unknown Handling

当匹配失败时：

1. 标记 `unknown_feature_event`
2. 默认 `reduce / stop / explore_small`
3. 控制风险
4. 等窗口结束后补探索与回写

### 阶段 D：Writeback

窗口结束后：

1. 确认最佳策略与风险动作
2. 判断：
   - 新特征
   - 旧特征强化
   - 旧特征分裂
   - 旧特征降级
3. 写回 memory 和 strategy library

---

## 九、必须新增的核心指标

在新架构中，报告应重点关注：

- 特征命中率
- top-k 命中率
- 未知特征占比
- 未知特征保守成功率
- 已知特征复用收益
- 写回后再次命中率
- 策略库增长率
- 策略库淘汰率
- 每类特征的样本数与稳定度

这些指标比“某月从 512 里选出了谁”更接近系统的真正目标。

---

## 十、实施建议

建议按下面顺序实施，而不是一次性推翻全部实现。

### Phase 1

- 落 `feature_memory` 主模型文档
- 落 `strategy_library` 主模型文档
- 明确旧表退场名单

### Phase 2

- 先在 MySQL 中实现最小可用版本
- 用程序内相似度检索替代全量网格月月重排

### Phase 3

- 接入未知特征保守逻辑
- 接入 writeback
- 接入新报告指标

### Phase 4

- 如果样本量和维度都上来，再引入向量数据库

---

## 结论

如果完全按第一性原理重做，这个系统的核心不应该再是：

- `config`
- `result table`
- `top strategy snapshot`
- `router file`

而应该是：

- `feature memory`
- `strategy library`
- `retrieval`
- `unknown handling`
- `writeback`

也就是说，未来系统应当从“回测配置驱动系统”升级为：

**特征记忆驱动的策略机器**
