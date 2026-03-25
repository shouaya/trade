# Methodology

## 目标

本项目在 `train` 里的目标，不是为所有交易对寻找一套通用参数，也不是产出一个可以直接复制到任何市场的固定策略。

目标是：

1. 为单一交易对生成自己的候选策略池。
2. 用该交易对自己的市场特征，学习“什么状态下该用什么策略、减仓还是停做”。
3. 输出一个交易对专属的分层决策系统，而不是一个通用策略参数。

一句话概括：

**通用的是训练方法，不通用的是每个交易对最终得到的 policy system。**

需要特别区分两件事：

- 方法论本身：描述应该怎样训练一个交易对专属 policy system。
- 当前仓库里的正式运行链路：只保留正式训练、验证、router 验证和必要的配套脚本。

也就是说，本文件描述的是“方法”；它不等于“仓库里应该长期保留多少研究脚本”。

## 核心原则

### 1. 单品种单独训练

每个交易对都必须单独训练、单独验证、单独生成 router。

原因：

- 不同交易对的波动率结构不同。
- 不同交易对的趋势持续性、反转速度、日内振幅不同。
- 同一组技术信号在不同交易对上的最优参数通常不同。

因此：

- BTCJPY 的最佳策略组合不应直接迁移到 ETHJPY、SOLJPY 或 USDJPY。
- 真正应该迁移的是流程和方法，而不是参数结果。

### 2. 先生成策略池，再做场景映射

系统不是先找一个 Top1 策略，然后希望它全天候适用。

系统的顺序应该是：

1. 定义一个策略家族。
2. 为这个家族生成参数网格。
3. 回测得到候选策略池。
4. 再根据市场特征，把这些策略分配到不同场景。

因此，策略池的意义是“动作库”，不是“冠军名单”。

但这里要特别补充一个更高优先级的目标态约束：

- 策略池不应长期停留在“固定参数网格，每个月重新全量回测排序”的形态。
- 更理想的形式是：策略池、参数集、特征映射都随着时间推进持续增长和修正。
- 也就是说，系统的长期目标不是“每个月重新从同一批 512 个参数中挑冠军”，而是“把历史上出现过的市场特征和当时验证后的最佳策略组合沉淀为知识库”。

因此，正式目标态应该是：

1. 历史窗口先积累特征样本。
2. 每个样本绑定当时验证后的最优策略/参数组合。
3. 后续遇到相似特征时优先复用已有策略池，而不是再次全量暴力扫描。
4. 只有当当前特征与历史库无法可靠匹配时，才进入保守模式或探索模式。

一句话说：

**策略池应该是“随着滚动学习不断成长的记忆库”，而不是“固定网格的重复月度排名器”。**

### 3. 周级定基调，日级做修正

当前方法默认使用分层路由：

1. `monthly_guard`
2. `weekly_guard`
3. `daily_router`
4. `loss_recheck`

含义是：

- 月级负责定义大环境边界。
- 周级负责定义当周基础策略和风险上限。
- 日级负责在周级基础上做切换、减仓或停做。
- 连续亏损或失败结构出现后，再触发额外保护。

### 4. 验证优先于训练内表现

训练内收益高，不代表系统可用。

一个可用的交易对策略系统，必须满足：

- 在训练期能解释历史结构。
- 在未来期仍有正收益或至少有稳定防守能力。
- 相对默认策略、单策略 Top1、等权组合有清晰增益。

### 5. 特征记忆优先于重复暴力搜索

如果系统在每个月都重新对同一批大参数网格做全量回测，即使使用了 `history-only` 窗口，也仍然只是“避免未来泄漏后的事后筛选”，并不等于真正的持续学习。

目标态应当转向：

1. 把每个月、每周、每日乃至更细粒度窗口的市场状态编码成特征向量。
2. 把“该向量对应的最佳策略组合、风险动作、样本数、置信度”落库。
3. 在未来窗口先做特征检索，再决定是否复用已有策略池。
4. 对无法匹配的未知特征，默认采取保守做法，而不是盲目套用现有策略。
5. 在该未知特征窗口结束后，再把“新特征 + 最佳策略组合”回写进知识库。

因此：

- `历史回测` 的角色应逐步从“每月重新全量排名”转为“为知识库补充新样本”；
- `未来执行/验证` 的角色应逐步从“重新暴力选策略”转为“先检索、再套用、最后补学习”。

## 术语表

