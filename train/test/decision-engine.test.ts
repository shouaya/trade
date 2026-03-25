const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  cloneDefaultFeatureEngineeringConfig,
  getDecisionFeatureEngineeringConfig,
  choosePeriodAction,
  decideDailyAction,
  summarizeAggregateAction,
} = require('../dist/services/decision-engine.js');

test('decision engine normalizes feature engineering config and keeps clone isolated', () => {
  const cloned = cloneDefaultFeatureEngineeringConfig();
  cloned.routerSplit.metrics = ['customMetric'];

  const fresh = cloneDefaultFeatureEngineeringConfig();
  assert.deepEqual(fresh.routerSplit.metrics, [
    'trendEfficiency',
    'volExpansionRatio',
    'openingImpulse',
    'reversalStrength',
    'positiveStrategyRatio',
    'bestVsMedianGap',
    'monthlyWeeklyAlignment',
    'weeklyDailyAlignment',
  ]);

  const parsed = getDecisionFeatureEngineeringConfig({
    openingWindowMinutes: 30,
    volBaselineLookbackPeriods: 4,
    routerSplit: {
      enabled: true,
      minSamplesPerBranch: 1,
      metrics: ['trendEfficiency', 'openingImpulse'],
    },
    routerDecision: {
      periodAction: {
        stopAtOrBelowPnl: -100,
        reduceBelowPnl: 50,
        reduceRisk: 0.5,
        tradeRisk: 1,
      },
      dailyAction: {
        stopAtOrBelowBestPnl: -20,
        minEdgeVsWeekBaseAbsolute: 10,
        minEdgeVsWeekBaseRatio: 1.1,
        reduceRisk: 0.4,
        tradeRisk: 1,
        preferWeekBaseOnReduce: true,
      },
      aggregateAction: {
        stopShareThreshold: 0.6,
        reduceShareThreshold: 0.4,
        normalizeStopToReduceForNonLossCheck: true,
        minimumReducedRisk: 0.35,
      },
      lossRecheckAction: {
        stopAtOrBelowCurrentPnl: -30,
        reduceAtOrBelowCurrentPnl: 0,
        reduceRisk: 0.45,
        tradeRisk: 1,
      },
    },
  });

  assert.equal(parsed.openingWindowMinutes, 30);
  assert.equal(parsed.routerSplit.minSamplesPerBranch, 1);
  assert.deepEqual(parsed.routerSplit.metrics, ['trendEfficiency', 'openingImpulse']);
  assert.throws(
    () => getDecisionFeatureEngineeringConfig({ openingWindowMinutes: 0, volBaselineLookbackPeriods: 1, routerSplit: {}, routerDecision: {} }),
    /featureEngineering\.openingWindowMinutes must be a positive integer/
  );
});

test('decision engine resolves period daily and aggregate actions', () => {
  const config = getDecisionFeatureEngineeringConfig(cloneDefaultFeatureEngineeringConfig()).routerDecision;

  assert.deepEqual(choosePeriodAction(-600, config), { type: 'stop', risk: 0 });
  assert.deepEqual(choosePeriodAction(-10, config), { type: 'reduce', risk: 0.85 });
  assert.deepEqual(choosePeriodAction(50, config), { type: 'trade', risk: 1 });

  assert.deepEqual(decideDailyAction({
    bestPnl: -300,
    weekBasePnl: 0,
    bestStrategyName: 'best',
    weekBaseStrategyName: 'week',
    monthPrimaryStrategyName: 'month',
  }, config), {
    actionType: 'stop',
    riskMultiplier: 0,
    selectedStrategyName: null,
  });

  assert.deepEqual(decideDailyAction({
    bestPnl: 10,
    weekBasePnl: 20,
    bestStrategyName: 'best',
    weekBaseStrategyName: 'week',
    monthPrimaryStrategyName: 'month',
  }, {
    ...config,
    dailyAction: {
      ...config.dailyAction,
      preferWeekBaseOnReduce: true,
    },
  }), {
    actionType: 'reduce',
    riskMultiplier: 0.85,
    selectedStrategyName: 'week',
  });

  assert.deepEqual(decideDailyAction({
    bestPnl: 80,
    weekBasePnl: 30,
    bestStrategyName: 'best',
    weekBaseStrategyName: 'week',
    monthPrimaryStrategyName: 'month',
  }, config), {
    actionType: 'trade',
    riskMultiplier: 1,
    selectedStrategyName: 'best',
  });

  assert.deepEqual(summarizeAggregateAction({
    layer: 'monthly_guard',
    stopShare: 0.8,
    reduceShare: 0.1,
    averageRisk: 0.1,
  }, {
    ...config,
    aggregateAction: {
      ...config.aggregateAction,
      normalizeStopToReduceForNonLossCheck: true,
      minimumReducedRisk: 0.25,
    },
  }), {
    actionType: 'reduce',
    averageRisk: 0.25,
  });

  assert.deepEqual(summarizeAggregateAction({
    layer: 'loss_recheck',
    stopShare: 0.9,
    reduceShare: 0.1,
    averageRisk: 0.2,
  }, config), {
    actionType: 'stop',
    averageRisk: 0.2,
  });
});
