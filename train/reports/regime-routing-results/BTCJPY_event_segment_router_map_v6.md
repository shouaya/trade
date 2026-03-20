# BTCJPY 事件段 -> Router Policy 映射表（v6）

## 可直接执行的事件段映射

| 事件段 | 识别特征 | Router 规则 | 动作 | 策略 |
| --- | --- | --- | --- | --- |
| crash spike stop | `crash-trend` 且 `absReturn>=8` 且 `vol>=8.8` 且 `avgRange>=0.10` | `W1_CRASH_SPIKE_WEEK_STOP` | 停做 | - |
| dead range stop | `range-mid-vol` 且 `absReturn<=1` 且 `vol<=4.3` 且 `avgRange<=0.045` | `W2_DEAD_RANGE_WEEK_STOP` | 停做 | - |
| crash extension with rebound | `crash-trend` 且 `absReturn>=5.8` 且 `vol>=6.7` 且 `avgRange>=0.075` 且 `up>=48.1` | `W3_CRASH_EXTENSION_UPRATIO_HOLD` | 减仓交易 | `RP7/OS35/OB65/MF6/MS12/H8/SL1.5/TP1.5` |
| aggressive crash reversal | `crash-trend` 且 `absReturn>=5` 且 `vol>=6.7` 且 `avgRange>=0.064` | `W4_CRASH_AGGRESSIVE_REVERSAL` | 减仓交易 | `RP5/OS35/OB68/MF4/MS9/H6/SL1.5/TP1.5` |
| normal crash fast | `crash-trend` 且 `absReturn>=3.8` 且 `vol>=6` 且 `avgRange>=0.066` 且 `up<47.5` | `W5_CRASH_NORMAL_FAST` | 满仓交易 | `RP7/OS32/OB65/MF4/MS9/H6/SL2/TP1.5` |
| balanced crash hold | `crash-trend` 且 `absReturn 3.8~5.2` 且 `vol>=6` 且 `avgRange>=0.07` 且 `up>=47.5` | `W6_CRASH_BALANCED_HOLD` | 减仓交易 | `RP7/OS35/OB68/MF6/MS12/H8/SL1.5/TP1.5` |
| high-switch month crash fallback | 月级 `crash-trend` 且 `vol>=18` 且 `avgRange>=0.095`，周层没给策略 | `M1_OVERHEATED_CRASH_MONTH_REDUCE` | 0.5 风险交易 | `RP5/OS35/OB65/MF6/MS12/H8/SL2/TP1` |
| high-switch strong swing | `strong-trend` 且 `vol 6.0~6.8` 且 `avgRange>=0.07` 且 `up>=48.4` | `W7_HIGH_SWITCH_STRONG_SWING_WEEK` | 满仓交易 | `RP5/OS32/OB65/MF4/MS12/H6/SL2/TP1.5` |
| strong clean alt | `strong-trend` 且 `vol 5.2~5.7` 且 `avgRange>=0.06` | `W8_STRONG_CLEAN_ALT_WEEK` | 满仓交易 | `RP5/OS32/OB65/MF4/MS12/H8/SL1.5/TP1` |
| strong clean | `strong-trend` 且 `vol>=5` 且 `avgRange>=0.052` | `W9_STRONG_CLEAN_WEEK` | 满仓交易 | `RP5/OS32/OB65/MF6/MS12/H8/SL1.5/TP1` |
| range swing balance | `range-mid-vol` 且 `vol 5.0~5.5` 且 `absReturn>=1.5` 且 `avgRange 0.05~0.056` | `W10_RANGE_SWING_BALANCE_WEEK` | 满仓交易 | `RP7/OS32/OB65/MF4/MS12/H8/SL2/TP1` |
| range rich momentum | `range-mid-vol` 且 `vol 5.5~6.2` 且 `absReturn>=1` 且 `avgRange 0.06~0.065` 且 `up>=47.4` | `W11_RANGE_RICH_MOMENTUM_WEEK` | 满仓交易 | `RP7/OS35/OB65/MF4/MS12/H6/SL2/TP1.5` |
| fake rich reduce | `range-mid-vol` 且 `vol>=6.2` 且 `absReturn<=0.4` 且 `avgRange>=0.064` | `W12_FAKE_RICH_RANGE_REDUCE` | 0.25 风险交易 | `RP7/OS32/OB65/MF4/MS12/H8/SL1.5/TP1` |
| generic rich range | `range-mid-vol` 且 `vol>=4.5` 且 `avgRange>=0.055` | `W13_RANGE_RICH_WEEK` | 满仓交易 | `RP7/OS35/OB68/MF6/MS9/H6/SL2/TP1.5` |
| generic balance range | `range-mid-vol/range-low-vol` 且 `absReturn<=3` 且 `avgRange>=0.045` | `W14_RANGE_BALANCE_WEEK` | 0.75 风险交易 | `RP7/OS32/OB65/MF4/MS12/H8/SL2/TP1` |
| mixed recovery | `mixed-trend` 且 `vol<=4.5` 且 `avgRange<=0.055` | `W15_MIXED_RECOVERY_WEEK` | 0.25 风险交易 | `RP5/OS32/OB68/MF6/MS12/H8/SL2/TP1.5` |

## 日级保护层

| 日级事件 | Router 规则 | 动作 |
| --- | --- | --- |
| extreme crash day | `D1_EXTREME_CRASH_DAY_STOP` | 停做 |
| dead low-vol chop | `D2_DEAD_LOW_VOL_DAY_STOP` | 停做 |
| pseudo-balanced trap | `D3_PSEUDO_BALANCED_DAY_STOP` | 停做 |
| mixed recovery transition | `D4_MIXED_RECOVERY_DAY_REDUCE` | 减仓 |
| strong overshoot | `D5_STRONG_OVERSHOOT_REDUCE` | 减仓 |

## 当前推荐用法

- BTCJPY 主路由版本：`v6`
- 事件段 JSON 目录：`train/configs/generated/regime-routing/BTCJPY_dual_year_policy_catalog_v6.json`
- train / validate / report 已共用同一份 policy catalog，不再需要手工维护多份事件段映射。
