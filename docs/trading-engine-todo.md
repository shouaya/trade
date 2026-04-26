# 通用交易引擎 TODO

## Goal

建立一个 venue-neutral 的通用交易引擎，让离线训练策略 JSON 可以被多个交易所 skill 一致执行。

目标链路：

```text
D:/git/trade
  -> trade_strategy_artifact.v1
  -> import / conversion
  -> StrategyProfile
  -> @ai.weget.jp/trading-engine
  -> TradingVenueAdapter
  -> skill-stratium-trader / skill-gmo-fx / skill-gmo-coin / skill-okx / skill-hyperliquid / skill-binance
```

核心原则：

- 策略语义只实现一次，不能散落在各交易所 skill 内。
- 各交易所 skill 只负责 venue adapter：行情、账户、持仓、下单、撤单、平仓、事件映射。
- 本番执行必须是 `native` 兼容，不允许 silently degraded。
- AI 审核只能作为 gate，不能绕过 deterministic risk / order constraints。

参考契约：

- [strategy-profile-io-contract.md](./strategy-profile-io-contract.md)

## Current Reality

`D:/git/trade` 当前能力：

- 已有 RSI / ATR 参数搜索
- 已有 bid/ask 执行价格
- 已有 fee-aware 回测
- 已有 MA200 / multi-timeframe / trailing stop / RSI reversion / schedule 逻辑
- 已有 weekly / monthly rolling decision report
- 尚未产出完整 `trade_strategy_artifact.v1`
- 尚未产出 golden replay fixture：
  - artifact
  - candle slice
  - expected decisions
  - expected trade lifecycle

`ai.weget.jp` 当前能力：

- 已有 `skill-stratium-trader`
- 已有 `ai_bot_strategy_profiles.profile_json`
- 已有 Platform profile 编辑和保存
- 已有 bot-host 同步 profile 到 runtime
- 已有基础 runtime projection / trade event persistence
- 已有 `@ai.weget.jp/trading-engine`
- 已有 `rsi_atr_reversion_v1`
- 已有 deterministic replay runner
- 已覆盖 RSI / ATR / MA200 / multi-timeframe / trailing / schedule / long-short parity
- `skill-stratium-trader` 已经通过 trading-engine 执行 native strategy decision
- `npm run test:trading-engine:coverage` 当前 gate：
  - line >= 90%
  - branch >= 95%
  - function >= 90%

当前真正缺口：

- `trade` 还没有 exporter 产出完整 artifact。
- `trade` 还没有 golden replay fixture。
- 两边还没有用同一 artifact + 同一 candles 做 parity test。
- ai.weget.jp 还没有完整 import/conversion UX，但这一步可以等 artifact 稳定后展开。

Known validation issue:

- `D:/git/trade/train npm test` 当前有 4 个 `StrategyExecutor` 相关失败，需要在 exporter/native parity 前修复或明确更新测试预期。

## Next Codex Handoff For `D:/git/trade`

切换到 `D:/git/trade` 后，下一轮 Codex 的第一目标不是改交易逻辑，而是让训练结果可以被外部稳定消费。

建议直接给 Codex 的任务：

```text
请在 D:/git/trade 实现 trade_strategy_artifact.v1 exporter 和 golden replay fixture exporter。

必须参考 docs/strategy-profile-io-contract.md。

输出：
- train/exports/strategy-artifacts/*.json
- train/exports/golden-replay/*.json

实现建议：
- train/src/services/strategy-artifact-exporter.ts
- train/src/scripts/export-strategy-artifact.ts
- train/test/strategy-artifact-exporter.test.ts

输入至少支持：
- train/configs/generated/weekly/*_validate.json
- train/reports/weekly/*_decision.md 或后续同等 JSON source
- monthly rolling config/report
- top strategy snapshot JSON

artifact 必须包含完整策略常量，不能依赖脚本默认值。
golden replay 必须包含同一策略在 StrategyExecutor 下的 expected decisions。

先跑 npm run build 和 npm test；如果现有 StrategyExecutor 测试失败，先判断是 bug 还是旧预期，并在说明里列出处理方式。
```

