const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  listMarketFeatureScenarios,
  computeScenarioCoverage,
} = require('../dist/ut/market-feature-scenarios.js');

test('market feature scenario suite covers all core daily market buckets', () => {
  const scenarios = listMarketFeatureScenarios();
  const daily = new Set();
  const weekly = new Set();
  const monthly = new Set();

  for (const scenario of scenarios) {
    const coverage = computeScenarioCoverage(scenario, {
      openingWindowCount: 1,
      volBaselineLookback: 1,
    });
    coverage.dailyBuckets.forEach((item) => daily.add(item));
    coverage.weeklyBuckets.forEach((item) => weekly.add(item));
    coverage.monthlyBuckets.forEach((item) => monthly.add(item));
  }

  assert.deepEqual(Array.from(daily).sort(), [
    'crash-trend',
    'mixed-trend',
    'range-low-vol',
    'range-mid-vol',
    'strong-trend',
  ]);
  assert.ok(weekly.size >= 3);
  assert.ok(monthly.size >= 3);
});
