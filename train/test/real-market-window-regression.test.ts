const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  buildPeriodFeatures,
  buildOpeningWindowPeriodFeatures,
  detectDailyFeatureBucket,
  getJstDayKey,
} = require('../dist/services/rolling-features.js');
const {
  loadRealMarketWindowFixtures,
} = require('../dist/ut/real-market-window-fixtures.js');

function assertFiniteFeatureSet(feature) {
  for (const key of [
    'returnPct',
    'realizedVolPct',
    'avgRangePct',
    'trendEfficiency',
    'volExpansionRatio',
    'openingImpulse',
    'reversalStrength',
  ]) {
    assert.equal(Number.isFinite(Number(feature[key])), true, `expected finite ${key}`);
  }
}

test('real market BTC windows produce stable daily/opening features without NaN drift', () => {
  const fixtures = loadRealMarketWindowFixtures();
  assert.ok(fixtures.length > 0, 'expected real market fixtures');

  for (const fixture of fixtures) {
    const daily = buildPeriodFeatures(
      fixture.klines,
      getJstDayKey,
      detectDailyFeatureBucket,
      {
        openingWindowCount: 60,
        volBaselineLookback: 3,
      }
    );
    const opening = buildOpeningWindowPeriodFeatures(
      fixture.klines,
      getJstDayKey,
      detectDailyFeatureBucket,
      {
        openingWindowCount: 60,
        volBaselineLookback: 3,
      }
    );

    assert.ok(daily.length >= 3, `expected multiple daily features for ${fixture.id}`);
    assert.equal(opening.length, daily.length, `expected aligned opening features for ${fixture.id}`);

    for (const feature of daily) {
      assert.ok(String(feature.featureBucket || '').trim().length > 0, `missing daily bucket for ${fixture.id}`);
      assertFiniteFeatureSet(feature);
    }

    for (const feature of opening) {
      assert.ok(String(feature.featureBucket || '').trim().length > 0, `missing opening bucket for ${fixture.id}`);
      assertFiniteFeatureSet(feature);
    }
  }
});
