# Playbook

## 目的

本文档是 `train/METHODOLOGY.md` 的执行版补充。

如果 `METHODOLOGY.md` 负责说明“为什么这样做”，那么本文档负责说明“接下来具体怎么做”。

目标是让 AI、研究员或工程师在面对一个新的交易对时，能够按照固定顺序完成：

1. 数据确认
2. 波动诊断
3. 策略池训练
4. 周级/日级映射
5. router 生成
6. 未来期验证
7. 文档固化

结果评估建议同时参考：

- [REPORT_SCORECARD.md](/Users/ts-changchang.zhuang/git/money/train/REPORT_SCORECARD.md)

## 使用范围

适用于：

- 新交易对第一次建立策略系统
- 既有交易对重新训练
- 对现有 router 做迭代修正

不适用于：

- 直接上线实盘执行
- 高频实时特征在线推断
- 完全不同的执行引擎改造

## 开始前必须确认的事项

在开始任何训练任务前，必须先确认下面这些内容。

### A. 任务边界

必须明确：

- `symbol`
- 数据区间
- 训练期
- 验证期
- 是否沿用当前策略家族
- 当前任务目标

任务目标必须属于以下之一：

1. 新建候选池
2. 做波动分析
3. 做周级映射
4. 做日级映射
5. 生成 router
6. 路由验证
7. 整理文档

如果目标不明确，不要直接开始训练。

### B. 数据是否可用

必须确认：

- `klines` 里有该 symbol 的数据
- 数据粒度满足当前训练逻辑，默认 `1min`
- 训练期和验证期都覆盖到

最小检查项：

- 是否能查询到训练期的首尾时间
- 是否能查询到验证期的首尾时间
- 是否存在明显缺口

### C. 当前仓库内是否已有同 symbol 结果

开始新任务前必须先检查：

- `train/configs/training`
- `train/configs/validation`
- `train/configs/generated/regime-routing`
- `train/reports`

目的：

- 避免覆盖已有结果
- 避免复用过期 router
- 避免误把别的交易对产物当作当前交易对产物

## 标准目录落点

每个新交易对的结果都应该落到以下目录中。

### 配置

- `train/configs/training/`
- `train/configs/validation/`
- `train/configs/top-strategies/`
- `train/configs/generated/regime-routing/`

### 报告

- `train/reports/volatility/`
- `train/reports/regime-routing-results/`
- 其他分析脚本对应目录

### 脚本

- 新分析脚本放在 `train/scripts/`
- 能复用的逻辑优先抽到 `train/scripts/lib/` 或 `src/services/`

## 命名规范

为了便于 AI 自动识别，建议统一使用以下命名模式。

### 训练配置

```text
configs/training/<year>_<symbol_lower>_<family>.json
```

示例：

```text
configs/training/2025_btcjpy_hf_rsi_macd_tp_atr.json
```

### 验证配置

```text
configs/validation/<train_year>_<symbol_lower>_<family>_<source>_<target>_validation.json
```

示例：

```text
configs/validation/2025_btcjpy_v7_hf_rsi_macd_top10_exact_from_2025_2026_validation.json
```

### Router

```text
configs/generated/regime-routing/<SYMBOL>_<router_name>.json
```

示例：

```text
configs/generated/regime-routing/BTCJPY_dual_year_router_v10_weekly_refined.json
```

### Policy Catalog

```text
configs/generated/regime-routing/<SYMBOL>_<router_name>.policy.json
```

### 总结报告

```text
reports/regime-routing-results/<SYMBOL>_<router_name>_<period>.json
reports/regime-routing-results/<SYMBOL>_<router_name>_<period>.md
```

## 新交易对从 0 到 1 的标准流程

下面是推荐给 AI 的固定执行顺序。

---

## 阶段 1：确认数据与时间切分

### 目标

明确训练与验证边界。

### 推荐默认切法

如果数据足够长，优先用：

- 训练期：至少 1 到 2 年
- 验证期：训练期之后的完整未来区间

示例：

- 训练：`2024-01-01 -> 2025-12-31`
- 验证：`2026-01-01 -> 2026-12-31`

如果未来期不完整，也可以先用部分未来期验证，但必须在报告中明确写出截止日期。

### 阶段输出

- 明确的训练期
- 明确的验证期
- 明确的 symbol

### 通过条件

- 训练期与验证期不重叠
- 验证期在训练期之后

---

## 阶段 2：先做波动与结构分析

### 目标

在训练前先了解交易对行为。

### 要做的事

1. 统计年、月、周、日波动率
2. 找出：
   - 波动最大时段
   - 波动最小时段
   - 趋势主导时段
   - 震荡主导时段
3. 初步判断该交易对更偏：
   - 趋势跟随
   - 均值回归
   - 混合结构

### 需要回答的问题

- 高波动是否意味着趋势增强，还是噪声增强？
- 低波动是否完全不可做，还是只是需要更慢策略？
- 是否存在明显事件段？

### 阶段输出

- 波动分析报告
- 初步结构判断

### 失败信号

- 所有阶段看起来都一样
- 无法区分趋势和震荡
- 无法定位明显坏时段

