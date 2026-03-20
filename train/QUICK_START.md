# Quick Start

```bash
cd train
npm install
npm run build
npm test
```

训练 2025：

```bash
npm run train -- configs/training/2025_btcjpy_hf_rsi_macd_tp_atr.json
```

验证 2024 / 2026：

```bash
npm run validate -- configs/validation/2025_btcjpy_v7_hf_rsi_macd_top10_exact_from_2025_2024_validation.json
npm run validate -- configs/validation/2025_btcjpy_v7_hf_rsi_macd_top10_exact_from_2025_2026_validation.json
```

路由验证：

```bash
npm run router:validate
```

当前只保留最新的 BTCJPY 高频 `RSI+MACD + ATR` 训练方式。
