const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  buildLaggedFeatureMap,
  buildOpeningWindowPeriodFeatures,
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

test('rolling features can build causal opening-window features and lagged lookup maps', () => {
  const klines = [
    { open_time: Date.parse('2025-01-03T00:00:00.000Z'), open: 100, high: 101, low: 99.5, close: 101 },
    { open_time: Date.parse('2025-01-03T00:01:00.000Z'), open: 101, high: 108, low: 100.5, close: 106 },
    { open_time: Date.parse('2025-01-04T00:00:00.000Z'), open: 106, high: 106.5, low: 105.5, close: 106.2 },
    { open_time: Date.parse('2025-01-04T00:01:00.000Z'), open: 106.2, high: 107, low: 99, close: 100 },
    { open_time: Date.parse('2025-01-05T00:00:00.000Z'), open: 100, high: 100.4, low: 99.8, close: 100.1 },
    { open_time: Date.parse('2025-01-05T00:01:00.000Z'), open: 100.1, high: 101, low: 99.9, close: 100.8 },
  ];

  const openingFeatures = buildOpeningWindowPeriodFeatures(klines, getJstDayKey, detectDailyFeatureBucket, {
    openingWindowCount: 1,
    volBaselineLookback: 1,
  });

  assert.equal(openingFeatures.length, 3);
  assert.equal(openingFeatures[1].returnPct, 0.19);
  assert.equal(openingFeatures[1].featureBucket, 'range-low-vol');

  const lagged = buildLaggedFeatureMap(openingFeatures);
  assert.equal(lagged.get('2025-01-04')?.key, '2025-01-03');
  assert.equal(lagged.get('2025-01-05')?.key, '2025-01-04');
});
