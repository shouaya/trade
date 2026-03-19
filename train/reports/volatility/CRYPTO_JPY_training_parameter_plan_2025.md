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
