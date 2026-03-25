const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  extractRollingMonthlyPools,
  loadLatestValidationRows,
  resolveValidationWindowRange,
} = require('../dist/scripts/goal-attainment-report.js');

test('goal attainment report resolves validation window range from config timeRange', () => {
  const range = resolveValidationWindowRange({
    timeRange: {
      startIso: '2024-04-01T00:00:00.000Z',
      endIso: '2024-04-30T23:59:00.000Z',
    },
  });

  assert.deepEqual(range, {
    startTimeMs: Date.parse('2024-04-01T00:00:00.000Z'),
    endTimeMs: Date.parse('2024-04-30T23:59:00.000Z'),
  });
  assert.equal(resolveValidationWindowRange({}), null);
});

test('goal attainment report loads latest validation rows by window instead of collapsing shared result group', async () => {
  const aprilWindow = {
    startTimeMs: Date.parse('2024-04-01T00:00:00.000Z'),
    endTimeMs: Date.parse('2024-04-30T23:59:00.000Z'),
  };
  const mayWindow = {
    startTimeMs: Date.parse('2024-05-01T00:00:00.000Z'),
    endTimeMs: Date.parse('2024-05-31T23:59:00.000Z'),
  };

  const db = {
    async query(sql, params = []) {
      const text = String(sql);

      if (text.includes('SELECT run_id')) {
        if (params[1] === aprilWindow.startTimeMs && params[2] === aprilWindow.endTimeMs) {
          return [[{ run_id: 'run-april' }], {}];
        }
        if (params[1] === mayWindow.startTimeMs && params[2] === mayWindow.endTimeMs) {
          return [[{ run_id: 'run-may' }], {}];
        }
        return [[], {}];
      }

      if (text.includes('SELECT strategy_name, total_pnl')) {
        if (params[1] === 'run-april') {
          return [[
            { strategy_name: 'alpha', total_pnl: 300, return_pct: 0.03, max_drawdown_pct: 0.4, score: 12, created_at: '2026-03-25T00:00:00.000Z' },
            { strategy_name: 'beta', total_pnl: 100, return_pct: 0.01, max_drawdown_pct: 0.5, score: 11, created_at: '2026-03-25T00:00:00.000Z' },
          ], {}];
        }
        if (params[1] === 'run-may') {
          return [[
            { strategy_name: 'gamma', total_pnl: -50, return_pct: -0.005, max_drawdown_pct: 0.6, score: 9, created_at: '2026-03-25T00:00:00.000Z' },
          ], {}];
        }
        return [[], {}];
      }

      throw new Error(`Unexpected SQL in goal-attainment-report test: ${text}`);
    },
  };

  const aprilRows = await loadLatestValidationRows(db, 'backtest_results_top10_btcjpy_rolling', aprilWindow);
  const mayRows = await loadLatestValidationRows(db, 'backtest_results_top10_btcjpy_rolling', mayWindow);

  assert.equal(aprilRows.length, 2);
  assert.equal(aprilRows[0].strategy_name, 'alpha');
  assert.equal(mayRows.length, 1);
  assert.equal(mayRows[0].strategy_name, 'gamma');
});

test('goal attainment report can extract monthly pools from feature-memory style rolling details', () => {
  const pools = extractRollingMonthlyPools({
    rollingDetails: {
      monthlyPools: [
        { month: '2025-01', selectedStrategyName: 'alpha' },
        { month: '2025-02', selectedStrategyName: 'beta' },
      ],
    },
  });

  assert.equal(pools.length, 2);
  assert.equal(pools[0].selectedStrategyName, 'alpha');
});
