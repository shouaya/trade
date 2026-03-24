# Train METHODOLOGY Review Analysis

## 目标

本文用于评估以下材料中的 review 意见，判断哪些建议值得采纳、哪些已经被现有 `train` 文档覆盖、哪些暂不建议直接落地：

- [train/METHODOLOGY.md](/Users/ts-changchang.zhuang/git/money/train/METHODOLOGY.md)
- [train/PLAYBOOK.md](/Users/ts-changchang.zhuang/git/money/train/PLAYBOOK.md)
- [train/TASK_TEMPLATE.md](/Users/ts-changchang.zhuang/git/money/train/TASK_TEMPLATE.md)
- [docs/chatgpt.txt](/Users/ts-changchang.zhuang/git/money/docs/chatgpt.txt)
- [docs/deepseek_1.txt](/Users/ts-changchang.zhuang/git/money/docs/deepseek_1.txt)
- [docs/gemni.txt](/Users/ts-changchang.zhuang/git/money/docs/gemni.txt)

## 总体结论

结论是：这些 review 里有不少可采纳部分，但大多数不是推翻现有方法论，而是把当前体系从“研究可解释”继续推进到“验证更硬、上线更近”。

现有文档的主框架已经比较完整，尤其是以下几点已经明确成立：

- 单品种单独训练，方法可迁移，参数和 policy 不可硬搬。
- 候选池优先于 Top1。
- 使用 `monthly_guard -> weekly_guard -> daily_router -> loss_recheck` 的分层结构。
- 未来期验证优先于训练内表现。
- AI 执行边界、失败回退顺序、产出物要求已经写得比较清楚。

因此，这次 review 最值得采纳的不是“重写方法论”，而是补强 4 个薄弱点：

1. 把研究型特征进一步明确为“如何改造成 causal / live 特征”。
2. 把交易成本、滑点、摩擦敏感度从代码能力提升为方法论必检项。
3. 把验证标准从“原则通过”补成“更硬的红线和统一看板”。
4. 把 walk-forward 和策略稳定性从扩展探索提升为主流程旁路验证。

## 与现有文档的符合度

外部 review 中有些建议其实已经被现有文档覆盖，不应再重复当作新增结论：

- “不要迷信 Top1” 已在 [train/METHODOLOGY.md](/Users/ts-changchang.zhuang/git/money/train/METHODOLOGY.md) 和 [train/PLAYBOOK.md](/Users/ts-changchang.zhuang/git/money/train/PLAYBOOK.md) 多次强调。
- “未来期验证必须做、失败后要回退排查” 已在方法论和执行手册中明确。
- “规则不能记忆日期、必须解释样本来源” 已在日级规则章节中写成强约束。
- “loss_recheck 不能成为主要 alpha 来源” 也已经被写入当前方法。

所以本次真正需要判断的是：哪些新意见能补当前空白，而不是重复已有原则。

## 建议逐项判断

### 1. 研究型特征改造成 causal 特征

判断：`高优先级采纳`

原因：

- 这是三份 review 里最一致的一条，也是现有文档已经承认但尚未落地为标准流程的一条。
- [train/METHODOLOGY.md](/Users/ts-changchang.zhuang/git/money/train/METHODOLOGY.md) 已明确当前很多特征仍依赖整天、整周 completed realized data，并明确指出正式上线前要改成 `rolling vol / rolling range / intraday state`。
- 现有文档已经承认这是边界问题，但还没有把“怎么改”写成执行清单。

建议采纳方式：

- 在 `METHODOLOGY.md` 的“当前方法的边界”之后增加一个“研究特征 -> 实盘特征改造清单”。
- 不直接承诺唯一参数，比如 `rolling_60min`、`rolling_1440min` 可以作为示例而不是硬编码标准。
- 把 reviewer 提到的 `opening impulse`、`trend persistence`、`reversal strength`、`event shock proxy` 作为候选扩展特征列入下一阶段研究清单。

不建议直接照抄的部分：

- 不建议现在就把所有具体窗口长度写死，因为当前仓库仍是研究主链路，窗口长度本身也应按交易对和执行时点验证。

### 2. 结果看板 / 统一评分面板

判断：`中高优先级采纳`

原因：

- `chatgpt.txt` 提到“先把报告补成真正可评估的报告”，这条只算“部分成立”。
- 现有体系并非没有报告。`router-validate` 已经输出 `totalPnl`、`returnPct`、`maxDrawdown`、`positiveDays`、`negativeDays`、`tradedDays`，并和 `defaultStrategy`、`rank1Strategy`、`top10EqualWeight`、`oracleBestOfDay` 比较。
- [train/reports/regime-routing-results/BTCJPY_dual_year_v10_daily_policy_summary.md](/Users/ts-changchang.zhuang/git/money/train/reports/regime-routing-results/BTCJPY_dual_year_v10_daily_policy_summary.md) 也已经包含训练总 PnL、验证总 PnL、验证回撤和逐条规则命中情况。

不足在于：

- 训练期与未来期指标还没有合并成一个统一的“一页式总览”。
- `profitFactor`、`tradeCount`、负收益周数量、规则触发占比、路由稳定性等指标没有被固定纳入统一面板。

