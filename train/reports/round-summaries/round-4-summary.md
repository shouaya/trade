# 第4轮训练总结报告

## 1. 训练身份

- 训练轮次: 第4轮
- `train_id`: `train-2026-03-24-73a8e6a8`
- 训练配置: `configs/training/2024_btcjpy_r4_hf_rsi_macd_tp_atr.json`
- Top 策略配置: `configs/top-strategies/2024_btcjpy_top10.generated.json`
- Router 配置: `configs/generated/regime-routing/2024_btcjpy_r4_hf_rsi_macd_tp_atr_router.json`
- Policy 配置: `configs/generated/regime-routing/2024_btcjpy_r4_hf_rsi_macd_tp_atr_router.policy.json`
- 滚动范围: `2024-04-01` 到 `2026-03-24`
- 标的: `BTCJPY`

## 2. 总体结论

第4轮最大的进展，不是“市场特征已经足够强”，而是 rolling 系统已经从研究态推进到了可以连续生成候选池、可以自动产出 router / policy、可以逐月验证、可以形成可对照成果物的状态。

这意味着第5轮开始，我们终于可以把主要精力从“修流程能不能跑通”转到“业务目标是否真的被达成”上，也就是市场特征是否真的在指导策略池，router 是否真的在降低错误暴露，系统是否在朝未来稳定盈利的方向收敛。

但第4轮还不能定义为已经达成目标。当前更像是“执行层和观察层已经搭好”，而“因果特征强度”和“跨窗口稳定性”仍然不足。换句话说，第4轮更适合作为第5轮的业务基线，而不是最终方法定稿。

## 3. 关键成果

### 3.1 目标跟踪结果

- Goal attainment: `87.96%`
- 状态: `on-track`
- 结论: 系统已经出现较明确的特征-策略匹配迹象，可以继续做稳定性强化

按维度看:

| 维度 | 指标 | 结果 |
| --- | --- | ---: |
| Adaptation | Monthly pools | `24` |
| Adaptation | Avg pool size | `10` |
| Adaptation | Unique strategies | `180` |
| Adaptation | Avg turnover ratio | `0.9852` |
| Adaptation | Score | `99.33%` |
| Validation | Validation windows | `24` |
| Validation | Profitable best-window ratio | `0.9583` |
| Validation | Median best return | `0.317%` |
| Validation | Worst best return | `-0.0221%` |
| Validation | Score | `77.76%` |
| Router | Coverage ratio | `1` |
| Router | Positive window ratio | `0.7917` |
| Router | Beat baseline ratio | `0.875` |
| Router | Avg strategy switches / week | `4.9904` |
| Router | Avg week-day alignment | `0.7195` |
| Router | Avg positive strategy ratio | `42.8573` |
| Router | Avg best-vs-median gap | `537.8133` |
| Router | Avg trend efficiency | `0.0325` |
| Router | Score | `86.67%` |
| Stability | Positive window ratio | `0.7917` |
| Stability | Avg max drawdown pct | `0.0808` |
| Stability | Profit concentration share (top 5) | `0.0965` |
| Stability | Score | `90.63%` |

业务解释:

- 候选池维护这件事本身已经基本成形，24 个 rolling window 都能形成月度池，并且池子有明显轮换。
- Router 也不再只是静态映射，已经开始对不同阶段做不同暴露控制。
- 但 Validation 分数仍低于 Adaptation / Stability，说明“池子会动”不等于“未来表现已经稳定”。

### 3.2 Router 在 2026 年 3 月的表现是当前最清晰的亮点

`2026-03` 的 router 验证结果:

- Router PnL: `1647.5`
- Router return: `0.1648%`
- Router max drawdown: `498.57`
- Router traded days: `20`
- Router positive weeks: `3`
- Router negative weeks: `1`
- 相对默认策略: `+1610.34`
- 相对 Top10 Equal Weight: `+1756.83`

这说明第4轮里最有价值的提升，主要发生在执行层:

- Router 已经能在实际滚动窗口里跑出明显优于静态基准的结果。
- 风险暴露被压低了，尤其是和默认单策略相比，回撤恶化并不明显。
- 当前 router 的收益并不是靠满仓硬扛出来的，而是大量使用 `reduce` 风格动作做保守暴露控制。

