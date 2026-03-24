const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  buildPeriodFeatures,
  detectDailyFeatureBucket,
  getJstDayKey,
} = require('../dist/services/rolling-features.js');

test('rolling features honor custom opening window and volatility lookback defaults', () => {
  const klines = [
    { open_time: Date.parse('2025-01-03T00:00:00.000Z'), open: 100, high: 103, low: 100, close: 102 },
    { open_time: Date.parse('2025-01-03T00:01:00.000Z'), open: 102, high: 102, low: 100, close: 101 },
    { open_time: Date.parse('2025-01-04T00:00:00.000Z'), open: 101, high: 106, low: 100, close: 105 },
    { open_time: Date.parse('2025-01-04T00:01:00.000Z'), open: 105, high: 105, low: 98, close: 99 },
  ];

  const features = buildPeriodFeatures(klines, getJstDayKey, detectDailyFeatureBucket, {
    openingWindowCount: 1,
    volBaselineLookback: 1,
  });

  assert.equal(features.length, 2);

  const day1 = features[0];
  const day2 = features[1];
  assert.ok(day1);
  assert.ok(day2);

  assert.equal(day1.openingImpulse, 2);
  assert.equal(day1.returnPct, 1);
  assert.ok(day1.reversalStrength > 0);

  assert.equal(day1.volExpansionRatio, 1);
  assert.ok(day2.volExpansionRatio > 1);
  assert.ok(day2.realizedVolPct > day1.realizedVolPct);
});