建议采纳方式：

- 新增一个固定的 `report scorecard` 模板。
- 把训练期与未来期关键指标放在同一页。
- 固定加入：
  - `totalPnl`
  - `returnPct`
  - `maxDrawdown`
  - `profitFactor`
  - `tradeCount`
  - `positiveDays / negativeDays`
  - 负收益周数量
  - 相对 `default/rank1/top10/oracle` 的增益
  - stop / reduce / full-size 天数占比

### 3. 交易成本、滑点、摩擦敏感度

判断：`高优先级采纳`

原因：

- 这是当前“代码能力已具备，但方法论还没升格”的最典型缺口。
- 代码层已经支持手续费和滑点：
  - [train/src/services/strategy-executor.ts](/Users/ts-changchang.zhuang/git/money/train/src/services/strategy-executor.ts)
  - [train/src/services/slippage-model.ts](/Users/ts-changchang.zhuang/git/money/train/src/services/slippage-model.ts)
- 但文档层只把“交易成本敏感度分析”放在未来扩展方向，没有要求每轮主验证都必须检查。

建议采纳方式：

- 将“成本敏感度验证”从扩展项提升为验证阶段的必检项。
- 每次关键报告至少增加 3 到 4 组情景：
  - 无成本
  - 基础手续费
  - 手续费 + 当前滑点模型
  - 极端滑点
- 增加一个简单指标，例如 `cost_to_gross_profit_ratio`，作为风险提示而不是绝对淘汰条件。

不建议直接照抄的部分：

- `gemni.txt` 中“超过 20% 就极度危险”可以作为经验警戒线，但不建议现在就写成一刀切硬规则，因为不同 symbol、不同频率和不同策略家族的可承受比例可能不同。

### 4. 更严格的未来期失败红线

判断：`高优先级采纳，但要改写`

原因：

- 现有文档已经有“通过条件 / 失败条件”，但还偏原则化。
- `deepseek_1.txt` 提出的“验证红线”对防止研究人员在失败结果上继续自我合理化有帮助。

建议采纳方式：

- 在 `METHODOLOGY.md` 与 `PLAYBOOK.md` 的未来期验证章节新增“红线”小节。
- 推荐保留为“默认失败判据”，而不是绝对数学公理。

建议写法：

- 未来期 `totalPnl < 0`，默认判定为失败，除非目标明确是防守型对照实验。
- 若明显弱于 `default strategy`，默认失败。
- 若未来期回撤显著恶化且无明确收益补偿，默认失败。
- 若收益主要依赖极少数偶然日，默认失败。

不建议直接照抄的部分：

- “未来期最大回撤 > 训练期 1.5 倍” 和 “超过 20% 的周亏损 > -5%” 这些数值不应直接定为统一硬阈值。
- 原因是当前方法强调单品种、单 policy，统一数值红线和该原则存在冲突。

### 5. 规则新增需要更强证据门槛

判断：`中高优先级采纳`

原因：

- 现有文档已经要求每条规则必须解释坏样本、说明误伤风险，这个方向是对的。
- `chatgpt.txt` 进一步提出“覆盖多个样本 + 未来期不恶化 + 对收益或回撤有贡献”作为入库门槛，这条值得补强。

建议采纳方式：

- 在“什么时候应新增规则”下增加一条：
  - 新规则原则上应覆盖多个同结构样本，或至少在训练期与未来期都能解释相同类型问题。
- 在 policy summary 中增加每条规则的：
  - train hits
  - validate hits
  - validate pnl
  - 是否存在明显误伤

说明：

- 当前 [train/reports/regime-routing-results/BTCJPY_dual_year_v10_daily_policy_summary.md](/Users/ts-changchang.zhuang/git/money/train/reports/regime-routing-results/BTCJPY_dual_year_v10_daily_policy_summary.md) 已经有一部分这种信息，所以这条更像是“把已有做法制度化”。

### 6. 策略家族适配性测试

判断：`可采纳，但应做成轻量预检`

原因：

- `deepseek_1.txt` 提出的“阶段 1.5：先用 3-5 个代表参数做快速适配性测试”是有价值的。
- 它和现有文档并不冲突，反而能减少在明显不适合的家族上浪费大规模网格训练成本。

建议采纳方式：

- 在 `PLAYBOOK.md` 的“定义策略家族与参数空间”前增加一个可选预检步骤。
- 目标不是正式评分，而是快速排除显然不适配的策略家族。

不建议直接照抄的部分：

- “Sharpe > 0.5” 不适合作为通用门槛。
- 更适合用相对判断：
  - 是否至少出现少量可盈利样本
  - 高低波环境下是否有结构差异
  - 是否出现持续全阶段失效

### 7. Walk-forward / rolling validation

判断：`高优先级采纳为旁路验证，不建议立刻替代主链路`

原因：

- 这是 review 里第二个高度一致的建议。
- 当前方法文档已经把 “rolling window” 与 “更严格的 OOS walk-forward” 放入扩展方向。
- 仓库里这类探索能力曾经以独立脚本存在；后续如果恢复，建议放到单独 research 目录而不是继续混在训练主链路脚本里。