### 3.3 成本不是当前主矛盾

`2026-03` 的 cost sensitivity 报告显示:

- Venue: `GMOCOIN`
- Product: `exchange-leverage / BTC_JPY`
- Commission rate: `0`
- `Base Fee` 与 `No Cost` 在本样本中完全一致

业务解释:

- 现阶段拖累系统的主要因素不是手续费。
- 第5轮不应该把重心放在手续费微调，而应该继续放在特征质量、候选池匹配和 router 触发质量。

## 4. 第4轮真正做对了什么

### 4.1 Rolling 机制已经不是固定快照思路

第4轮已经不是“训练 2025，验证 2026”的旧式切法，而是:

- 在 `2024-04` 到 `2026-03` 的 rolling 过程中逐月更新候选池
- 策略不是一次性固定，而是随着月份变化进行增删替换
- Router / policy 也已经作为 rolling 成果物被生成出来

这部分是第4轮最关键的结构性成果，因为它让系统第一次具备了“持续维护策略库”的基础。

### 4.2 执行层已经开始体现市场分段差异

从 `2026-03` router 报告看，规则命中已经覆盖:

- 月级 guard
- 周级 guard
- 日级 router

其中最典型的是:

- `monthly_guard_mixed_trend_trendEfficiency_low`
- `weekly_guard_range_mid_vol`
- `weekly_guard_crash_trend`
- `weekly_guard_strong_trend`
- 多个按 `positiveStrategyRatio` / `reversalStrength` 切分的日级规则

这说明系统已经不再是“单一策略跑到底”，而是开始按事件分段做不同处理。

### 4.3 系统已经具备“可比较、可追踪、可复盘”的能力

第4轮结束时，已经能稳定产出:

- goal-tracking
- feature-causality
- cost-sensitivity
- regime-routing-results

这点非常重要，因为第5轮以后每一轮都可以直接拿这些成果物做横向比较，而不是靠人工回忆判断系统是否变好。

## 5. 当前最核心的问题

### 5.1 因果特征仍然偏弱

Feature causality 审计结果:

- Days audited: `723`
- Opening bucket match rate: `28.35%`
- Opening/full-day return sign match rate: `58.23%`
- Opening/full-day return correlation: `0.3155`
- Opening/full-day vol correlation: `0.6364`
- Opening/full-day range correlation: `0.6721`
- Opening/full-day trend efficiency correlation: `0.0894`
- Opening/full-day reversal strength correlation: `0`

业务解释:

- 现在的 opening 信息对 full-day 结果只有中低程度解释力。
- 尤其 `trendEfficiency` 和 `reversalStrength` 的因果映射还不够强。
- 所以第4轮跑出来的 improvement，更像是“router 可以用了”，而不是“特征已经足够可靠地指导 router”。

### 5.2 仍存在明确的负收益窗口

第4轮 24 个 rolling 窗口中，至少以下 5 个月 router 仍为负:

| 窗口 | Router PnL | Router Return | Max DD |
| --- | ---: | ---: | ---: |
| `2024-06` | `-994.62` | `-0.0995%` | `1478.11` |
| `2025-03` | `-74.89` | `-0.0075%` | `1202.48` |
| `2025-06` | `-203.17` | `-0.0203%` | `875.82` |
| `2025-11` | `-662.92` | `-0.0663%` | `1869.14` |
| `2025-12` | `-132.75` | `-0.0133%` | `1080.52` |

业务解释:

- 系统已经有了不错的正收益月占比，但仍没有解决“某些环境下完全失灵”的问题。
- 第5轮如果只是提升强势月份收益，而没有减少这些负窗口，那业务价值并不算真正上台阶。

### 5.3 收益仍有集中度风险

`2026-03` router 报告给出的 redline:

- top 3 positive weeks contribute `122.34%` of total PnL

业务解释:

- 当前收益仍明显依赖少数优势周。
- 这说明系统虽能抓到一部分高质量机会，但收益分布还不够均匀。
- 未来如果少掉这几段强势窗口，总体结果很容易被拉平甚至转负。

