const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const { buildRollingArtifactPackage } = require('../dist/services/rolling-artifact-builder.js');

test('rolling artifact builder creates month week day mapping package from training data', () => {
  const strategyRows = [
    {
      strategy_name: 'alpha',
      strategy_type: 'rsi_macd',
      total_trades: 20,
      win_rate: 0.6,
      total_pnl: 5000,
      score: 90,
      parameters: {
        rsi: { oversold: 30, overbought: 70 },
        risk: { maxHoldMinutes: 6 },
        atr: { slMultiplier: 1.5, tpMultiplier: 1.2 }
      }
    },
    {
      strategy_name: 'beta',
      strategy_type: 'rsi_macd',
      total_trades: 20,
      win_rate: 0.55,
      total_pnl: 4200,
      score: 80,
      parameters: {
        rsi: { oversold: 35, overbought: 65 },
        risk: { maxHoldMinutes: 8 },
        atr: { slMultiplier: 2, tpMultiplier: 1.5 }
      }
    }
  ];

  const trades = [
    { strategy_name: 'alpha', exit_time: Date.parse('2025-01-03T03:00:00.000Z'), pnl: 1200 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-01-03T03:00:00.000Z'), pnl: 200 },
    { strategy_name: 'alpha', exit_time: Date.parse('2025-01-10T03:00:00.000Z'), pnl: -200 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-01-10T03:00:00.000Z'), pnl: 900 },
    { strategy_name: 'alpha', exit_time: Date.parse('2025-02-05T03:00:00.000Z'), pnl: 1500 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-02-05T03:00:00.000Z'), pnl: -300 }
  ];

  const klines = [
    { open_time: Date.parse('2025-01-03T00:00:00.000Z'), open: 100, high: 102, low: 99, close: 101 },
    { open_time: Date.parse('2025-01-03T00:01:00.000Z'), open: 101, high: 103, low: 100, close: 102 },
    { open_time: Date.parse('2025-01-10T00:00:00.000Z'), open: 102, high: 103, low: 100, close: 101 },
    { open_time: Date.parse('2025-01-10T00:01:00.000Z'), open: 101, high: 101.5, low: 99, close: 100 },
    { open_time: Date.parse('2025-02-05T00:00:00.000Z'), open: 100, high: 104, low: 99, close: 103 },
    { open_time: Date.parse('2025-02-05T00:01:00.000Z'), open: 103, high: 105, low: 102, close: 104 }
  ];

  const result = buildRollingArtifactPackage({
    topN: 2,
    strategyRows,
    trades,
    klines
  });

  assert.ok(result.explicitStrategies.length >= 1);
  assert.ok(result.monthlyPools.length >= 1);
  assert.ok(result.monthlyRules.length >= 1);
  assert.ok(result.weeklyRules.length >= 1);
  assert.ok(result.dailyRules.length >= 1);
  assert.ok(result.routerRules.length >= result.monthlyRules.length);
  assert.equal(typeof result.defaultStrategyKey, 'string');
});