如果出现这些情况，说明特征抽取不足，不能直接进入 router 阶段。

---

## 阶段 3：定义策略家族与参数空间

### 目标

建立候选池的来源。

### 操作原则

优先使用一个主策略家族，不要同时混入太多不同哲学。

当前主链路示例：

- `RSI + MACD`
- `ATR SL/TP`
- 高频短持仓

### 家族适配性预检

在正式大规模网格训练前，建议先用 3 到 5 组代表性参数做快速预检。

预检主要回答：

- 这个家族是否至少在部分阶段存在可盈利样本；
- 高波与低波阶段是否能出现差异化行为；
- 是否从一开始就在所有主要阶段持续整体失效。

如果代表性参数全部持续失效，不要急着扩大参数空间，优先更换家族。

### 参数空间设计原则

1. 要覆盖快慢两类节奏
2. 要覆盖不同风控力度
3. 要覆盖不同持仓长度
4. 不要大到不可解释

### 必填参数类别

- 入场参数
- 出场参数
- 风控参数
- 交易时段参数

### 阶段输出

- 训练配置 JSON

### 通过条件

- 参数空间足够形成差异化候选
- 训练后不会只得到一堆几乎相同的策略

---

## 阶段 4：训练候选池

### 目标

生成该交易对专属候选池。

### 命令模板

```bash
cd train
npm run train -- configs/training/<training_config>.json
```

### 训练后必须检查

1. 是否所有候选都跑完
2. 是否写入 `backtest_results`
3. 是否有交易明细进入 `trades`
4. TopN 是否存在明显差异

### 候选池通过标准

- 不同策略在不同阶段表现有差异
- 至少能观察到快策略/慢策略在不同环境下的优劣变化
- 候选池里不是只有一个方向有效

### 候选池失败标准

- 全部策略整体都亏
- 所有策略表现过于接近
- Top1 到 Top20 的行为几乎完全一样

如果失败：

- 先回到参数空间设计
- 不要急着做周级/日级映射

---

## 阶段 5：构建周级基础策略

### 目标

先回答“这一周默认该怎么做”。

### 周级分析步骤

1. 计算周特征
2. 做 bucket 分类
3. 汇总每类周的最优策略
4. 对明显坏周决定：
   - `trade`
   - `reduce`
   - `stop`

### 周级规则设计原则

1. 周级只负责基调
2. 周级不要过度细碎
3. 周级不应记忆具体日期
4. 周级规则应覆盖一类结构，而不是单一事件

### 阶段输出

- `weekly_guard` 规则

### 通过条件

- 大方向错误显著减少
- 训练期主要坏周得到解释

### 失败信号

- 规则越写越多但收益没改善
- 规则只修了单周，却破坏更多周

如果失败，应减少周级复杂度，把问题下放到日级。

---

## 阶段 6：构建日级 overlay

### 目标

解决同一周内部的结构差异。

### 日级分析步骤

1. 找出训练期最差周
2. 把最差周拆成日
3. 找出真正的误伤日和真正的无 edge 日
4. 比较当日所有候选策略
5. 判断应当：
   - 切策略
   - 减仓
   - 停做

### 日级规则设计原则

1. 先修明显误伤日
2. 每条规则必须有明确样本来源
3. 新规则必须能说明为什么当前策略错
4. 条件从窄到宽，先窄后宽
5. 宽 stop 规则要极其谨慎
6. 规则应尽量覆盖多个同结构样本
7. 如果未来期明显恶化，不应入库

### AI 必须写下的说明

每新增一条日级规则时，必须同时记录：

- 修复哪几个日期
- 这些日期的共同特征是什么
- 新选策略是谁
- 旧策略为什么错
- 是否在训练期其它日期造成新误伤

### 阶段输出

- `daily_router` 规则

### 通过条件

- 训练期坏周内部的坏日得到解释
- 新规则不会显著打坏已有好日

---

## 阶段 7：加入 loss recheck

### 目标

防止错误结构连续亏损。

### 适用场景

- 前一日 routed PnL 明显为负
- 连续亏损
- 某类失败模式重复出现

### 原则

- 它是保护层，不是主要 alpha 来源
- 如果系统大量依赖 loss recheck，说明周/日映射还不成熟

### 阶段输出

- `loss_recheck` 规则

---

## 阶段 8：生成 router / policy catalog / summary

### 目标

把整个系统固化成标准产物。

### 标准产物

1. router config
2. policy catalog
3. daily policy summary

### 当前 BTCJPY 示例

- [BTCJPY_dual_year_router_v10_weekly_refined.json](/Users/ts-changchang.zhuang/git/money/train/configs/generated/regime-routing/BTCJPY_dual_year_router_v10_weekly_refined.json)
- [BTCJPY_dual_year_router_v10_weekly_refined.policy.json](/Users/ts-changchang.zhuang/git/money/train/configs/generated/regime-routing/BTCJPY_dual_year_router_v10_weekly_refined.policy.json)
- [BTCJPY_dual_year_v10_daily_policy_summary.md](/Users/ts-changchang.zhuang/git/money/train/reports/regime-routing-results/BTCJPY_dual_year_v10_daily_policy_summary.md)