### 5.4 Router 目前偏保守，但还不够“精准保守”

`2026-03` routing mix:

- Stop days: `0`
- Half-or-less risk days: `25`
- Full-size days: `0`
- Loss-recheck override days: `0`

业务解释:

- Router 当前更像“广泛降风险”，而不是“精准识别该停、该减、该放大”。
- 这种做法能先把系统稳定住，但不代表已经把市场特征用到最优。
- 第5轮需要进一步提升的是“何时减仓是对的、何时该放行高置信机会”。

## 6. 第5轮最应该对照的基线

第5轮建议至少对照以下 6 组核心指标:

| 对照项 | 第4轮基线 | 第5轮目标方向 |
| --- | ---: | --- |
| Goal attainment | `87.96%` | 超过本轮 |
| Router positive window ratio | `0.7917` | 提高 |
| Beat baseline ratio | `0.875` | 提高 |
| 负收益窗口数量 | `5` | 减少 |
| Profit concentration share (top 5) | `0.0965` | 不恶化，最好下降 |
| `2026-03` router vs Top10 EW | `+1756.83` | 保持优势或扩大 |

同时，第5轮比较时建议重点回答下面几个业务问题:

1. 市场特征是否更有效地指导了候选池增删，而不只是让池子持续变化。
2. Router 是否减少了负收益月份，而不只是增强了已经很强的月份。
3. 收益是否更分散、更稳定，而不是继续依赖少数强势周。
4. 在不明显恶化回撤的前提下，是否提高了 router 的正收益窗口占比。

## 7. 第5轮优先优化建议

结合第4轮结果，第5轮业务优化优先级建议如下:

### 优先级 A: 强化“可执行时点”特征

重点不是继续堆更多研究态指标，而是增强开盘后可观察、可因果、可执行的特征，例如:

- opening impulse
- early range expansion
- opening reversal continuation / failure
- pre-open to open gap 及其延续性
- 日内前段波动结构与后段方向一致性

目标是提高 opening 到 full-day 的映射能力，让 router 的输入更接近真实可决策信息。

### 优先级 B: 直接针对 5 个负收益窗口做失效归因

建议第5轮不要只看总体均值，要对以下月份单独看:

- `2024-06`
- `2025-03`
- `2025-06`
- `2025-11`
- `2025-12`

重点确认:

- 当月是哪类 market regime 反复误导了候选池
- weekly guard / daily router 是否在错误特征上做了错误减仓或错误放行
- 是否存在应该 stop 但没有 stop 的情形

### 优先级 C: 让 router 从“普遍保守”升级为“分层保守”

当前 `reduce` 很多，但 `stop` 与 `full-size` 基本没被用起来。第5轮建议更明确地区分:

- 高风险环境: 应该真正停手
- 中性不确定环境: 应该减半
- 高置信机会环境: 应该允许更完整暴露

如果做不到这一点，router 容易长期停留在“不会太差，但也拉不开上限”的状态。

## 8. 结论

第4轮可以定义为“系统从研究实验走向业务可运行基线”的一轮。

它的价值在于:

- rolling 候选池维护已经跑通
- router / policy 已经能自动产出
- 报告链路已经完整
- 2026 年 3 月等窗口已经证明 router 相比静态基准具有明显优势

它的问题在于:

- 因果特征仍弱
- 仍有 5 个负收益窗口
- 收益集中度还偏高
- router 还没有真正学会分层管理风险暴露

因此，第5轮最重要的判断标准，不是“是否又多赚了一些”，而是“是否更稳定地减少错误暴露，并让市场特征对策略池与 router 形成更真实的指导”。

## 9. 参考成果物

- `train/reports/goal-tracking/2024_btcjpy_r4_hf_rsi_macd_tp_atr.goal-tracking.md`
- `train/reports/feature-causality/BTCJPY_2024-04-01_to_2026-03-24_60m.md`
- `train/reports/cost-sensitivity/2024_btcjpy_top10_rolling_2026_03_validation.md`
- `train/reports/regime-routing-results/BTCJPY_btcjpy_r4_hf_rsi_macd_tp_atr_train_2026_03_24_73a8e6a8_2026-03-01_to_2026-03-24.md`
