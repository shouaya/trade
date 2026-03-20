# ETH_JPY / BTC_JPY / SOL_JPY 训练参数重规划（2025）

## 为什么要改

- 目前三套币种如果共用同一组 `RSI + ATR + maxHoldMinutes + ALWAYS` 配置，会把低波动的 `BTCJPY`、中高波动的 `ETHJPY`、高波动的 `SOLJPY` 混在一起训练，最优参数会彼此污染。
- 从波动率对比结果看，分钟级波动层级非常明确: `SOLJPY > ETHJPY > BTCJPY`。
- 三者的高波动窗口都集中在 `23:00-01:00 JST` 附近，而下午时段明显更淡，全天候训练会把大量低质量样本混入参数搜索。
- 当前执行器还强制 `no_overnight` 和 `no_weekend` 退出，所以配置里的 `ALWAYS` 并不等于真实的 24/7 持仓，继续全天开放入场没有优势。

## 新参数规划原则

- `BTCJPY`: 低波动, 放宽 RSI 阈值, 延长持仓时间, 缩小 ATR 止损范围, 使用更小的 base size 上限。
- `ETHJPY`: 中高波动, 保持中等 RSI 极值, 中等持仓时间, 中等 ATR 倍数, 夜间核心窗口训练。
- `SOLJPY`: 高波动, 使用更极端 RSI 阈值, 更短持仓, 更宽 ATR 止损止盈, 放大 trailing stop 阈值, 只保留深夜扩展窗口。

## 每个币种的新训练空间

| Symbol | UTC 训练时段 | JST 对应 | RSI Period | Oversold | Overbought | Lot Size | Max Hold (min) | ATR SL | ATR TP | Trailing Config |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTC_JPY | `13-17` | `22:00-02:59` | `10,14,21` | `24,28,32` | `68,72,76` | `0.003,0.005,0.008` | `20,30,45,60,90,120` | `1.5,2,2.5,3` | `2.5,3.5,4.5,5.5` | `0.18 / 0.4 / 0.12` |
| ETH_JPY | `13-17` | `22:00-02:59` | `10,14,21` | `20,24,28` | `72,76,80` | `0.03,0.05,0.08` | `10,15,20,30,45,60` | `2,2.5,3,3.5` | `3,4,5,6` | `0.25 / 0.55 / 0.18` |
| SOL_JPY | `13-18` | `22:00-03:59` | `7,10,14` | `16,20,24` | `76,80,84` | `0.5,1,1.5` | `5,10,15,20,30,45` | `2.5,3,3.5,4.5` | `4,5,6,7.5` | `0.4 / 0.9 / 0.3` |

`Trailing Config` 三个数字依次表示:
- `activationPercent`
- `lockProfitPercent`
- `lockProfitAmount`

## 新配置文件

- `train/configs/training/2025_btcjpy_regime_atr.json`
- `train/configs/training/2025_ethjpy_regime_atr.json`
- `train/configs/training/2025_soljpy_regime_atr.json`

## 建议执行顺序

1. 先跑 `BTCJPY`，确认低波动品种在窄窗口下是否明显提升 `profit factor` 和 `score`。
2. 再跑 `ETHJPY`，看是否比现有 `ETHJPY_V3_RSI_ATR` 的全天口径更稳定。
3. 最后跑 `SOLJPY`，重点观察交易数是否下降但收益质量提升。

## 建议验证重点

- 是否减少了低波动时段的无效交易。
- `SOLJPY` 是否从“高频噪声止损”转向“少做但单笔更大”。
- `BTCJPY` 是否因为延长 `maxHoldMinutes` 提高了单笔盈亏比。
- `ETHJPY` 是否继续保持居中的稳健特征，而不是被 `SOL` 式高波动参数带偏。

## BTCJPY 稳定性回收结论（2026-03-20 更新）

- 仅看 `2025` 训练榜前 `1-6` 名，会误以为 `OB76 + ATRSL2 + ATRTP2.5` 是最优；但把原始 `top20` 精确拿去验证 `2024` 和 `2026` 后，这组跨年合并收益只有 `-42.40`。
- 真正跨年最稳的是原训练榜第 `19/20` 名:
  - `RSI-P14-OS28-OB72`
  - `LOT0.008`
  - `H20`
  - `ATRSL3`
  - `ATRTP3.5/4.5`
- 这两条策略在 `2024` 都是 `2050.08`，在 `2026` 都是 `351.54`，两年合并外推收益 `2401.62`，显著优于 `2025` 训练榜首参数簇。
- 因此 `BTCJPY` 下一轮训练不再把搜索重心放在长持仓和偏紧止损，而是围绕 `OB72`、`H20`、`ATRSL3` 附近做邻域搜索。

### 新的 BTCJPY 稳定性训练空间

| Symbol | UTC 训练时段 | JST 对应 | RSI Period | Oversold | Overbought | Lot Size | Max Hold (min) | ATR SL | ATR TP | Trailing Config |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTC_JPY Stability | `13-17` | `22:00-02:59` | `14` | `26,28,30` | `72,74,76` | `0.005,0.008` | `15,20,30` | `2.5,3,3.5` | `3.5,4.5` | `0.18 / 0.4 / 0.12` |

- 新配置文件: `train/configs/training/2025_btcjpy_stability_atr.json`
- 目标: 用更小参数空间重新排序 `BTCJPY 2025`，优先找“训练年稍弱但跨年稳定”的参数簇，而不是单年收益最大值。

## BTCJPY 双年泛化二次回收（2026-03-20 更新）

- 基于 `2025_btcjpy_v4_stability_top20_exact_from_2025` 的精确验证，把 `2024 + 2026` 合并收益重新排序后，前 10 条有非常稳定的共同特征：
  - `RSI period = 14`
  - `overbought = 72`
  - `lotSize = 0.008`
  - `maxHoldMinutes = 15 / 20 / 30`
  - `ATR slMultiplier` 以 `3.5` 为主，少量 `3`
  - `oversold` 只集中在 `28 / 30`
  - `ATR tpMultiplier` 在 `3.5 / 4.5` 之间差异不大
- 前 10 里最强的双年合并策略是：
  - `OS30 / OB72 / H30 / ATRSL3.5 / ATRTP3.5`
  - `OS30 / OB72 / H30 / ATRSL3.5 / ATRTP4.5`
  - 双年合并收益都为 `2985.23`
- 唯一在 `2026` 仍保持正收益的是：
  - `OS28 / OB72 / H15 / ATRSL3 / ATRTP3.5`
  - `OS28 / OB72 / H15 / ATRSL3 / ATRTP4.5`

### 第三轮 BTCJPY 双年泛化训练空间

| Symbol | UTC 训练时段 | JST 对应 | RSI Period | Oversold | Overbought | Lot Size | Max Hold (min) | ATR SL | ATR TP | Trailing Config |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTC_JPY Dual-Year | `13-17` | `22:00-02:59` | `14` | `28,29,30` | `72` | `0.008` | `15,20,30` | `3,3.25,3.5` | `3.5,4.5` | `0.18 / 0.4 / 0.12` |

- 新配置文件: `train/configs/training/2025_btcjpy_dual_year_atr.json`
- 目标:
  - 继续保留 `2024` 的强势盈利能力
  - 同时把 `2026` 的亏损幅度收窄
  - 用更窄的 `OB72` 邻域逼近真正的双年稳健解
