const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  loadMonthlyCandidatePoolsFromFeatureMemory,
} = require('../dist/services/feature-memory-runtime.js');

test('feature memory runtime loads monthly candidate pools ordered by rank', async () => {
  const db = {
    async query(sql, params = []) {
      const text = String(sql);
      assert.match(text, /FROM feature_candidate_pools/);
      assert.equal(params[0], 'BTCJPY');
      assert.equal(params[1], 'train-runtime-1');
      assert.equal(params[2], 'train-runtime-1');
      return [[
        {
          window_start_ms: Date.parse('2025-01-01T00:00:00.000Z'),
          rank_no: 1,
          strategy_name: 'alpha',
        },
        {
          window_start_ms: Date.parse('2025-01-01T00:00:00.000Z'),
          rank_no: 2,
          strategy_name: 'beta',
        },
        {
          window_start_ms: Date.parse('2025-02-01T00:00:00.000Z'),
          rank_no: 1,
          strategy_name: 'gamma',
        },
      ], {}];
    },
  };

  const monthMap = await loadMonthlyCandidatePoolsFromFeatureMemory(db, {
    symbol: 'BTCJPY',
    trainId: 'train-runtime-1',
  });

  assert.deepEqual(monthMap.get('2025-01'), ['alpha', 'beta']);
  assert.deepEqual(monthMap.get('2025-02'), ['gamma']);
});
