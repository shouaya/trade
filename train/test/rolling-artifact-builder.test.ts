const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  buildRollingArtifactPackage,
  normalizeLayerSummary,
} = require('../dist/services/rolling-artifact-builder.js');

function createFeatureEngineering(overrides = {}) {
  const base = {
    openingWindowMinutes: 1,
    volBaselineLookbackPeriods: 1,
    routerDecision: {
      periodAction: {
        stopAtOrBelowPnl: -500,
        reduceBelowPnl: 0,
        reduceRisk: 0.85,
        tradeRisk: 1,
      },
      dailyAction: {
        stopAtOrBelowBestPnl: -200,
        minEdgeVsWeekBaseAbsolute: 0,
        minEdgeVsWeekBaseRatio: 1,
        reduceRisk: 0.85,
        tradeRisk: 1,
        preferWeekBaseOnReduce: false,
      },
      aggregateAction: {
        stopShareThreshold: 0.67,
        reduceShareThreshold: 0.67,
        normalizeStopToReduceForNonLossCheck: false,
        minimumReducedRisk: 0.25,
      },
      lossRecheckAction: {
        stopAtOrBelowCurrentPnl: -200,
        reduceAtOrBelowCurrentPnl: 0,
        reduceRisk: 0.85,
        tradeRisk: 1,
      },
    },
    routerSplit: {
      enabled: true,
      minSamplesPerBranch: 2,
      metrics: [
        'trendEfficiency',
        'volExpansionRatio',
        'openingImpulse',
        'reversalStrength',
        'positiveStrategyRatio',
        'bestVsMedianGap',
        'monthlyWeeklyAlignment',
        'weeklyDailyAlignment',
      ],
    },
  };

  return {
    ...base,
    ...overrides,
    routerDecision: {
      ...base.routerDecision,
      ...(overrides.routerDecision || {}),
      periodAction: {
        ...base.routerDecision.periodAction,
        ...((overrides.routerDecision && overrides.routerDecision.periodAction) || {}),
      },
      dailyAction: {
        ...base.routerDecision.dailyAction,
        ...((overrides.routerDecision && overrides.routerDecision.dailyAction) || {}),
      },
      aggregateAction: {
        ...base.routerDecision.aggregateAction,
        ...((overrides.routerDecision && overrides.routerDecision.aggregateAction) || {}),
      },
      lossRecheckAction: {
        ...base.routerDecision.lossRecheckAction,
        ...((overrides.routerDecision && overrides.routerDecision.lossRecheckAction) || {}),
      },
    },
    routerSplit: {
      ...base.routerSplit,
      ...(overrides.routerSplit || {}),
    },
  };
}

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
    klines,
    featureEngineering: createFeatureEngineering()
  });

  assert.ok(result.explicitStrategies.length >= 1);
  assert.ok(result.monthlyPools.length >= 1);
  assert.ok(result.monthlyRules.length >= 1);
  assert.ok(result.weeklyRules.length >= 1);
  assert.ok(result.dailyRules.length >= 1);
  assert.ok(result.weeklyRules.some((rule) => rule.action && rule.action.strategyKey), 'weekly rules should inherit a real strategy from the mapped month pool');
  assert.ok(result.routerRules.length >= result.monthlyRules.length);
  assert.equal(typeof result.defaultStrategyKey, 'string');
});