第一批 acceptance criteria：

- 一个 weekly artifact fixture 可以稳定生成并进入 git。
- 一个 monthly artifact fixture 可以稳定生成并进入 git。
- artifact 中 `decision.selected_params` 包含 RSI / ATR / risk / schedule / executor_features / fee_model。
- artifact 中 `compatibility.conversion_mode` 对可执行策略为 `native`；对 `decision.action = pause` 为 `blocked`。
- golden fixture 中至少包含一次 open 和一次 close。
- expected decisions 使用 bid/ask execution price，不回退到 summary PnL 推导。

## Phase 0. Contract Freeze

Owner: both repos

- [ ] 确认 `trade_strategy_artifact.v1` 是唯一离线策略入力文件。
- [ ] 确认 `aiweget_strategy_profile_import.v1` 是唯一导入出力文件。
- [ ] 确认本番只允许 `conversion.mode = native`。
- [ ] 确认 `degraded_fixed_bps` 只允许 local smoke / paper experiment。
- [ ] 确认 raw weekly/monthly report 不能直接入库执行。
- [ ] 确认 `StrategyProfile` 不保存 credential / account secret / API URL。
- [ ] 确认 `bot-host` 继续拥有 auto-submit authority。

Exit criteria:

- 两边 docs 中的 contract hash 一致。
- 所有后续实现任务引用同一份 contract。

## Phase 1. `trade` Artifact Exporter

Owner: `D:/git/trade`

- [ ] 新增 `train/exports/strategy-artifacts/` 输出目录。
- [ ] 新增 `train/exports/golden-replay/` 输出目录。
- [ ] 新增 exporter 脚本，产出 `trade_strategy_artifact.v1`。
- [ ] 新增 golden replay exporter，产出 candle slice + expected decisions。
- [ ] exporter 输入支持：
  - generated validate config
  - weekly decision report
  - monthly rolling report
  - top strategy JSON
- [ ] exporter 输出必须包含完整策略常量：
  - RSI period / oversold / overbought
  - risk max positions / lot size / max hold minutes
  - ATR period / SL multiplier / TP multiplier
  - trading schedule / time restriction
  - executor feature flags
  - fee model
  - market metadata
  - source config / source report / git commit if available
- [ ] 对 `decision.action = pause` 输出 `compatibility.conversion_mode = blocked`。
- [ ] 对 incomplete source 输出失败，不生成半残 artifact。
- [ ] 增加 snapshot tests 覆盖 weekly / monthly / top strategy artifact。
- [ ] 增加 golden replay tests，确认 fixture 至少包含 open / close。
- [ ] 修复或更新当前 `StrategyExecutor` 4 个失败测试。

Exit criteria:

- artifact 可以独立转换，不需要读取训练脚本常量。
- artifact fixture 稳定进入 git。
- golden replay fixture 可以被 `ai.weget.jp` 直接读取。

## Phase 2. Trading Engine Package Skeleton

Owner: `D:/git/ai.weget.jp`

Target package:

```text
packages-public/trading-engine/
@ai.weget.jp/trading-engine
```

- [x] 新增 workspace package。
- [x] 定义核心类型：
  - `StrategyProfile`
  - `StrategyTemplate`
  - `MarketCandle`
  - `MarketTick`
  - `MarketSnapshot`
  - `FeatureFrame`
  - `StrategySignal`
  - `RiskDecision`
  - `AiReviewRequest`
  - `AiReviewDecision`
  - `OrderIntent`
  - `OrderSubmitResult`
  - `PositionSnapshot`
  - `OpenOrderSnapshot`
  - `TradingVenueAdapter`
  - `RuntimeCapability`
- [x] 定义 engine modes：
  - `observe-only`
  - `propose-only`
  - `bounded-auto-execute`
  - `manual-override`