建议采纳方式：

- 把 walk-forward 明确为主验证之外的“强化验证轨道”。
- 第一阶段不要替代当前的固定训练期 / 未来期主链路，而是并行增加：
  - 月级滚动训练 -> 次月验证
  - 周级滚动训练 -> 次周验证

原因：

- 当前主链路仍依赖固定候选池、固定 router、固定验证产物；如果立即全面切换，会让现有研究结果难以横向对比。

### 8. Policy Churn / 路由稳定性评分

判断：`值得采纳`

原因：

- `gemni.txt` 提出的“策略切换频率限制”很有价值。
- 现有报告已经统计 `stop days`、`half-or-less risk days`、`loss-recheck override days`，但还没有显式统计“同周内切换了多少次策略 / action”。

建议采纳方式：

- 在 `router-validate` 的报告里增加：
  - 每周策略切换次数
  - 每周 action 切换次数
  - 高频切换周占比
- 把它作为风险提示指标，而不是硬性淘汰标准。

### 9. 特征库继续扩展

判断：`可采纳，但放入研究 backlog`

原因：

- 增加 `opening impulse`、`trend persistence`、`reversal strength` 这类价格行为特征，和当前体系兼容，值得推进。
- 但 `orderbook imbalance`、`funding rate` 这类特征会引入新的数据依赖，已经超出当前 `klines + backtest_results + trades` 主链路。

建议采纳方式：

- 先扩展纯价格可导出的 causal features。
- 再评估是否引入新的外部数据源。

不建议现在直接采纳的部分：

- 立刻把订单簿、资金费率写进标准方法论。
- 原因是当前标准输入文档还没有覆盖这些数据依赖，直接写进去会让方法论和仓库现实脱节。

### 10. 固定量化阈值表 / 独立 decision_thresholds 目录

判断：`暂不建议直接采纳`

原因：

- `deepseek_1.txt` 提出的统一阈值表，看起来更自动化，但和当前方法的核心原则有冲突。
- [train/METHODOLOGY.md](/Users/ts-changchang.zhuang/git/money/train/METHODOLOGY.md) 已明确不同交易对的参数空间、周级阈值、日级阈值都必须重训，不能硬搬。
- 如果新增一个全局 `configs/decision_thresholds/`，很容易让阈值重新变成跨品种共用常量，削弱“symbol-specific policy”这个核心思想。

替代建议：

- 不做全局统一阈值表。
- 改为要求每个 router / policy catalog 显式记录本版本使用的条件范围、样本依据和验证表现。

### 11. 拆出独立的 AI 执行协议文档

判断：`低优先级，可选采纳`

原因：

- 这条不是错误，但收益没有前几条高。
- 当前仓库已经有：
  - 方法论文档
  - 执行手册
  - 任务模板
- 这三者已经形成了相对清晰的分层关系。

建议：

- 短期内不必再拆 `AI_EXECUTION_PROTOCOL.md`。
- 如果后续 `METHODOLOGY.md` 中的 AI 章节继续膨胀，再考虑下沉到单独文档。

### 12. 增加术语表

判断：`低成本、可采纳`

原因：

- 这是文档层面最容易落地的一条。
- `router`、`policy catalog`、`oracle best-of-day`、`loss_recheck`、`feature bucket` 这些术语确实有必要统一。

建议：

- 在 `METHODOLOGY.md` 开头或结尾增加 glossary。
- 这会提升 AI、研究员和后续维护者对文档的可读性。

## 推荐采纳清单

### P0

- 明确“研究特征 -> causal/live 特征”的改造清单。
- 将交易成本、滑点、摩擦敏感度升级为验证必检项。
- 在未来期验证章节增加默认失败红线。

### P1

- 增加统一 scorecard，把训练期与未来期指标汇总到一页。
- 增加规则入库的证据门槛。
- 把 walk-forward 升级为正式的旁路验证。
- 增加 policy churn / 路由稳定性指标。

### P2

- 增加策略家族轻量适配性预检。
- 增加术语表。
- 扩展更多纯价格 causal features。

## 暂不建议采纳清单

- 不建议建立全局统一的 `configs/decision_thresholds/`。
- 不建议把 review 里的具体数值阈值直接写成跨交易对硬标准。
- 不建议立即把订单簿、资金费率等新数据源写入当前标准输入。
- 不建议现在就把 AI 执行说明再拆成第四份主文档。

## 最终判断

如果只问“这些 review 是否有可采纳部分”，答案是：`有，而且不少`。

但更准确的判断是：

- 现有 `train` 方法论主框架不需要推翻。
- 最值得采纳的是那些能把当前体系从“研究解释正确”推进到“验证更严格、上线更可信”的建议。
- 最不应该采纳的是试图重新引入跨交易对统一阈值、统一规则常量的建议，因为这会削弱当前方法最核心的 symbol-specific 原则。

一句话总结：

**这批 review 最有价值的部分，不是改方向，而是补方法论到实战验证之间的最后一段桥。**
