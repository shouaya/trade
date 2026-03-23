# Task Template

## 目的

本文档提供给 AI 或研究员直接复制使用的任务模板。

如果：

- [METHODOLOGY.md](/Users/ts-changchang.zhuang/git/money/train/METHODOLOGY.md) 说明的是方法论；
- [PLAYBOOK.md](/Users/ts-changchang.zhuang/git/money/train/PLAYBOOK.md) 说明的是执行流程；

那么本文档说明的是：

**实际发起任务时，应该如何向 AI 描述任务。**

结果评估建议同时参考：

- [REPORT_SCORECARD.md](/Users/ts-changchang.zhuang/git/money/train/REPORT_SCORECARD.md)

目标是让后续每次开新交易对、新训练周期或 router 迭代时，都尽量使用统一模板，而不是临时组织 prompt。

## 使用原则

### 1. 不要只给目标，不给边界

坏例子：

```text
帮我训练 ETHJPY
```

好例子：

```text
请对 ETHJPY 做单品种策略系统训练。
训练期使用 2024-01-01 到 2025-12-31。
验证期使用 2026-01-01 到 2026-12-31。
沿用当前 RSI+MACD+ATR 高频家族。
目标不是找 Top1，而是生成候选池、周级/日级 router、policy catalog 和验证报告。
```

### 2. 不要把“策略参数”当作最终目标

任务描述里应明确要求：

- 产出 router
- 产出 policy catalog
- 产出训练/验证报告
- 产出说明文档

### 3. 必须要求未来期验证

如果任务没有明确未来期验证，AI 很容易只停留在训练内优化。

### 4. 必须要求保留结构分析

如果只要求“收益最大化”，AI 容易跳过“为什么该场景适合该策略”的解释层。

## 模板 1：新交易对从 0 到 1

下面模板适用于：

- 第一次为某个交易对建立策略系统
- 还没有对应 router 和 policy catalog

### 可直接复制模板

```text
请在 train 目录下，为 <SYMBOL> 建立一套单品种自适应策略系统。

要求：
1. 目标不是寻找通用策略，也不是只找单个 Top1 参数。
2. 目标是生成该交易对自己的候选策略池、周级/日级策略映射、router、policy catalog、训练报告、验证报告和总结文档。
3. 必须遵循 train/METHODOLOGY.md 和 train/PLAYBOOK.md。

时间范围：
1. 训练期：<TRAIN_START> 到 <TRAIN_END>
2. 验证期：<VALIDATE_START> 到 <VALIDATE_END>

策略家族：
1. 默认沿用 <STRATEGY_FAMILY>
2. 如果你判断该家族明显不适合该交易对，可以先说明原因，再替换为更合适的单一家族。

执行要求：
1. 先检查数据是否完整覆盖训练期和验证期。
2. 先做波动率和市场结构分析，再开始训练。
3. 训练时先生成候选池，不要直接只取 Top1。
4. 先做周级基础策略映射，再做日级切换/减仓/停做映射。
5. 如有必要，再增加 loss_recheck 保护层。
6. 必须把 router 和 policy catalog 固化成文件。
7. 必须用未来期做验证，并与 default strategy、rank1 strategy、topN equal weight、oracle best-of-day 比较。
8. 必须输出统一 scorecard，至少包含 totalPnl、maxDrawdown、profitFactor、positive/negative days、positive/negative weeks、相对基准增益。
9. 对高频短持仓体系，必须补做至少一轮成本敏感度验证（手续费或手续费+滑点）。
10. 最终要输出一份总结，说明哪些方法是通用的，哪些策略/参数是该交易对专属的。

产出要求：
1. 训练配置文件
2. 验证配置文件
3. router config
4. policy catalog
5. 训练期回放报告
6. 验证期回放报告
7. 日特征 -> 策略说明书

过程要求：
1. 不要只给计划，要尽量直接执行。
2. 每次增加规则时，要说明修复了哪些坏周/坏日。
3. 如果未来期验证不通过，不要停在失败结论，要继续定位坏周/坏日并修正。
4. 对进入稳定阶段的交易对，可追加 rolling / walk-forward 作为强化验证。
```

### 占位符说明

- `<SYMBOL>`：如 `ETHJPY`
- `<TRAIN_START>`：如 `2024-01-01`
- `<TRAIN_END>`：如 `2025-12-31`
- `<VALIDATE_START>`：如 `2026-01-01`
- `<VALIDATE_END>`：如 `2026-12-31`
- `<STRATEGY_FAMILY>`：如 `RSI + MACD + ATR 高频短持仓`

## 模板 2：既有交易对 router 迭代

下面模板适用于：

- 已经有候选池和 router
- 目标是继续修正坏周、坏日

### 可直接复制模板