- `router`：把市场特征映射到策略、减仓或停做动作的规则系统。
- `policy catalog`：对 router 规则的结构化说明书，要求可读、可解释、可追溯。
- `weekly_guard`：定义当周基础策略和风险上限的周级层。
- `daily_router`：在周级基调上做日级切换、减仓、停做的日级层。
- `loss_recheck`：根据前一日失败反馈做二次保护的保护层。
- `oracle best-of-day`：假设每天都能事后选中当日最佳候选策略得到的理论上限基准。
- `feature bucket`：用来描述某类市场结构的粗粒度标签，不等于最终交易动作。
- `causal feature`：在真实决策时点可以观测到的特征，不依赖当天或当周结束后的未来信息。

## 当前实现框架

当前 BTCJPY 主链路是一个“基于特征的单品种自适应策略系统”。

它由 5 个模块组成。

### 1. 候选策略池生成

先定义单一策略家族和参数空间。

当前 BTCJPY 示例：

- 入场：`RSI + MACD`
- 风控：`ATR 止损 / ATR 止盈`
- 交易风格：高频短持仓
- 关键参数：
  - RSI period / oversold / overbought
  - MACD fast / slow / signal
  - ATR stop / take profit multiplier
  - `maxHoldMinutes`
  - lot / maxPositions / trading hours

相关配置：

- [2024_btcjpy_hf_rsi_macd_tp_atr.json](/Users/ts-changchang.zhuang/git/money/train/configs/training/2024_btcjpy_hf_rsi_macd_tp_atr.json)
- [2025_btcjpy_hf_rsi_macd_tp_atr.json](/Users/ts-changchang.zhuang/git/money/train/configs/training/2025_btcjpy_hf_rsi_macd_tp_atr.json)
- [2026_btcjpy_hf_rsi_macd_tp_atr.json](/Users/ts-changchang.zhuang/git/money/train/configs/training/2026_btcjpy_hf_rsi_macd_tp_atr.json)

训练结果统一写入：

- `backtest_results`

### 2. 市场特征提取

训练和验证时，系统会对月、周、日三个层级计算市场特征。

当前主特征包括：

- `returnPct`
- `absReturnPct`
- `realizedVolPct`
- `avgRangePct`
- `upMinuteRatio`

并进一步归类成 bucket，例如：

- `crash-trend`
- `strong-trend`
- `mixed-trend`
- `range-mid-vol`
- `range-low-vol`

这些 bucket 不是最终决策本身，而是决策的第一层标签。

### 3. 周级基础策略决策

周级路由负责回答两个问题：

1. 这周更接近哪一类市场结构？
2. 这周默认应该用哪类策略，风险上限是多少？

周级输出通常包括：

- 基础策略
- 风险上限 `riskCap`
- 特定极端周的停做或减仓

例如某些周更适合：

- reversal
- continuation
- range rotation
- guarded balance

### 4. 日级策略切换与防守

日级路由在周级基础上继续细化。

日级输出通常有三种：

1. `trade`
2. `reduce`
3. `stop`

也就是说，同一周里：

- 有的天应该切到更快的策略；
- 有的天应该切到更慢的策略；
- 有的天虽然本周整体可做，但单日根本没有 edge，应直接停做；
- 有的天仍可做，但必须减仓。

这是整个系统最关键的部分，因为真实市场里“同一周的每天并不属于同一结构”。

### 5. 亏损后的二次判断

除了月、周、日结构本身，还需要看失败反馈。

`loss_recheck` 的作用是：

- 当前一日出现明显失败结构时，不继续机械执行；
- 在连续亏损情况下，切换到更防守的行为；
- 必要时直接停做。

这一步的意义是防止“一个错误场景连续吃亏整周”。

## 当前训练与验证流程

### 第一步：训练候选池

对单一交易对在指定时间段内运行参数网格训练，得到完整候选结果集。

输出的是：

- 所有候选策略的回测结果
- 每个策略的交易明细
- 可用于后续日级/周级分析的数据基础

这一步在当前实现里仍然存在一个需要持续修正的风险：

- 如果候选池长期由固定参数网格主导，并在 rolling 中每月重复全量扫描，
- 那么系统虽然满足了 `history-only`，但仍然不满足“记忆式增长”的目标态。

因此，从方法论角度，候选池训练应被重新拆成两类：

1. `discovery`
   - 用于冷启动、样本不足、特征未匹配场景。
   - 可以运行较大的参数探索，目的是发现新的策略/参数组合。
2. `exploitation`
   - 用于已有特征已沉淀的常规窗口。
   - 优先从历史特征记忆中检索候选策略池，只对少量候选做验证和排序。

长期目标不是保留“每个月 512 全量回测”，而是逐步把大网格训练压缩到只在必要时触发。

