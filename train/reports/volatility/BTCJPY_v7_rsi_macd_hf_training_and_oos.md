# BTCJPY V7 高频 RSI+MACD 实验报告

## 1. 为什么做这轮

此前确认的 `OS28/OB72 + H4` 主策略虽然双年泛化稳定，但存在两个明显问题:

- 日均交易次数太低，按自然日只有约 `0.24` 笔
- 收益主要来自 `hold_time_reached`，不是 `take_profit`

因此本轮不再继续微调旧 `rsi_only`，而是新增一条真正面向高频的 `rsi_macd` 支线。

## 2. 本轮代码改动

- 新增策略类型: `rsi_macd`
- 将 `MACD` 参数空间接入策略组合生成器
- 在执行器中增加 `RSI + MACD` 联合入场逻辑
- 将交易记录中的 `entry_macd / exit_macd` 等字段真正写入
- 修复 `trades` 表中 `MACD` 列精度不足的问题，扩展到 `DECIMAL(20,8)`

相关文件:

- `train/src/types/index.ts`
- `train/src/services/strategy-parameter-generator.ts`
- `train/src/services/strategy-executor.ts`
- `train/src/database/trades.schema.ts`
- `backend/sql/init.sql`

## 3. 新训练配置

配置文件:

- `train/configs/training/2025_btcjpy_hf_rsi_macd_tp_atr.json`

核心设计:

- `strategy.type = rsi_macd`
- `RSI period = 5 / 7`
- `OS = 32 / 35`
- `OB = 65 / 68`
- `MACD fast = 4 / 6`
- `MACD slow = 9 / 12`
- `MACD signal = 3 / 4`
- `maxHold = 6 / 8`
- `ATR SL = 1.5 / 2.0`
- `ATR TP = 1.0 / 1.5`
- 交易窗口扩展为 `* 12-18 * * 1-5`
- 关闭 `MA200 / 多时间框架 / trailing / RSI reversion`

## 4. 2025 训练年结果

结果表:

- `backtest_results_2025_btcjpy_v7_hf_rsi_macd_tp_atr`

训练摘要:

| 指标 | 数值 |
| --- | ---: |
| 策略数 | `512` |
| 有效策略 | `512 / 512` |
| 总交易数 | `893620` |
| 平均速度 | `0.48 秒/策略` |

Top1:

| 参数 | 数值 |
| --- | --- |
| Strategy | `GMOCOIN-RSIMACD-RP7-OS32-OB68-MF4-MS9-MSG3-HT0-MP1-LOT0.008-H6-ATRSL1.5-ATRTP1` |
| Trades | `2077` |
| Win Rate | `57.20%` |
| Total PnL | `8412.80` |

## 5. 高频化是否成功

结论: **成功，但只成功了一半。**

### 5.1 频率已经明显抬起来

Top1 训练年统计:

| 指标 | 数值 |
| --- | ---: |
| 总交易数 | `2077` |
| 有交易日 | `309` |
| 平均交易/自然日 | `5.69` |
| 平均交易/有交易日 | `6.72` |
| 平均持仓 | `3.82 分钟` |

这已经和旧 `H4` 主策略完全不是一个量级。

### 5.2 收益主因已经转成 TP

Top1 退出结构:

| Exit Reason | Trades | 占比 | PnL |
| --- | ---: | ---: | ---: |
| `take_profit` | `975` | `46.94%` | `174487.38` |
| `stop_loss` | `561` | `27.01%` | `-147028.50` |
| `hold_time_reached` | `541` | `26.05%` | `-19046.06` |

一句话:

- 这已经不是旧版“时间到就走”的结构了
- 现在确实是 **TP 在创造正收益**
- 但 `stop_loss` 吃掉了大量利润，说明信号质量还不够稳

## 6. 训练年 Top10 exact OOS

验证配置:

- `train/configs/validation/2025_btcjpy_v7_hf_rsi_macd_top10_exact_from_2025_2024_validation.json`
- `train/configs/validation/2025_btcjpy_v7_hf_rsi_macd_top10_exact_from_2025_2026_validation.json`

结果表:

- `2024`: `backtest_results_top10_btcjpy_2024_6113a792`
- `2026`: `backtest_results_top10_btcjpy_2026_3da98637`

聚合结果:

| 样本 | 平均 PnL | 最佳 | 最差 | 正收益数 |
| --- | ---: | ---: | ---: | ---: |
| `2025 train top10` | `4446.07` | `8412.80` | `2530.92` | `10/10` |
| `2024 exact top10` | `-2716.03` | `966.33` | `-7093.72` | `2/10` |
| `2026 exact top10` | `-365.27` | `3226.56` | `-5063.26` | `5/10` |

## 7. 双年泛化结论

双年合并后，只有一条策略仍保持正收益:

| 参数 | 2024 | 2026 | 合并 |
| --- | ---: | ---: | ---: |
| `RP7 / OS32 / OB68 / MF4 / MS9 / MSG3 / H6 / ATRSL1.5 / ATRTP1.0` | `966.33` | `933.31` | `1899.64` |

但这个双年合并结果仍明显弱于此前稳定的旧 `rsi_only H4` 主策略:

- 旧 `H4` 双年合并: `3821.58`
- 新 `rsi_macd` 当前最优双年合并: `1899.64`

## 8. 这轮真正学到的东西

本轮不是失败，而是回答了一个非常重要的问题:

### 已被验证的正面结论

- 你的判断是对的: 高频不能只缩短持仓，必须改信号
- `RSI + MACD` 确实能把 BTCJPY 拉成真正的高频
- 也确实能把收益结构从“时间退出”切换到“TP 驱动”

### 但也暴露了新的问题

- 新信号在 `2025` 上很适合
- 到 `2024` 就明显退化
- 到 `2026` 有部分策略仍然有效，但整体还不够稳定

所以当前阶段的真实判断是:

> `rsi_macd` 解决了“高频”和“TP驱动”的问题，但还没有解决“跨年泛化”的问题。

## 9. 下一步建议

这条线现在最值得继续做，但方式要变:

1. 不再把重点放在 `ATR SL/TP` 微调。
2. 直接围绕当前唯一双年为正的那条核心参数做邻域搜索:
   - `RP7`
   - `OS32`
   - `OB68`
   - `MF4 / MS9 / MSG3`
   - `H6`
   - `ATRTP1.0`
3. 下一轮优先优化:
   - `OB 66 / 67 / 68 / 69`
   - `OS 30 / 31 / 32 / 33`
   - `ATRSL 1.25 / 1.5 / 1.75`
   - `H5 / H6 / H7`
4. 也可以走双轨:
   - 保留旧 `H4 rsi_only` 作为稳健主策略
   - 新 `rsi_macd` 作为高频进攻子策略

## 10. 一句话结论

这轮 `BTCJPY V7 rsi_macd` 已经证明“真正的高频 TP 驱动”是可以做出来的，但目前还停留在训练年强、跨年不稳的阶段。它更像是一个很有前景的新策略分支，而不是现在就能替代旧 `H4` 稳健主策略的最终解。
