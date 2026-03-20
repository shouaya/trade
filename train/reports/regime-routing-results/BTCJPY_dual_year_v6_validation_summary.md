# BTCJPY dual_year_v6 验证总结

## 这轮做了什么

`v6` 在 `v5` 基础上只做了两类高切换月补丁：

- 月级 `M1_OVERHEATED_CRASH_MONTH_REDUCE` 增加专用 fallback 策略:
  - `RP5/OS35/OB65/MF6/MS12/H8/SL2/TP1`
- 周级增加 `W7_HIGH_SWITCH_STRONG_SWING_WEEK`:
  - `RP5/OS32/OB65/MF4/MS12/H6/SL2/TP1.5`

同时修复了训练侧 trades 批次写入问题：

- [train.ts](/Users/ts-changchang.zhuang/git/money/train/src/scripts/train.ts)
- 同一轮训练现在会共享同一个 `created_at`
- `router-validate` 不会再因为策略间时间戳相差 1 秒而把一部分策略误判成 `0`

## v5 vs v6

| 月份 | v5 Router | v6 Router | 改善值 |
| --- | ---: | ---: | ---: |
| 2024-08 | -1035.87 | 111.45 | +1147.32 |
| 2025-10 | 8824.64 | 8824.64 | 0.00 |
| 2025-11 | 1570.63 | 1570.63 | 0.00 |
| 2025-12 | 638.53 | 638.53 | 0.00 |

四个月合计：

- `v5`: `9997.93`
- `v6`: `11145.25`
- 改善: `+1147.32`

## 结论

- `v6` 成功把 `2024-08` 从负收益拉到微正:
  - `-1035.87 -> +111.45`
- `2025-10 / 2025-11 / 2025-12` 完全保住了 `v5` 的收益结构，没有被新补丁破坏。
- 所以当前最合理的主版本已经从 `v5` 升级为 `v6`。

## 为什么 v6 有效

### 1. 2024-W31 / W35 不再落回通用 fallback

`v5` 里这两段主要落到通用 fallback，上下文不足。

`v6` 改成月级高切换 crash fallback 后：

- `2024-W31`: `-548.15 -> -346.79`
- `2024-W35`: `-252.46 -> +142.41`

这说明高切换月边缘 crash 周，确实更适合专用的 `RP5/OS35/OB65/MF6/MS12/H8/SL2/TP1`。

### 2. 2024-W34 强趋势周被单独拎出来

`2024-W34` 原来更像 high-switch strong swing，而不是通用 strong-clean。

`v6` 用 `W7_HIGH_SWITCH_STRONG_SWING_WEEK` 后：

- `2024-W34`: `-681.43 -> -130.34`

虽然还没完全翻正，但大幅收敛了错配。

### 3. 其余关键月没被打扰

`v6` 只新增了高切换月专用补丁，因此三个月关键收益没有变化：

- `2025-10`: 仍为 `8824.64`
- `2025-11`: 仍为 `1570.63`
- `2025-12`: 仍为 `638.53`

这说明补丁是“局部增益”，不是重新打乱全局 router。

## 当前推荐

如果现在要给 BTCJPY 选主路由版本，建议用：

- [BTCJPY_dual_year_router_v6.json](/Users/ts-changchang.zhuang/git/money/train/configs/generated/regime-routing/BTCJPY_dual_year_router_v6.json)

对应结果报告：

- [2024-08](/Users/ts-changchang.zhuang/git/money/train/reports/regime-routing-results/BTCJPY_dual_year_v6_2024-08-01_to_2024-08-31.md)
- [2025-10](/Users/ts-changchang.zhuang/git/money/train/reports/regime-routing-results/BTCJPY_dual_year_v6_2025-10-01_to_2025-10-31.md)
- [2025-11](/Users/ts-changchang.zhuang/git/money/train/reports/regime-routing-results/BTCJPY_dual_year_v6_2025-11-01_to_2025-11-30.md)
- [2025-12](/Users/ts-changchang.zhuang/git/money/train/reports/regime-routing-results/BTCJPY_dual_year_v6_2025-12-01_to_2025-12-31.md)

## 下一步最值得做的事

1. 把 `2024-W33` 这种 fake-rich 但只是轻微负的小噪声周，再做更细的 `0.25 -> 0.5` 风险优化。
2. 把 `event segment -> router policy` 进一步做成可机读 JSON，而不只是 markdown。
3. 如果后面要扩到 ETHJPY / SOLJPY，可以沿用 `v6` 的结构，优先复制：
   - crash 四分法
   - range-rich / fake-rich 二分法
   - high-switch month fallback