### 第二步：构建特征 -> 策略映射

训练时不直接只取 Top1，而是：

1. 观察不同周、不同日的市场特征。
2. 比较这些场景下哪些策略赚钱最多。
3. 如果没有赚钱策略，则记录为“减仓或停做场景”。

这一步的产物就是 router 的规则集。

在目标态里，这一步还应该额外生成一类核心资产：

- `feature memory`
- `feature -> candidate pool`
- `feature -> best strategy / best parameter set`
- `feature -> risk action / confidence / sample count`

也就是说，router 规则只是可执行表达层；
真正的底层学习对象应当是“特征记忆库”。

### 第三步：生成 router 与 policy catalog

系统会把规则固化为：

- router config
- policy catalog

当前 BTCJPY 主产物：

- [BTCJPY_dual_year_router_v10_weekly_refined.json](/Users/ts-changchang.zhuang/git/money/train/configs/generated/regime-routing/BTCJPY_dual_year_router_v10_weekly_refined.json)
- [BTCJPY_dual_year_router_v10_weekly_refined.policy.json](/Users/ts-changchang.zhuang/git/money/train/configs/generated/regime-routing/BTCJPY_dual_year_router_v10_weekly_refined.policy.json)

### 第四步：rolling 验证

验证时必须把 router 和候选策略池一起放到未来区间重跑。

验证时至少要和以下基准比较：

- default strategy
- rank1 strategy
- topN equal weight
- oracle best-of-day

如果 router 不能在未来期优于这些基准，说明特征映射不稳定，必须继续修正。

但 rolling 验证的目标也需要修订：

- 不是为了证明“每个月重新从同一批固定候选中选出的 Top 策略是否赚钱”；
- 而是为了证明“随着时间推进，系统是否能越来越多地直接命中已有特征记忆，并稳定复用相应策略池”。

因此，未来更关键的验证指标应该包括：

1. 当前窗口能否匹配到历史特征记忆。
2. 匹配成功时，复用后的收益/回撤是否优于默认策略。
3. 未匹配时，保守动作是否有效避免大幅亏损。
4. 新特征回写后，后续类似窗口的处理是否更稳定。

## 现在真正产出的是什么

当前系统的最终产物不是单个策略，而是一个交易对专属的 policy system。

它至少包含：

1. 策略池
2. 周级基础策略映射
3. 日级切换/减仓/停做规则
4. 亏损反馈规则
5. 训练期回放结果
6. rolling 验证结果
7. 策略说明书

目标态下还应该明确增加：

8. 特征记忆库
9. 特征到候选池的映射表
10. 未匹配特征事件与后续回写记录

当前 BTCJPY 对应说明书：

- [BTCJPY_dual_year_v10_daily_policy_summary.md](/Users/ts-changchang.zhuang/git/money/train/reports/regime-routing-results/BTCJPY_dual_year_v10_daily_policy_summary.md)
- [BTCJPY_dual_year_v10_daily_policy_summary.json](/Users/ts-changchang.zhuang/git/money/train/reports/regime-routing-results/BTCJPY_dual_year_v10_daily_policy_summary.json)

执行手册：

- [PLAYBOOK.md](/Users/ts-changchang.zhuang/git/money/train/PLAYBOOK.md)

## 什么是可迁移的，什么不是

### 可迁移的部分

这些内容可以迁移到任何交易对：

- 单品种训练
- 候选池优先，而不是 Top1 优先
- 周级 base + 日级 overlay + loss recheck 的分层结构
- 用未来期做严格验证
- 用 `policy catalog` 和 summary 文档固化决策系统

### 不可直接迁移的部分

这些内容必须按交易对重新训练：

- 最优策略家族
- 参数空间
- 周级规则阈值
- 日级规则阈值
- 哪些场景该停做
- 哪些场景该减仓
- 哪些场景该切快策略或慢策略

因此：

**方法可以复用，参数和 policy 不能硬搬。**

## 如何迁移到新交易对

以后针对任意新交易对，建议固定使用下面这套流程。

### 1. 先做波动和结构分析

先回答：

- 该交易对在哪些年份、月份、周、日波动最大？
- 趋势日和震荡日占比如何？
- 是否存在明显事件驱动或跳变段？

目的不是先交易，而是先确定策略家族和参数空间。

### 2. 为该交易对定义自己的候选策略家族

例如：

- `RSI + MACD + ATR`
- breakout + ATR
- mean reversion + VWAP

不同交易对可以使用不同家族，不要求统一。

### 3. 生成候选池

对该家族做参数网格训练，得到该交易对专属候选池。

### 4. 先做周级映射

