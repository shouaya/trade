const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  buildDefaultTrainingTemplate,
  buildTrainingGuideBootstrap,
  buildTrainingGuideDraft,
  buildTrainingConfigFromGuide,
  normalizeValidationProfile,
} = require('../dist/services/training-management.js');

test('training management bootstrap returns API-ready default guide state', () => {
  const now = new Date('2026-03-24T00:00:00.000Z');
  const bootstrap = buildTrainingGuideBootstrap(now, {
    symbol: 'BTCJPY',
    intervalType: '1min',
    minOpenTime: Date.parse('2024-01-15T00:00:00.000Z'),
    maxOpenTime: Date.parse('2026-03-19T23:59:00.000Z'),
  });

  assert.equal(bootstrap.configKey, 'configs/training/2024_btcjpy_v7_hf_rsi_macd_tp_atr.json');
  assert.equal(bootstrap.draft.year, '2024');
  assert.equal(bootstrap.draft.symbol, 'BTCJPY');
  assert.equal(bootstrap.draft.startDate, '2024-04-01');
  assert.equal(bootstrap.draft.endDate, '2026-03-19');
  assert.equal(bootstrap.draft.validationStartDate, '2024-04-01');
  assert.equal(bootstrap.draft.validationEndDate, '2026-03-19');
  assert.equal(bootstrap.draft.validationProfile, 'rolling-window');
  assert.equal(bootstrap.content.featureEngineering.openingWindowMinutes, 60);
  assert.equal(bootstrap.content.featureEngineering.volBaselineLookbackPeriods, 8);
  assert.equal(bootstrap.content.featureEngineering.routerDecision.periodAction.stopAtOrBelowPnl, -500);
  assert.equal(bootstrap.content.featureEngineering.routerDecision.periodAction.reduceBelowPnl, 0);
  assert.equal(bootstrap.content.featureEngineering.routerDecision.dailyAction.minEdgeVsWeekBaseAbsolute, 0);
  assert.equal(bootstrap.content.featureEngineering.routerDecision.dailyAction.preferWeekBaseOnReduce, false);
  assert.equal(bootstrap.content.featureEngineering.routerDecision.aggregateAction.normalizeStopToReduceForNonLossCheck, false);
  assert.equal(bootstrap.content.featureEngineering.routerDecision.lossRecheckAction.reduceAtOrBelowCurrentPnl, 0);
  assert.equal(bootstrap.content.featureEngineering.routerSplit.enabled, true);
  assert.deepEqual(bootstrap.content.featureEngineering.routerSplit.metrics, [
    'trendEfficiency',
    'volExpansionRatio',
    'openingImpulse',
    'reversalStrength',
    'positiveStrategyRatio',
    'bestVsMedianGap',
    'monthlyWeeklyAlignment',
    'weeklyDailyAlignment',
  ]);
  assert.ok(Array.isArray(bootstrap.recommendations));
  assert.ok(bootstrap.recommendations.length > 0);
  assert.ok(Array.isArray(bootstrap.validationProfiles));
  assert.ok(Array.isArray(bootstrap.options.trainingYears));
});

test('training management preview builds config from guide draft', () => {
  const now = new Date('2026-03-24T00:00:00.000Z');
  const base = buildDefaultTrainingTemplate(now);
  const preview = buildTrainingConfigFromGuide(
    {
      year: '2025',
      symbol: 'BTCJPY',
      runTag: 'alpha_one',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      intervalType: '5min',
      topN: 20,
      strategyTypes: 'rsi_macd',
      lotSize: '0.02',
      maxHoldMin: '4',
      maxHoldMax: '10',
      tradingSchedule: '* 8-16 * * 1-5',
      tableName: 'btcjpy_alpha_one_train_2025',
      routerConfigPath: 'configs/generated/regime-routing/btc_router.json',
      validationProfile: 'custom-range',
      validationStartDate: '2026-01-01',
      validationEndDate: '2026-01-31',
    },
    base,
    now
  );

  assert.equal(preview.configKey, 'configs/training/2025_btcjpy_alpha_one.json');
  assert.equal(preview.recommendedTableName, 'btcjpy_alpha_one_train_2025');
  assert.equal(preview.content.name, '2025_BTCJPY_ALPHA_ONE');
  assert.equal(preview.content.market.intervalType, '5min');
  assert.equal(preview.content.database.tableName, 'btcjpy_alpha_one_train_2025');
  assert.deepEqual(preview.content.strategy.parameters.risk.lotSize, [0.02]);
  assert.deepEqual(preview.content.strategy.parameters.risk.maxHoldMinutes, [4, 10]);
  assert.equal(preview.content.validationPlan.profile, 'custom-range');
  assert.equal(preview.content.regimeRouting.routerConfigPath, 'configs/generated/regime-routing/btc_router.json');
});

test('training management draft hydrates from saved config and normalizes validation profile', () => {
  const content = {
    name: '2024_BTCJPY_SAMPLE_TAG',
    timeRange: {
      startIso: '2024-01-01T00:00:00.000Z',
      endIso: '2024-12-31T23:59:00.000Z',
    },
    market: {
      symbol: 'BTCJPY',
      intervalType: '1min',
    },
    database: {
      tableName: 'sample_train_2024',
    },
    strategy: {
      types: ['rsi_macd'],
      parameters: {
        risk: {
          lotSize: [0.008],
          maxHoldMinutes: [6, 8],
        },
        tradingSchedule: '* 12-18 * * 1-5',
      },
    },
    validationPlan: {
      profile: 'unknown-profile',
    },
  };

  const draft = buildTrainingGuideDraft(content, 'configs/training/2024_btcjpy_sample_tag.json', new Date('2026-03-24T00:00:00.000Z'));
  assert.equal(draft.runTag, 'SAMPLE_TAG');
  assert.equal(draft.validationProfile, 'rolling-window');
  assert.equal(normalizeValidationProfile('rolling-window'), 'rolling-window');
});