- [ ] 定义 profile validator。
- [x] 定义 capability matcher：
  - artifact required features
  - target skill runtime capabilities
  - native / blocked decision
- [x] 暂不引入任何 exchange API dependency。

Exit criteria:

- [x] `npm run check -w @ai.weget.jp/trading-engine` 通过。
- [x] package 可被 `skill-stratium-trader` 引用。

## Phase 3. Strategy Semantics Parity

Owner: `D:/git/ai.weget.jp`

Scope: 在 `@ai.weget.jp/trading-engine` 实现 `trade` 当前策略语义。

- [x] 新增 template `rsi_atr_reversion_v1`。
- [x] 移植 / 重写并测试指标：
  - RSI
  - ATR
  - MA200
  - 1m -> 5m multi-timeframe aggregation
- [x] 实现 entry signal：
  - RSI oversold -> long
  - RSI overbought -> short
  - optional MA200 filter
  - optional multi-timeframe RSI
  - direction: `long_only` / `short_only` / `both`
- [x] 实现 exit logic：
  - ATR dynamic stop loss
  - ATR dynamic take profit
  - trailing stop
  - RSI reversion exit
  - max hold minutes
  - no overnight
  - no weekend
  - configured trading schedule
- [ ] 实现 cost-aware metadata，但不让 fee model 覆盖 risk gate。
- [x] 实现 deterministic replay runner。

Exit criteria:

- [x] engine 可以在纯内存 candle fixture 上产生完整 entry / exit 序列。
- [x] 不依赖任何 venue adapter 也能跑 replay。
- [x] branch coverage gate >= 95%。

## Phase 4. Golden Replay Against `trade`

Owner: both repos

- [ ] `trade` 导出 golden fixture：
  - artifact
  - candle slice
  - expected decisions
  - expected trade lifecycle
- [ ] `ai.weget.jp` engine 增加 replay test。
- [ ] 对比项：
  - signal timestamp
  - direction
  - entry price basis
  - stop price
  - take price
  - exit reason
  - hold duration
  - gross / net metadata where applicable
- [ ] 明确允许误差：
  - price precision
  - quantity precision
  - fee rounding
- [ ] 固定至少一组 weekly fixture 和一组 monthly fixture。

Exit criteria:

- 同一 artifact + candle fixture 下，`trade` 与 `trading-engine` 决策一致。
- 不一致必须有 explicit compatibility note，不能进入 native。

## Phase 5. Stratium Native Runtime

Owner: `D:/git/ai.weget.jp`

- [x] `skill-stratium-trader` 引用 `@ai.weget.jp/trading-engine`。
- [x] 从 `skill-stratium-trader` runtime 中移除重复策略判断，改为调用 engine。
- [ ] 实现 `TradingVenueAdapter` for Stratium：
  - symbol normalize
  - quantity normalize
  - market snapshot
  - account / position / open order state
  - submit order
  - cancel order
  - close position
  - exchange event normalize
- [x] runtime start 前检查 profile compatibility。
- [x] 若 profile 要求 unsupported features，阻止自动入场执行。
- [ ] runtime projection 显示：
  - strategy id
  - template
  - conversion mode
  - active features
  - venue adapter
  - compatibility state
- [ ] 保持现有 order reconciliation guard。
- [ ] 保持 trade history 上报。

Exit criteria:

- `skill-stratium-trader` 可以 native 执行 `trade_strategy_artifact.v1` 转换后的 profile。
- paper mode 下完成 observe / propose / bounded-auto-execute 三档验证。

## Phase 6. AI Review Gate

Owner: `D:/git/ai.weget.jp`

- [ ] 把 AI review 抽象成 engine gate。
- [ ] AI review 输入来自 engine structured context。
- [ ] AI 输出只能是：
  - approve
  - reject
  - defer
  - require_human_review
- [ ] AI 不能修改：
  - symbol
  - side
  - max quantity
  - max loss
  - schedule
  - risk block decision