先识别：

- 哪些周结构下用哪类策略更合适；
- 哪些周应该整体降风险；
- 哪些极端周必须停做。

### 5. 再做日级映射

在周级基础上，继续细分：

- 哪些日型需要切换策略；
- 哪些日型需要减仓；
- 哪些日型即使整周可做，当天也必须停做。

### 6. 最后做 rolling 验证

训练完后必须用完全未来的数据集做验证。

如果未来期表现不稳定，就回到第 4、5 步继续细化，而不是强行上线。

## 评分标准建议

在后续新交易对训练时，建议评分权重遵循下面原则：

1. 最终盈利金额优先
2. 最大回撤第二优先
3. 胜率只作为辅助指标
4. 不能因为追求胜率而牺牲收益能力

也就是说，评分不应围绕“赢得多不多”，而应围绕：

- 是否真正赚钱
- 是否在未来还能赚钱
- 是否能控制回撤

## 当前方法的边界

当前这套系统已经适合做研究型训练与验证，但它还不等于最终实盘实现。

原因是：

- 当前很多特征是用整天、整周已完成后的 realized data 做解释和验证；
- 这适合发现规律；
- 但如果要上实盘，还需要再把这些特征改造成决策时点可观测的 causal features。

例如：

- 不是用“全天最终 realized vol”
- 而是用“到当前时刻为止的 rolling vol / rolling range / intraday state”

所以正式上线前，还需要再做一层：

- 研究型 router -> 实时可执行 router

除此之外，当前实现还有一个更重要的方法论边界：

- 当前系统已经从“未来泄漏式训练”切到了 `history-only rolling`；
- 但它还没有完全切到“特征记忆驱动”的学习模式。

具体表现为：

- 仍可能在每个月对同一批大参数网格做全量回测排序；
- 仍更像“每月重新挑冠军”，而不是“优先复用历史上已经验证过的特征-策略映射”；
- 特征信息虽然参与了 router 生成，但还没有成为系统最核心的持久化记忆资产。

因此，当前版本可以视为：

- 已经摆脱“未来期作弊”的旧方法；
- 但还没有达到“持续积累特征记忆、策略池逐步成长”的最终目标态。

后续架构演进方向应当是：

1. 把市场状态编码为更细粒度的特征向量，而不只是 bucket。
2. 把向量与最佳策略组合、风险动作、样本数、置信度一起落库。
3. 让 rolling 流程优先做“相似特征检索”，而不是“固定大网格重扫”。
4. 对未命中特征采取保守模式，并在窗口结束后完成回写学习。
5. 让策略池、参数集、映射关系都随着时间推进持续扩充。

## 研究特征到可执行特征的改造要求

如果目标从“研究解释”推进到“可执行验证”或“实盘前验证”，必须明确完成下面的改造。

下一阶段围绕 BTCJPY rolling 特征增强、候选池健康度、跨层一致性与规则生成升级的详细要求，见：

- [docs/rolling-feature-prd.md](/Users/ts-changchang.zhuang/git/money/docs/rolling-feature-prd.md)
- [docs/feature-memory-greenfield-prd.md](/Users/ts-changchang.zhuang/git/money/docs/feature-memory-greenfield-prd.md)

### 1. 先定义决策时点

任何特征都必须先回答：

- 月级是在月末后复盘使用，还是在下月开始前决定？
- 周级是在上周收盘后决定，还是在本周进行中调整？
- 日级是在开盘后前 N 分钟决定，还是盘中滚动更新？

如果决策时点没有定义，特征是否 causal 无法判断。

### 2. 用截至当前时刻可观测的数据替代整段 realized 数据

推荐替代方向：

- `realizedVolPct` -> rolling vol / session vol / opening vol
- `avgRangePct` -> current range / trailing range baseline
- `upMinuteRatio` -> directional persistence / intraday breadth proxy
- `returnPct` -> opening impulse / session-to-now return

这些替代项是方向，不是固定唯一公式。

### 3. 对 live 特征单独做前瞻性验证

必须验证：

- 用 T-1 或当前时点可见信息做出的判断，在 T 时段是否仍有效；
- 是否存在研究期表现好、但一旦去掉未来信息就失效的“马后炮特征”；
- 周级和日级使用的特征窗口是否与真实决策节奏一致。

### 4. 把研究版 router 与执行版 router 分开标记

建议至少区分：

- `research router`
- `causal validation router`

避免把仍依赖事后特征的研究规则误当成可执行规则。

## 最终定义

本项目 `train` 的正式方法论可以定义为：

**基于市场特征记忆的单品种自适应策略系统**

