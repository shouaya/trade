# Report Scorecard

## 目的

本文档定义 `train` 体系中每次正式训练、router 迭代、未来期复验时，建议统一展示的结果面板。

目标不是替代：

- [METHODOLOGY.md](/Users/ts-changchang.zhuang/git/money/train/METHODOLOGY.md)
- [PLAYBOOK.md](/Users/ts-changchang.zhuang/git/money/train/PLAYBOOK.md)

而是补充一个固定问题：

**这次结果到底够不够硬，是否值得继续推进。**

## Scorecard 核心原则

### 1. 训练期与未来期要并排看

不能只给训练期，也不能只给未来期单一数字。

至少要并排展示：

- 训练期
- 未来期
- 相对基准增益

### 2. 先看收益与回撤，再看胜率

建议优先级：

1. `totalPnl`
2. `maxDrawdown`
3. `negativeWeeks`
4. 相对基准增益
5. `profitFactor`
6. `winRate`

### 3. 高频体系必须看交易摩擦

如果是高频短持仓，不允许只报“无成本结果”。

至少要展示：

- 无成本
- 基础手续费
- 手续费 + 基础滑点
- 手续费 + 极端滑点

### 4. 路由系统必须看稳定性

除了收益，还要看：

- stop / reduce 占比是否异常
- `loss_recheck` 是否过度救火
- 同周内是否频繁切换策略或 action

## 必填指标

每次正式报告至少应包含以下字段。

### A. 总览指标

- `totalPnl`
- `returnPct`
- `maxDrawdown`
- `maxDrawdownPct`
- `profitFactor`
- `tradeCount`
- `positiveDays`
- `negativeDays`
- `tradedDays`
- `positiveWeeks`
- `negativeWeeks`

### B. 基准对比

必须对比：

- `defaultStrategy`
- `rank1Strategy`
- `top10EqualWeight`
- `oracleBestOfDay`

至少要给出：

- 本策略 / router 与各基准的 `PnL delta`
- 本策略 / router 与各基准的 `drawdown delta`

### C. 路由行为指标

适用于 router 级报告：

- stop days
- reduce days
- full-size days
- `loss_recheck` override days
- strategy switch count
- action switch count
- high-churn weeks

### D. 规则证据指标

适用于 policy summary：

- rule id
- layer
- action
- train hits
- train pnl
- validate hits
- validate pnl
- 是否存在明显误伤

## 默认红线

以下是建议默认使用的失败红线。

命中任意一条时，应默认视为失败版本，除非报告明确说明这是防守型实验或特定对照实验。

- 未来期 `totalPnl < 0`
- 明显弱于 `defaultStrategy`
- 回撤显著恶化且没有明确收益补偿
- 收益主要依赖极少数偶然周或偶然日
- 大量新增规则只能解释训练期，不能解释未来期

## 建议展示顺序

### 1. Summary

- 训练期总览
- 未来期总览
- 是否触发红线

### 2. Benchmark Comparison

- 与 `default/rank1/top10/oracle` 的对比表

### 3. Routing Mix

- stop / reduce / full-size / `loss_recheck`

### 4. Stability

- strategy switches
- action switches
- high-churn weeks

### 5. Cost Sensitivity

- 四组成本场景结果

### 6. Failure Diagnosis

- 最差周
- 最差日
- 当前版本仍未解释的坏样本

## 成本敏感度模板

建议固定为下表。

| Scenario | Fees | Slippage | Total PnL | Max DD | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| No Cost | off | off | - | - | 理论上限 |
| Base Fee | on | off | - | - | 仅手续费 |
| Fee + Base Slippage | on | base | - | - | 默认实盘近似 |
| Fee + Extreme Slippage | on | stress | - | - | 压力测试 |

## 稳定性检查问题

每次 router 报告建议额外回答下面 4 个问题：

1. 是否存在同周内频繁切换策略但收益没有改善？
2. 是否存在大量 stop / reduce 才勉强维持收益？
3. 是否存在 `loss_recheck` 成为主要收益来源的迹象？
4. 是否存在某条规则训练期命中很多，但未来期明显误伤？

## 与其他文档的关系

- [METHODOLOGY.md](/Users/ts-changchang.zhuang/git/money/train/METHODOLOGY.md)：说明为什么要这样训练和验证
- [PLAYBOOK.md](/Users/ts-changchang.zhuang/git/money/train/PLAYBOOK.md)：说明执行顺序
- [TASK_TEMPLATE.md](/Users/ts-changchang.zhuang/git/money/train/TASK_TEMPLATE.md)：说明如何发起任务
- `REPORT_SCORECARD.md`：说明结果应该如何被统一评估