test('rolling artifact builder respects routerSplit featureEngineering defaults', () => {
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
    { strategy_name: 'alpha', exit_time: Date.parse('2025-01-03T03:00:00.000Z'), pnl: 1000 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-01-03T03:00:00.000Z'), pnl: -100 },
    { strategy_name: 'alpha', exit_time: Date.parse('2025-01-04T03:00:00.000Z'), pnl: 800 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-01-04T03:00:00.000Z'), pnl: -50 },
    { strategy_name: 'alpha', exit_time: Date.parse('2025-01-05T03:00:00.000Z'), pnl: 50 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-01-05T03:00:00.000Z'), pnl: 900 },
    { strategy_name: 'alpha', exit_time: Date.parse('2025-01-06T03:00:00.000Z'), pnl: 100 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-01-06T03:00:00.000Z'), pnl: 1000 }
  ];

  const klines = [
    { open_time: Date.parse('2025-01-03T00:00:00.000Z'), open: 100, high: 101.5, low: 99.8, close: 101 },
    { open_time: Date.parse('2025-01-03T00:01:00.000Z'), open: 101, high: 101.6, low: 100.8, close: 101.2 },
    { open_time: Date.parse('2025-01-04T00:00:00.000Z'), open: 100, high: 101.3, low: 99.9, close: 100.9 },
    { open_time: Date.parse('2025-01-04T00:01:00.000Z'), open: 100.9, high: 101.4, low: 100.7, close: 101.1 },
    { open_time: Date.parse('2025-01-05T00:00:00.000Z'), open: 100, high: 100.7, low: 99.7, close: 100.2 },
    { open_time: Date.parse('2025-01-05T00:01:00.000Z'), open: 100.2, high: 101.2, low: 100.1, close: 101.1 },
    { open_time: Date.parse('2025-01-06T00:00:00.000Z'), open: 100, high: 100.6, low: 99.8, close: 100.1 },
    { open_time: Date.parse('2025-01-06T00:01:00.000Z'), open: 100.1, high: 101.3, low: 100, close: 101.2 }
  ];

  const splitEnabled = buildRollingArtifactPackage({
    topN: 2,
    strategyRows,
    trades,
    klines,
    featureEngineering: createFeatureEngineering({
      routerSplit: {
        enabled: true,
        minSamplesPerBranch: 2,
        metrics: ['positiveStrategyRatio']
      }
    })
  });

  assert.ok(splitEnabled.dailyRules.length > 0);
  assert.ok(splitEnabled.routerRules.every((rule) => {
    const when = rule.when || {};
    return !when.trendEfficiency
      && !when.volExpansionRatio
      && !when.openingImpulse
      && !when.reversalStrength
      && !when.bestVsMedianGap
      && !when.monthlyWeeklyAlignment
      && !when.weeklyDailyAlignment;
  }));

  const splitDisabled = buildRollingArtifactPackage({
    topN: 2,
    strategyRows,
    trades,
    klines,
    featureEngineering: createFeatureEngineering({
      routerSplit: {
        enabled: false
      }
    })
  });

  assert.ok(splitDisabled.routerRules.every((rule) => !(rule.when && rule.when.positiveStrategyRatio)));
});

test('rolling artifact builder keeps non-loss stop summaries untouched when aggregate normalization is disabled', () => {
  const config = createFeatureEngineering().routerDecision;
  const weeklySummary = normalizeLayerSummary('weekly_guard', {
    actionType: 'stop',
    averageRisk: 0,
    dominantStrategy: 'alpha',
    sampleCount: 5,
  }, config);

  assert.equal(weeklySummary.actionType, 'stop');
  assert.equal(weeklySummary.averageRisk, 0);
  assert.equal(weeklySummary.dominantStrategy, 'alpha');

  const monthlySummary = normalizeLayerSummary('monthly_guard', {
    actionType: 'stop',
    averageRisk: 0,
    dominantStrategy: 'alpha',
    sampleCount: 5,
  }, config);

  assert.equal(monthlySummary.actionType, 'stop');
  assert.equal(monthlySummary.averageRisk, 0);

  const dailySummary = normalizeLayerSummary('daily_router', {
    actionType: 'stop',
    averageRisk: 0,
    dominantStrategy: 'alpha',
    sampleCount: 5,
  }, config);

  assert.equal(dailySummary.actionType, 'stop');
  assert.equal(dailySummary.averageRisk, 0);

  const lossSummary = normalizeLayerSummary('loss_recheck', {
    actionType: 'stop',
    averageRisk: 0,
    dominantStrategy: 'alpha',
    sampleCount: 5,
  }, config);

  assert.equal(lossSummary.actionType, 'stop');
  assert.equal(lossSummary.averageRisk, 0);
});

test('rolling artifact builder requires explicit feature engineering decision config', () => {
  assert.throws(() => buildRollingArtifactPackage({
    topN: 1,
    strategyRows: [],
    trades: [],
    klines: [],
  }), /featureEngineering is required/);
});