英文可以写成：

**Feature-Conditioned Symbol-Specific Strategy System**

其核心定义是：

1. 对每个交易对单独积累自己的市场特征记忆与候选策略库；
2. 用该交易对自己的周级、日级以及更细粒度特征学习策略映射；
3. 在未来窗口优先复用历史上已验证的特征 -> 策略池映射；
4. 对未知特征默认保守处理，并在事后把新样本写回知识库；
5. 输出该交易对专属的分层 policy system，而不是固定参数冠军；
6. 用未来数据验证系统是否随着时间推移变得更稳定，而不是只验证单月筛选表现。

## 面向 AI 的执行说明

这一节的目标是让 AI 或自动化流程在读取本文档后，能够明确知道下一步应该做什么、先做什么、如何判断是否成功，以及失败后如何回退。

### AI 的首要认知

AI 在本仓库中处理任意交易对时，必须先接受以下前提：

1. 不要把已有交易对的最终策略直接复制给新交易对。
2. 不要默认“Top1 策略 = 最终系统”。
3. 不要只看训练期收益，不看 rolling 验证。
4. 不要把某条单策略的胜率当作主要目标。
5. 最终产出必须是“交易对专属 router + policy catalog + 验证结果 + 说明书”。

### AI 必须回答的 7 个问题

在开始一个新交易对任务之前，AI 必须先明确回答以下问题：

1. 训练对象是谁？
   - 例如 `BTCJPY`、`ETHJPY`、`SOLJPY`、`USDJPY`
2. 可用数据区间是什么？
   - 起始日期、结束日期、是否覆盖训练期和未来验证期
3. 训练期和验证期如何切分？
   - 例如 `2024-01 -> 2025-12` 训练，`2026` 验证
4. 当前策略家族是什么？
   - 例如 `RSI + MACD + ATR`
5. 候选策略池是重新训练，还是已存在？
6. 当前目标是：
   - 生成候选池
   - 分析周级结构
   - 分析日级结构
   - 生成 router
   - rolling 验证
   - 文档化
7. 当前是否已经有可复用的 policy catalog？

如果这 7 个问题没有被回答完整，AI 不应该直接宣称“已经得到最终策略系统”。

## 标准输入

对任意新交易对，系统的标准输入包括 6 类。

### 1. 市场数据

至少要有：

- `symbol`
- `intervalType`
- `klines`
- 完整时间区间

最低要求：

- 训练期必须足够长，至少覆盖多个波动阶段；
- 验证期必须是训练期之后的未来区间；
- 数据粒度要和策略家族匹配，当前主链路默认是 `1min`。

### 2. 策略家族定义

必须明确：

- 入场逻辑
- 出场逻辑
- 风控逻辑
- 交易时段
- 参数空间

当前 BTCJPY 示例属于：

- `RSI + MACD`
- `ATR SL/TP`
- 高频短持仓

### 3. 训练配置

必须明确：

- 时间区间
- symbol
- 数据表逻辑分组
- 参数网格
- executor 配置
- regime router 路径

### 4. 验证配置

必须明确：

- 未来区间
- 验证候选策略集合
- 使用的 router

### 5. 决策特征集合

当前标准特征集合：

- `returnPct`
- `absReturnPct`
- `realizedVolPct`
- `avgRangePct`
- `upMinuteRatio`
- `featureBucket`

### 6. 评价指标

当前必须关注：

- `totalPnl`
- `maxDrawdown`
- `returnPct`
- `positiveDays / negativeDays`
- `tradedDays`
- 相对基准的增益

辅助指标：

- 胜率
- profit factor
- trade count
- avg hold minutes

### 7. 成本与摩擦假设

如果是高频或短持仓体系，正式报告不应只看无成本结果。

至少要明确：

- 是否启用手续费
- 是否启用滑点
- 滑点模型采用什么场景
- 结果是否对摩擦成本敏感

## 标准输出

一个完整的交易对训练任务，最终至少应产出以下 8 类文件或结果。

1. 训练配置
2. 验证配置
3. 候选策略池回测结果
4. router config
5. policy catalog
6. 训练期 router 验证报告
7. 未来期 router 验证报告
8. 面向人的说明文档

如果最终只有“某个最好策略名字”而没有上述产物，则任务未完成。

## 标准执行流程

以下流程是 AI 处理任意交易对时应遵循的默认顺序。

### 阶段 0：确认任务边界

目标：

- 确认交易对
- 确认训练区间
- 确认验证区间
- 确认是否沿用当前策略家族

动作：