### 通过条件

- 规则可执行
- 规则可解释
- 报告与 router 一致

---

## 阶段 9：未来期验证

### 目标

检验系统是否泛化。

### 推荐流程

1. 用未来区间跑显式策略池
2. 用相同 router 回放
3. 与多个基准比较
4. 生成统一 scorecard
5. 对关键版本补做成本敏感度验证

### 推荐命令模板

训练未来候选池：

```bash
cd train
npm run validate -- configs/validation/<validation_config>.json
```

router 回放：

```bash
cd train
DB_HOST=127.0.0.1 node dist/scripts/router-validate.js \
  --validation configs/generated/daily-overlays/<overlay_pool>.json \
  --router configs/generated/regime-routing/<router>.json
```

如果自动批次识别失败，可以显式给：

```bash
--tradeCreatedAt 'YYYY-MM-DD HH:MM:SS'
```

### 必须比较的基准

- `defaultStrategy`
- `rank1Strategy`
- `top10EqualWeight`
- `oracleBestOfDay`

### 必须输出的 scorecard 项

至少包括：

- `totalPnl`
- `returnPct`
- `maxDrawdown`
- `profitFactor`
- `tradeCount`
- `positiveDays / negativeDays`
- `positiveWeeks / negativeWeeks`
- 相对 `default / rank1 / top10 / oracle` 的增益
- stop / reduce / full-size / `loss_recheck`
- strategy churn / action churn

### 未来期通过标准

- 总收益为正，或明显优于默认策略
- 最大回撤可接受
- 主要坏周数量下降
- 坏日可解释

### 默认失败红线

- 未来期总收益为负
- 明显弱于 `defaultStrategy`
- 回撤显著恶化且没有收益补偿
- 收益主要来自极少数偶然日或偶然周
- 大量新增规则只能解释训练期，不能解释未来期

### 成本敏感度检查

高频短持仓体系建议至少再补跑：

- 基础手续费
- 手续费 + 默认滑点
- 手续费 + 压力滑点

如果成本一加上去就显著失真，优先回查：

- 交易频率是否过高
- 候选池是否太依赖薄 edge
- router 是否用过多切换来堆理论收益

### 未来期失败后如何处理

按以下顺序回退：

1. 先查最差周
2. 再拆成最差日
3. 判断是：
   - 候选池不够
   - 周级基础选错
   - 日级规则误伤
   - 应停做却未停做
4. 只在有结构共性的情况下新增规则

### 强化验证轨道

当交易对已经进入稳定迭代阶段时，建议在主链路之外追加：

- rolling / walk-forward 验证
- 成本敏感度验证
- 路由稳定性验证

## 产出物检查表

每个交易对任务完成时，应至少存在：

- 训练配置
- 验证配置
- router config
- policy catalog
- 训练期报告
- 未来期报告
- daily policy summary
- 方法或执行文档引用

## AI 不应做的事

1. 不应直接复用别的交易对最终参数
2. 不应把单个 Top1 当成最终系统
3. 不应只看训练期不看未来期
4. 不应因为单日表现好就写“记忆日期规则”
5. 不应在没有共同结构的情况下无限增加规则
6. 不应因为少量亏损周就直接整周停做，除非全候选池确实无 edge

## AI 应优先做的事

1. 先看结构，再看收益
2. 先看坏周，再拆坏日
3. 先看候选池是否足够，再写规则
4. 先修系统性误伤，再修个别极端日
5. 先让未来期稳定，再追求训练期更高收益
6. 先确认成本下是否仍成立，再讨论上线价值

## 标准任务模板

下面是一份 AI 可以直接照抄执行的任务模板。

### 模板：新交易对策略系统建立

1. 确认 symbol、训练期、验证期。
2. 检查 `klines` 是否覆盖全部时段。
3. 做波动和结构分析，输出报告。
4. 选择一个主策略家族。
5. 编写训练配置。
6. 跑训练，生成候选池。
7. 观察 TopN 与交易明细。
8. 先构建周级规则。
9. 再构建日级规则。
10. 必要时加入 `loss_recheck`。
11. 生成 router / policy catalog / summary。
12. 跑未来期验证。
13. 与 default / rank1 / topN / oracle 比较。
14. 记录坏周、坏日、修正原因。
15. 迭代直到未来期表现稳定。

### 模板：既有交易对 router 迭代

1. 读取当前 router 与 policy catalog。
2. 跑最新训练期 / 验证期回放。
3. 找出最差周。
4. 找出这些周里的最差日。
5. 比较当日所有候选策略收益。
6. 判断是切策略、减仓还是停做。
7. 写入新规则。
8. 重跑训练期，确认无明显误伤。
9. 重跑未来期，确认泛化改善。
10. 更新 policy catalog 和 summary。

## 与 METHODOLOGY 的关系

- [METHODOLOGY.md](/Users/ts-changchang.zhuang/git/money/train/METHODOLOGY.md) 负责方法论
- `PLAYBOOK.md` 负责执行步骤

推荐做法：

1. 先读 `METHODOLOGY.md`
2. 再按 `PLAYBOOK.md` 执行
