# ETH_JPY / BTC_JPY / SOL_JPY 横向波动率对比报告（2024-2026）

## 范围与口径

- 数据来源: `klines` 表中的 1 分钟 K 线
- 标的: `ETHJPY`、`BTCJPY`、`SOLJPY`
- 时区: JST（Asia/Tokyo）
- 主指标: 每分钟绝对对数收益 `|ln(close_t / close_{t-1})| × 100`
- 辅助指标: 日实现波动率 `sqrt(sum(log_return^2)) × 100`
- 注意: `SOLJPY` 的样本从 `2024-04-13` 开始，`2026` 对三者都属于部分样本。

## 核心结论

- 三个品种里，平均分钟波动最高的是 **SOL_JPY**，跨年份平均 Avg Abs 1m Return 约 **0.134669%**。
- 平均分钟波动最低的是 **BTC_JPY**，跨年份平均约 **0.048913%**。
- 单日极端波动最强的是 **SOL_JPY**，峰值日 **2024-08-05**，日实现波动率 **20.566598%**。
- 单日最平静样本来自 **BTC_JPY**，低波动日 **2024-06-23**，日实现波动率 **0.596161%**。
- 日内时段上，三个品种的高波动窗口都集中在深夜到凌晨 JST，尤其 `23:00-01:00` 一带；低波动窗口主要落在下午到晚间早段。
- 波动层级大致是 `SOLJPY > ETHJPY > BTCJPY`。SOL 的分钟波动和日波动都明显更大，BTC 相对最平稳。

## 总览对比

| Symbol | Cross-Year Avg Abs 1m Return % | Cross-Year Avg Daily RV % | Hottest Month | Hot Month Value % | Calmest Month | Calm Month Value % | Hottest JST Hour | Hot Hour Value % | Calmest JST Hour | Calm Hour Value % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ETH_JPY | 0.073133 | 3.582542 | 2025-02 | 0.099756 | 2024-06 | 0.049137 | 23:00-24:00 | 0.097455 | 14:00-15:00 | 0.059747 |
| BTC_JPY | 0.048913 | 2.549473 | 2024-03 | 0.066243 | 2025-09 | 0.029528 | 23:00-24:00 | 0.070319 | 14:00-15:00 | 0.037045 |
| SOL_JPY | 0.134669 | 4.536149 | 2024-04 | 0.238456 | 2026-01 | 0.083742 | 23:00-24:00 | 0.167339 | 19:00-20:00 | 0.120766 |

## 年度对比

### 2024

| Symbol | Coverage (JST) | Avg Abs 1m Return % | P95 % | Avg 1m Range % | Avg Daily RV % | Max Daily RV % |
| --- | --- | --- | --- | --- | --- | --- |
| ETH_JPY | 2024-01-01 06:02:00 ~ 2024-12-31 23:58:00 | 0.068976 | 0.198431 | 0.077246 | 3.220746 | 17.713961 |
| BTC_JPY | 2024-01-01 06:00:00 ~ 2024-12-31 23:59:00 | 0.050544 | 0.150491 | 0.077105 | 2.646062 | 11.198844 |
| SOL_JPY | 2024-04-13 11:10:00 ~ 2024-12-31 23:59:00 | 0.145983 | 0.465953 | 0.089084 | 5.157946 | 20.566598 |

### 2025

| Symbol | Coverage (JST) | Avg Abs 1m Return % | P95 % | Avg 1m Range % | Avg Daily RV % | Max Daily RV % |
| --- | --- | --- | --- | --- | --- | --- |
| ETH_JPY | 2025-01-01 00:00:00 ~ 2025-12-31 23:59:00 | 0.076123 | 0.226284 | 0.083927 | 3.737303 | 19.846537 |
| BTC_JPY | 2025-01-01 00:00:00 ~ 2025-12-31 23:59:00 | 0.04438 | 0.134092 | 0.062784 | 2.273661 | 7.591924 |
| SOL_JPY | 2025-01-01 00:00:00 ~ 2025-12-31 23:59:00 | 0.142969 | 0.436156 | 0.07767 | 4.630923 | 15.504602 |

### 2026

| Symbol | Coverage (JST) | Avg Abs 1m Return % | P95 % | Avg 1m Range % | Avg Daily RV % | Max Daily RV % |
| --- | --- | --- | --- | --- | --- | --- |
| ETH_JPY | 2026-01-01 00:00:00 ~ 2026-03-18 09:40:00 | 0.074301 | 0.235952 | 0.085204 | 3.789576 | 10.301813 |
| BTC_JPY | 2026-01-01 00:00:00 ~ 2026-03-20 01:58:00 | 0.051816 | 0.161373 | 0.078838 | 2.728696 | 8.390256 |
| SOL_JPY | 2026-01-01 00:01:00 ~ 2026-03-20 01:55:00 | 0.115054 | 0.373897 | 0.058856 | 3.819579 | 13.259832 |

## 解读

- `SOLJPY` 最适合被视作高弹性高噪声资产，月份切换和事件日冲击都更剧烈，做短线时更需要仓位和滑点保护。
- `ETHJPY` 处在中间层，既有明显趋势段，也会出现很厚的尾部，适合做波动 regime 切换。
- `BTCJPY` 相对更稳，分钟收益分布更收敛，适合拿来做基准品种或和 ETH/SOL 做相对强弱比较。
- 三者共同的高波动时段都偏向 `23:00` 前后，说明如果做统一多品种日内策略，这个窗口值得单独建模。
- 三者共同的低波动时段并不完全一致，但都避不开亚洲下午这段偏淡时段，适合降低频率或提高入场阈值。

## 单品种报告索引

- ETH_JPY: `ETHJPY_volatility_report_2024_2026.md`, `ethjpy_volatility_distribution_2024_2026.svg`, `ethjpy_monthly_volatility_2024_2026.svg`, `ethjpy_intraday_volatility_jst.svg`
- BTC_JPY: `BTCJPY_volatility_report_2024_2026.md`, `btcjpy_volatility_distribution_2024_2026.svg`, `btcjpy_monthly_volatility_2024_2026.svg`, `btcjpy_intraday_volatility_jst.svg`
- SOL_JPY: `SOLJPY_volatility_report_2024_2026.md`, `soljpy_volatility_distribution_2024_2026.svg`, `soljpy_monthly_volatility_2024_2026.svg`, `soljpy_intraday_volatility_jst.svg`