1. 检查 `train/configs/training`
2. 检查 `train/configs/validation`
3. 检查 `train/reports`
4. 检查是否已有对应 symbol 的 router / report

通过条件：

- 训练对象和区间明确；
- 不会误把旧交易对的结果当成新交易对结果。

失败处理：

- 如果 symbol 不明确，先停止推导；
- 如果数据区间不完整，先补数据；
- 如果已有文件命名混乱，先统一命名再继续。

### 阶段 1：先做波动与结构诊断

目标：

- 认识该交易对的波动轮廓；
- 确定后续训练时要重点关注的阶段。

动作：

1. 分析年、月、周、日波动；
2. 标记高波动、低波动、趋势、震荡、事件跳变区间；
3. 统计哪些时间段损益最容易分化。

输出：

- 波动报告
- 周/月/日结构概览

判断标准：

- 是否能看出高波动段与低波动段明显不同；
- 是否能识别趋势段与震荡段；
- 是否能找出至少几个典型坏区间和典型好区间。

如果不能看出结构差异，说明：

- 特征不够；
- 或时间窗口切分不合适；
- 或策略家族不适配。

### 阶段 2：定义候选策略家族

目标：

- 明确本交易对要训练哪一类策略。

默认原则：

1. 同一轮训练尽量只使用一个主家族；
2. 不要把完全不同哲学的策略混在一个池子里；
3. 家族内部可以有快慢、强弱、风控差异。

当前推荐做法：

- 先用一个家族做出稳定 router；
- 再考虑是否扩到第二家族。

补充要求：

- 正式大规模网格训练前，建议先做小样本家族适配性预检；
- 用 3 到 5 组代表性参数快速观察高波、低波、趋势、震荡阶段是否至少存在可用样本；
- 如果一个家族在主要阶段持续整体失效，应先换家族，不要直接扩大网格。

输出：

- 参数空间
- 训练配置 JSON

判断标准：

- 参数空间要足够覆盖可能性；
- 但不能大到毫无约束，导致候选池里充满噪声。

### 阶段 3：训练候选池

目标：

- 为单一交易对在训练期内生成完整候选池。

动作：

1. 用训练配置跑参数网格；
2. 把所有策略结果写入 `backtest_results`；
3. 保留显式策略名和交易明细。

命令模板：

```bash
cd train
npm run train -- configs/training/<your_config>.json
```

输出：

- `backtest_results` 中的训练结果
- 训练期 TopN
- 交易明细 `trades`

判断标准：

- 候选池不能只有极少数策略；
- 也不能全部表现极差且无结构差异；
- 必须能在不同阶段观察到不同策略优劣变化。

失败信号：

- 所有策略都在所有阶段一起亏；
- TopN 之间几乎没有行为差异；
- 高波动与低波动阶段的优胜策略完全无差别。

这通常意味着：

- 策略家族太弱；
- 参数空间没覆盖到关键区域；
- 数据时段不合适；
- 交易时段设置不对。

### 阶段 4：构建周级策略映射

目标：

- 先建立“这周该默认怎么做”的 base policy。

动作：

1. 计算每周特征；
2. 把每周划入 bucket；
3. 比较该类周里哪些策略整体表现最好；
4. 对明显坏周决定：
   - 用别的策略
   - 减仓
   - 停做

产物：

- `weekly_guard` 规则

判断标准：

- 周级规则要解决“大方向错误”；
- 它不需要处理每一天；
- 它负责定义基调，不负责所有细节。

如果周级规则过多、过碎，说明：

- 日级本该处理的细节被提前塞到了周级；
- 需要回退并减少周级复杂度。

### 阶段 5：构建日级策略映射

目标：

- 在周级基调之上，解决“同一周内部不同天结构差异”。

动作：

1. 计算每天特征；
2. 找出训练期最赚钱和最亏钱的天；
3. 对这些天提取共同特征；
4. 判断当天应该：
   - 切换策略
   - 减仓
   - 停做
5. 把这些规则写入 `daily_router`

判断标准：

- 日级规则应优先处理“局部误伤日”；
- 不要一上来就做大量 stop；
- 不要把宽条件写成高优先级规则；
- 新规则必须能解释至少一个明确问题样本。

强约束：

每新增一条日级规则，AI 必须能回答：

1. 它要修的是哪几天？
2. 这些天当前 router 为什么错？
3. 新策略为什么更合适？
4. 这条规则有没有明显误伤训练期其它样本？

如果回答不了，说明规则还不该进 router。

新增证据门槛：

新规则原则上还应满足：