- [ ] AI approve 后必须再过 final deterministic risk check。
- [ ] 保存 AI review event 到 trade history。

Exit criteria:

- AI review 可以开关。
- AI failure / timeout 不会导致自动下单。

## Phase 7. Import Pipeline And Platform UX

Owner: `D:/git/ai.weget.jp`

- [ ] 新增 import/conversion service。
- [ ] 支持上传 / 粘贴 `trade_strategy_artifact.v1`。
- [ ] 生成 `aiweget_strategy_profile_import.v1`。
- [ ] 调用 capability matcher。
- [ ] Platform 显示：
  - source artifact
  - target bot
  - target skill
  - venue adapter
  - selected strategy
  - metrics
  - compatibility mode
  - warnings
  - unsupported features
- [ ] 只有 operator 确认后保存 `profile_json`。
- [ ] 当前 DB 只保存 `profile_json`。
- [ ] 后续 migration 再设计 provenance / import audit 表。

Exit criteria:

- Platform 不允许一键保存 blocked artifact。
- 保存后 bot-host 能同步并看到同一个 strategy id。

## Phase 8. GMO FX / GMO Coin Adapter

Owner: `D:/git/ai.weget.jp`

- [ ] 为 `skill-gmo-fx` 声明 runtime capability。
- [ ] 为 `skill-gmo-coin` 声明 runtime capability。
- [ ] 实现 GMO FX venue adapter：
  - `fx_lot` quantity adapter
  - FX symbol adapter
  - position summary adapter
  - order / close order adapter
- [ ] 实现 GMO Coin venue adapter：
  - base quantity adapter
  - coin symbol adapter
  - position / open order adapter
  - order / close order adapter
- [ ] 接入 shared engine。
- [ ] 增加 dry-run / propose-only test。
- [ ] 禁止未通过 native parity 的 profile 进入 bounded-auto-execute。

Exit criteria:

- 同一个 profile 可以通过不同 venue adapter 运行 observe/propose。
- 下单前 quantity / symbol / order type 均由 adapter 明确转换。

## Phase 9. Future Venue Skills

Owner: future packages

Targets:

- `skill-okx`
- `skill-hyperliquid`
- `skill-binance`

每个新 skill 必须先实现：

- [ ] runtime capability declaration
- [ ] venue adapter
- [ ] symbol map
- [ ] quantity unit map
- [ ] order type map
- [ ] account / position / order state adapter
- [ ] exchange event adapter
- [ ] dry-run tests
- [ ] native compatibility tests before bounded auto-execute

## Phase 10. Production Rollout

Owner: `D:/git/ai.weget.jp`

- [ ] 本番导入只允许 `conversion.mode = native`。
- [ ] 本番导入必须 `unsupported_features = []`。
- [ ] 本番 auto-submit 必须 operator 显式启用。
- [ ] 本番 profile 必须有 rollback profile。
- [ ] 本番 runtime 必须上报：
  - signal
  - risk gate
  - AI gate
  - order intent
  - submit result
  - reconciliation
  - fill
  - PnL
  - exit reason
- [ ] Platform 必须能看到 active profile 和 active venue adapter。
- [ ] 事故停止必须能从 Platform / bot-host 本地 UI 执行。

Exit criteria:

- 先 paper。
- 再小仓位 bounded-auto-execute。
- 再考虑扩大 venue / symbol / quantity。

## Definition Of Done

这个方向完成的标准不是“能导入 JSON”，而是：

- `trade` 产出的 artifact 完整、可验证、可回放。
- `trading-engine` 对同一 artifact 的决策和 `trade` golden fixture 一致。
- `skill-stratium-trader` native 执行，不再使用 degraded fallback。
- 策略逻辑不复制进 GMO / OKX / Binance 等 skill。
- venue adapter 明确承担所有交易所差异。
- AI 审核不会绕过 deterministic risk。
- 本番前 Platform 能展示、审批、回滚、停止。
