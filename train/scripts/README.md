# Scripts

当前 `train/scripts/` 只保留训练主链路仍会直接调用的配套脚本：

- `generate-top3-validation-configs.js`

训练入口、数据库初始化、队列 worker、配置同步等正式运行脚本已经统一放在 `train/src/scripts/` 并通过 `npm run ...` 调用。
分析/探索/报表类脚本已从这里移除，避免和训练主链路混在一起。