1. 至少覆盖多个同结构样本，或能同时解释训练期与未来期的同类坏样本；
2. 不只是改善单个日期；
3. 对总收益、回撤或负收益周数量至少有一项产生可见改善；
4. 不以显著增加误伤为代价。

### 阶段 6：加入亏损反馈保护

目标：

- 防止系统在错误场景连续亏损。

动作：

1. 识别连续亏损日；
2. 识别“前一日失败 + 当天继续硬做”的场景；
3. 对这些场景加入 `loss_recheck`。

判断标准：

- `loss_recheck` 应该是保护层，不应该成为主要决策层；
- 如果大量收益依赖 `loss_recheck`，说明日级和周级映射还不够好。

### 阶段 7：生成 router 与 policy catalog

目标：

- 把规则固化成稳定产物，让训练、验证、报告共用。

产物：

- router config
- policy catalog
- daily policy summary

当前 BTCJPY 示例：

- [BTCJPY_dual_year_router_v10_weekly_refined.json](/Users/ts-changchang.zhuang/git/money/train/configs/generated/regime-routing/BTCJPY_dual_year_router_v10_weekly_refined.json)
- [BTCJPY_dual_year_router_v10_weekly_refined.policy.json](/Users/ts-changchang.zhuang/git/money/train/configs/generated/regime-routing/BTCJPY_dual_year_router_v10_weekly_refined.policy.json)
- [BTCJPY_dual_year_v10_daily_policy_summary.md](/Users/ts-changchang.zhuang/git/money/train/reports/regime-routing-results/BTCJPY_dual_year_v10_daily_policy_summary.md)

判断标准：

- 所有规则都应该能在 policy catalog 里被解释；
- 不允许只有 router，没有说明书；
- 不允许只有说明书，没有可执行 router。

### 阶段 8：rolling 验证

目标：

- 检验 router 是否具备泛化能力。

动作：

1. 用未来区间重新跑候选池；
2. 用同一版 router 回放；
3. 与基准比较。

命令模板：

```bash
cd train
npm run validate -- configs/validation/<future_validation_config>.json
node dist/scripts/router-validate.js --validation configs/validation/<future_validation_config>.json --router configs/generated/regime-routing/<router>.json
```

或直接：

```bash
cd train
DB_HOST=127.0.0.1 node dist/scripts/router-validate.js \
  --validation configs/validation/<future_validation_config>.json \
  --router configs/generated/regime-routing/<router>.json
```

必须比较的基准：

- default strategy
- rank1 strategy
- topN equal weight
- oracle best-of-day

必看面板：

- [REPORT_SCORECARD.md](/Users/ts-changchang.zhuang/git/money/train/REPORT_SCORECARD.md)

通过条件：

- router 在未来期总收益为正，或至少显著优于默认策略；
- 回撤受控；
- 负收益周数量下降；
- 关键坏周有明确解释。

默认失败红线：

- 未来期 `totalPnl < 0`；
- 明显弱于 `default strategy`；
- 回撤显著恶化且没有明确收益补偿；
- 收益主要依赖极少数偶然周或偶然日；
- 大量坏周、坏日仍无法解释。

成本验证要求：

关键版本至少应补做以下成本场景中的一组以上：

- 仅手续费
- 手续费 + 默认滑点
- 手续费 + 压力滑点

如果一加摩擦成本就结构性转差，应优先反查候选池和交易频率，而不是继续堆规则。

失败条件：

- 训练期很好，未来期大幅转负；
- 未来期收益几乎完全来自极少数偶然天；
- 回撤比默认策略更差；
- 大量未来期坏天没有对应解释。

### 阶段 9：失败后的迭代顺序

如果 rolling 验证失败，必须按以下顺序排查。

先排查：

1. 候选池是否足够好
2. 周级 base 是否选错
3. 日级 overlay 是否太宽或太窄
4. 是否有坏日应该 stop 但没 stop
5. 是否有好日被 stop/reduce 误伤
6. `loss_recheck` 是否过强或过弱

不要直接做的事：

- 盲目扩大参数空间
- 无依据增加大量规则
- 因为某一天很赚钱就写一条特别窄的“记忆规则”

正确做法：

- 先找坏周；
- 再拆成坏日；
- 再看这些坏日是否属于同一结构；
- 只有能形成可复用日型时，才写成新规则。

强化验证：

对于已进入稳定迭代阶段的交易对，建议在主链路验证之外，再增加：

- rolling / walk-forward 验证
- 成本敏感度验证
- 路由稳定性验证

## 决策判断标准

下面是 AI 在分析时应优先使用的判断逻辑。

### 什么时候判断为“应切换策略”

满足以下任一组合时，可以考虑切换：