```text
请继续迭代 <SYMBOL> 的现有 router。

要求：
1. 读取当前最新 router、policy catalog、训练报告和验证报告。
2. 重点分析未来期验证中的最差周和最差日。
3. 不要直接扩大参数空间，优先判断问题属于：
   - 周级基础策略选错
   - 日级切换不够细
   - 应减仓未减仓
   - 应停做未停做
   - stop/reduce 误伤了本来可赚钱的日型
4. 新规则必须能解释明确坏样本，不要写记忆日期规则。
5. 每次改动后都要重新跑训练期和验证期。
6. 如果训练期改善但验证期恶化，不接受该版本。
7. 新规则应尽量覆盖多个同结构样本，不接受只修单个日期的记忆规则。
8. 最终输出必须包含统一 scorecard，并说明是否触发默认失败红线。

目标：
1. 优先提升未来期总收益。
2. 优先降低未来期最大回撤。
3. 优先减少负收益周数量。
4. 在不明显破坏训练期结构的前提下优化。

最终产出：
1. 更新后的 router
2. 更新后的 policy catalog
3. 更新后的训练报告
4. 更新后的验证报告
5. 一份简短总结，说明本轮新增规则修复了哪些具体坏周/坏日。
```

## 模板 3：先做结构分析，不直接训练

适用于：

- 用户还不确定该交易对该用什么策略家族
- 需要先做诊断

### 可直接复制模板

```text
请先不要直接训练。

先对 <SYMBOL> 在 <START> 到 <END> 的市场结构做诊断分析。

要求：
1. 分析年、月、周、日的波动率分布。
2. 找出波动最大、最小的时间段。
3. 判断该交易对更偏趋势、震荡还是混合结构。
4. 找出最典型的高波动趋势段、低波动段、假突破段、崩跌反弹段。
5. 最后给出建议：
   - 更适合哪类策略家族
   - 参数空间应偏快还是偏慢
   - 后续训练应优先按月、按周还是按日展开

产出：
1. 分析报告
2. 对后续训练方式的建议
```

## 模板 4：把已有系统迁移到新交易对

适用于：

- 想沿用 BTCJPY 的方法，但不沿用 BTCJPY 的参数结果

### 可直接复制模板

```text
请把 BTCJPY 当前的训练方法迁移到 <SYMBOL>，但不要复用 BTCJPY 的最终策略结果。

要求：
1. 可以复用方法、流程、文件组织方式和分层路由结构。
2. 不可以直接复用 BTCJPY 的最终参数、规则阈值和策略结论。
3. 必须对 <SYMBOL> 单独生成候选池。
4. 必须对 <SYMBOL> 单独建立周级/日级映射。
5. 必须对 <SYMBOL> 单独做未来期验证。

最终目标：
1. 产出 <SYMBOL> 自己的 router
2. 产出 <SYMBOL> 自己的 policy catalog
3. 产出 <SYMBOL> 自己的验证报告
4. 说明 BTCJPY 的哪些经验被复用，哪些结论没有被复用
```

## 模板 5：只做未来期复验

适用于：

- 候选池和 router 已有
- 只需要重跑验证

### 可直接复制模板

```text
请不要改训练方法，先只对 <SYMBOL> 当前最新 router 做未来期复验。

要求：
1. 使用当前最新 router。
2. 使用当前未来区间验证池。
3. 输出 totalPnl、maxDrawdown、positiveDays、negativeDays、tradedDays。
4. 与 default strategy、rank1 strategy、topN equal weight、oracle best-of-day 比较。
5. 列出最差的周和最差的日。
6. 给出是否触发默认失败红线。
7. 输出统一 scorecard。
8. 给出是否需要继续迭代的判断。
```

## AI 任务描述中的强制关键词

为了降低 AI 跑偏概率，建议在任务描述中尽量包含这些关键词：

- `单品种`
- `候选策略池`
- `周级`
- `日级`
- `router`
- `policy catalog`
- `未来期验证`
- `不要只找Top1`
- `不要把策略作为通用产物`

## AI 任务描述中的禁忌表达

以下表达容易让 AI 跑偏，尽量避免：

- “找一个最好的策略”
- “直接给我最终参数”
- “通用到所有交易对”
- “不需要验证”
- “只看训练结果”

## 推荐的任务结构

任何正式任务描述，都建议用下面这个结构：

1. 任务目标
2. symbol
3. 训练期
4. 验证期
5. 策略家族
6. 执行要求
7. 产出要求
8. 约束条件

## 最小任务模板

如果只想给 AI 最短但仍不容易跑偏的指令，可以使用：

```text
请针对 <SYMBOL> 做单品种自适应策略系统训练。
训练期用 <TRAIN_RANGE>，验证期用 <VALIDATE_RANGE>。
目标不是找 Top1，而是生成候选池、周级/日级 router、policy catalog 和验证报告。
请遵循 train/METHODOLOGY.md、train/PLAYBOOK.md 与 train/REPORT_SCORECARD.md，先做结构分析，再训练，再生成 router，最后做未来期验证和 scorecard 汇总。
```

## 与其他文档的关系

- [METHODOLOGY.md](/Users/ts-changchang.zhuang/git/money/train/METHODOLOGY.md)：解释为什么这样做
- [PLAYBOOK.md](/Users/ts-changchang.zhuang/git/money/train/PLAYBOOK.md)：解释具体流程怎么做
- `TASK_TEMPLATE.md`：提供可直接复制使用的任务模板
