const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  resolveEvaluationTimeRange,
  resolveExecutionTimeRange,
  narrowBacktestResultToEvaluationRange,
} = require('../dist/services/validation-range.js');

test('validation range resolves execution and evaluation windows independently', () => {
  const config = {
    timeRange: {
      startTimeMs: Date.parse('2024-12-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2025-01-31T23:59:00.000Z'),
    },
    validationTarget: {
      startTimeMs: Date.parse('2025-01-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2025-01-31T23:59:00.000Z'),
    },
  };

  const execution = resolveExecutionTimeRange(config);
  const evaluation = resolveEvaluationTimeRange(config);

  assert.equal(execution.startTimeMs, Date.parse('2024-12-01T00:00:00.000Z'));
  assert.equal(evaluation.startTimeMs, Date.parse('2025-01-01T00:00:00.000Z'));
  assert.equal(evaluation.endTimeMs, Date.parse('2025-01-31T23:59:00.000Z'));
});

test('validation range narrows backtest result stats to evaluation window only', () => {
  const result = {
    stats: {
      totalTrades: 3,
      grossPnl: 130,
      totalCommission: 10,
      totalPnl: 120,
      returnPct: 0.012,
      winRate: 2 / 3,
      avgPnl: 40,
      maxDrawdown: 20,
      maxDrawdownPct: 0.002,
      sharpeRatio: 1,
      avgWin: 70,
      avgLoss: -20,
      profitFactor: 7,
      score: 1,
    },
    trades: [
      { exit_time: Date.parse('2024-12-31T12:00:00.000Z'), pnl: 100, gross_pnl: 100, commission_fee: 0 },
      { exit_time: Date.parse('2025-01-02T12:00:00.000Z'), pnl: -20, gross_pnl: -10, commission_fee: 10 },
      { exit_time: Date.parse('2025-01-03T12:00:00.000Z'), pnl: 40, gross_pnl: 40, commission_fee: 0 },
    ],
  };

  const scoped = narrowBacktestResultToEvaluationRange(result, {
    startTimeMs: Date.parse('2025-01-01T00:00:00.000Z'),
    endTimeMs: Date.parse('2025-01-31T23:59:00.000Z'),
  }, 1_000_000);

  assert.equal(scoped.stats.totalTrades, 2);
  assert.equal(scoped.stats.totalPnl, 20);
  assert.equal(scoped.stats.grossPnl, 30);
  assert.equal(scoped.stats.totalCommission, 10);
  assert.equal(scoped.trades.length, 2);
});