- 当前策略明显亏损，而同一日存在稳定正收益候选；
- 该日属于已知强特征子型，并且该子型在训练期已有稳定最优策略；
- 周级基础策略与当天结构明显不一致。

### 什么时候判断为“应减仓”

适合减仓而不是停做的场景：

- 当天仍有 edge，但方差很高；
- 同类天平均收益为正，但最差结果较差；
- 周级结构可做，但当日属于过渡态。

### 什么时候判断为“应停做”

适合停做的场景：

- 候选池在该类日型上几乎全部亏损；
- 当天结构对现有家族完全不友好；
- 即使最优候选也没有正收益；
- 这类日型在训练期和验证期都表现为系统性失败。

### 什么时候应新增规则

新增规则至少要满足：

1. 它修复了一个明确坏样本；
2. 它对应的最优策略不是偶然一天独有；
3. 它不会明显打坏训练期已有好样本；
4. 它在未来期也有解释力，或至少不造成新伤害。

### 什么时候应关注路由稳定性

即使总收益为正，也应额外检查以下迹象：

- 同一周内策略频繁切换；
- 同一周内 `trade/reduce/stop` 动作频繁来回切换；
- stop / reduce 天数异常多；
- `loss_recheck` 命中率过高。

如果这些现象明显增加，说明 router 可能在拟合噪声，而不是在学习稳定结构。

### 什么时候不应新增规则

不要新增规则的情况：

- 只修单个样本，但没有共同特征；
- 新规则只能解释训练期，无法解释未来期；
- 新规则条件过宽，明显会误伤别的阶段；
- 新规则本质是在记忆日期，而不是记忆结构。

## 评分与排序方法

### 训练期候选排序

训练时，候选排序不应只看胜率。

推荐优先级：

1. `totalPnl`
2. `maxDrawdown`
3. `returnPct`
4. `profitFactor`
5. `winRate`

原因：

- 胜率高但不赚钱的策略没有意义；
- 赚钱但回撤过大的策略也不能直接进入核心池；
- 最终要的是“可路由、可组合、可泛化”的候选。

### 路由系统评分

router 的最终评分应优先看：

1. 未来期总收益
2. 未来期最大回撤
3. 未来期负收益周数量
4. 相对默认策略的增益
5. 相对 TopN 等权的增益

并建议固定展示：

- stop / reduce / full-size days
- `loss_recheck` override days
- strategy switch count
- action switch count
- high-churn weeks

训练期结果主要用于解释和修正，不是最终上线依据。

## AI 执行 Checklist

下面是 AI 处理一个新交易对任务时应逐项核对的 checklist。

### 开始前

- 是否明确 symbol
- 是否明确训练期
- 是否明确验证期
- 是否确认数据可用
- 是否确认策略家族

### 训练后

- 是否生成候选池
- 是否保留 TopN 和交易明细
- 是否观察到不同阶段优胜策略差异

### 周级分析后

- 是否已经识别出主要周结构
- 是否给每类主要周结构分配了基础策略
- 是否已识别出必须 stop / reduce 的极端周

### 日级分析后

- 是否已经识别主要误伤日
- 是否明确哪些日型应该切换策略
- 是否明确哪些日型应该减仓
- 是否明确哪些日型应该停做

### 验证后

- 是否优于 default strategy
- 是否优于 rank1 strategy
- 是否优于 topN equal weight
- 是否能解释主要坏周和坏日
- 是否已生成 policy catalog 和说明书

### 结束前

- 是否产出了 router
- 是否产出了 policy catalog
- 是否产出了训练期报告
- 是否产出了未来期报告
- 是否产出了方法或说明文档

## 面向未来的扩展方向

当前方法已适合研究型训练系统，但后续还可以扩展为更完整的实盘框架：

1. 用滚动窗口替代静态年度切分；
2. 把整日/整周 realized 特征改造成在线可观测特征；
3. 引入交易成本敏感度分析；
4. 引入更严格的 OOS walk-forward；
5. 增加路由稳定性与 churn 指标；
6. 为不同交易对建立统一命名规范和自动化生成脚本；
7. 把 router、policy catalog、summary 生成流程完全模板化。

## 结论

AI 在本仓库中不应把“策略”视为可通用产物。

AI 应把每个交易对的最终目标定义为：

**为该交易对建立一个可验证、可解释、可迭代的特征驱动型策略系统。**

真正应该跨交易对复用的是：

- 流程
- 判断方式
- 验证标准
- 文档化方式

而不是：

- 某个固定参数
- 某个单独策略名字
- 某个旧交易对的 router 直接复制
