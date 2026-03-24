const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  assertUtFeatureBaseline,
} = require('../dist/ut/ut-feature-baselines.js');

test('ut feature baseline accepts rolling-regime-shift when core business thresholds are met', () => {
  const result = assertUtFeatureBaseline({
    scenarioKey: 'rolling-regime-shift',
    coverage: {
      dailyBuckets: ['range-low-vol', 'strong-trend', 'crash-trend', 'mixed-trend'],
      weeklyBuckets: ['range-low-vol', 'strong-trend', 'crash-trend'],
      monthlyBuckets: ['range-low-vol', 'strong-trend', 'mixed-trend'],
    },
    validationConfigCount: 4,
    routerRuleCount: 12,
    routerTradedDays: 8,
    routerTotalPnl: 1200,
    pipelineStepCount: 10,
  });

  assert.equal(result.checks.length >= 10, true);
});

test('ut feature baseline rejects rolling-regime-shift when router degenerates to zero trades', () => {
  assert.throws(() => assertUtFeatureBaseline({
    scenarioKey: 'rolling-regime-shift',
    coverage: {
      dailyBuckets: ['range-low-vol', 'strong-trend', 'crash-trend', 'mixed-trend'],
      weeklyBuckets: ['range-low-vol', 'strong-trend', 'crash-trend'],
      monthlyBuckets: ['range-low-vol', 'strong-trend', 'mixed-trend'],
    },
    validationConfigCount: 4,
    routerRuleCount: 12,
    routerTradedDays: 0,
    routerTotalPnl: 0,
    pipelineStepCount: 10,
  }), /router must trade at least one day/);
});
