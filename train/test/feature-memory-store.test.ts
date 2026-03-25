const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  ANALYSIS_ARTIFACTS_TABLE,
  FEATURE_CANDIDATE_POOLS_TABLE,
  FEATURE_MEMORIES_TABLE,
  FEATURE_WRITEBACKS_TABLE,
  MARKET_WINDOWS_TABLE,
  STRATEGY_DEFINITIONS_TABLE,
  STRATEGY_LIBRARY_MEMBERS_TABLE,
  STRATEGY_PARAMETER_SETS_TABLE,
  TRAIN_RUNS_TABLE,
  WINDOW_BEST_ACTIONS_TABLE,
  WINDOW_STRATEGY_EVALUATIONS_TABLE,
} = require('@money/database');
const { saveRollingFeatureMemory } = require('../dist/services/feature-memory-store.js');

test('feature memory store persists rolling knowledge assets into new schema tables', async () => {
  const queries = [];
  let insertId = 100;
  const db = {
    async query(sql, params = []) {
      const text = String(sql);
      queries.push({ sql: text, params });

      if (text.startsWith('CREATE TABLE IF NOT EXISTS')) {
        return [[], {}];
      }

      if (text.includes('INSERT INTO')) {
        return [{ insertId: insertId++ }, {}];
      }

      return [[], {}];
    },
  };

  await saveRollingFeatureMemory(db, {
    runKey: 'rolling:BTCJPY:demo:001',
    trainId: 'train-demo-001',
    symbol: 'BTCJPY',
    intervalType: '1min',
    trainConfigKey: 'configs/training/demo.json',
    trainConfigName: 'BTCJPY_DEMO',
    strategyCatalog: [
      {
        rank: 1,
        name: 'GMOCOIN-alpha',
        type: 'rsi_macd',
        parameters: {
          rsi: { period: 2, oversold: 60, overbought: 80 },
          atr: { slMultiplier: 1.5, tpMultiplier: 1.5 },
        },
        totalTrades: 18,
        totalPnl: 3200,
        returnPct: 3.2,
        score: 88.5,
      },
      {
        rank: 2,
        name: 'GMOCOIN-beta',
        type: 'rsi_macd',
        parameters: {
          rsi: { period: 2, oversold: 58, overbought: 82 },
          atr: { slMultiplier: 2, tpMultiplier: 1.5 },
        },
        totalTrades: 17,
        totalPnl: 1200,
        returnPct: 1.2,
        score: 76.1,
      },
    ],
    monthlySnapshots: [
      {
        validationMonth: '2025-01',
        trainingWindow: {
          startTimeMs: Date.parse('2024-10-01T00:00:00.000Z'),
          endTimeMs: Date.parse('2024-12-31T23:59:00.000Z'),
        },
        monthFeature: {
          key: '2025-01',
          minutes: 120,
          realizedVolPct: 6.2,
          avgAbsReturnPct: 0.42,
          avgRangePct: 0.73,
          maxAbsReturnPct: 2.1,
          maxRangePct: 3.2,
          returnPct: 4.8,
          upMinuteRatio: 58,
          trendEfficiency: 0.62,
          volExpansionRatio: 1.18,
          openingImpulse: 0.91,
          reversalStrength: 0.33,
          featureBucket: 'strong-trend',
          positiveStrategyRatio: 100,
          bestVsMedianGap: 800,
        },
        explicitStrategies: [
          {
            rank: 1,
            name: 'GMOCOIN-alpha',
            type: 'rsi_macd',
            parameters: {
              rsi: { period: 2, oversold: 60, overbought: 80 },
              atr: { slMultiplier: 1.5, tpMultiplier: 1.5 },
            },
            totalTrades: 12,
            totalPnl: 2200,
            returnPct: 2.2,
            score: 91.2,
          },
          {
            rank: 2,
            name: 'GMOCOIN-beta',
            type: 'rsi_macd',
            parameters: {
              rsi: { period: 2, oversold: 58, overbought: 82 },
              atr: { slMultiplier: 2, tpMultiplier: 1.5 },
            },
            totalTrades: 10,
            totalPnl: 400,
            returnPct: 0.4,
            score: 73.4,
          },
        ],
        monthlyWinnerName: 'GMOCOIN-alpha',
        monthlyWinnerPnl: 2200,
        monthlyActionType: 'trade',
        monthlyRiskCap: 1,
      },
    ],
    weeklySamples: [
      {
        periodKey: '2025-W02',
        feature: {
          key: '2025-W02',
          minutes: 60,
          realizedVolPct: 3.1,
          avgAbsReturnPct: 0.21,
          avgRangePct: 0.44,
          maxAbsReturnPct: 1.3,
          maxRangePct: 1.7,
          returnPct: 1.4,
          upMinuteRatio: 55,
          trendEfficiency: 0.51,
          volExpansionRatio: 1.02,
          openingImpulse: 0.42,
          reversalStrength: 0.11,
          featureBucket: 'range-mid-vol',
          positiveStrategyRatio: 50,
          bestVsMedianGap: 120,
          monthlyWeeklyAlignment: 1,
        },
        selectedStrategyName: 'GMOCOIN-alpha',
        actionType: 'trade',
        riskValue: 1,
        avgPnl: 500,
      },
    ],
    dailySamples: [
      {
        periodKey: '2025-01-10',
        feature: {
          key: '2025-01-10',
          minutes: 15,
          realizedVolPct: 1.8,
          avgAbsReturnPct: 0.12,
          avgRangePct: 0.19,
          maxAbsReturnPct: 0.52,
          maxRangePct: 0.77,
          returnPct: -0.3,
          upMinuteRatio: 42,
          trendEfficiency: 0.22,
          volExpansionRatio: 0.91,
          openingImpulse: -0.4,
          reversalStrength: 0.16,
          featureBucket: 'range-low-vol',
          positiveStrategyRatio: 0,
          bestVsMedianGap: 30,
          weeklyDailyAlignment: 0.5,
        },
        selectedStrategyName: 'GMOCOIN-beta',
        actionType: 'reduce',
        riskValue: 0.8,
        avgPnl: -50,
      },
    ],
    routerRules: [
      {
        id: 'weekly_guard_range_mid_vol',
        layer: 'weekly_guard',
      },
    ],
    artifactPayload: {
      rollingPlan: {
        monthlyPools: [{ month: '2025-01', selectedStrategyName: 'GMOCOIN-alpha' }],
      },
    },
  });

  assert.ok(queries.some((entry) => entry.sql.includes(`INSERT INTO ${TRAIN_RUNS_TABLE}`)));
  assert.ok(queries.some((entry) => entry.sql.includes(`INSERT INTO ${STRATEGY_DEFINITIONS_TABLE}`)));
  assert.ok(queries.some((entry) => entry.sql.includes(`INSERT INTO ${STRATEGY_PARAMETER_SETS_TABLE}`)));
  assert.ok(queries.some((entry) => entry.sql.includes(`INSERT INTO ${STRATEGY_LIBRARY_MEMBERS_TABLE}`)));
  assert.ok(queries.some((entry) => entry.sql.includes(`INSERT INTO ${MARKET_WINDOWS_TABLE}`)));
  assert.ok(queries.some((entry) => entry.sql.includes(`INSERT INTO ${FEATURE_MEMORIES_TABLE}`)));
  assert.ok(queries.some((entry) => entry.sql.includes(`INSERT INTO ${FEATURE_CANDIDATE_POOLS_TABLE}`)));
  assert.ok(queries.some((entry) => entry.sql.includes(`INSERT INTO ${WINDOW_STRATEGY_EVALUATIONS_TABLE}`)));
  assert.ok(queries.some((entry) => entry.sql.includes(`INSERT INTO ${WINDOW_BEST_ACTIONS_TABLE}`)));
  assert.ok(queries.some((entry) => entry.sql.includes(`INSERT INTO ${FEATURE_WRITEBACKS_TABLE}`)));
  assert.ok(queries.some((entry) => entry.sql.includes(`INSERT INTO ${ANALYSIS_ARTIFACTS_TABLE}`)));

  const runInsert = queries.find((entry) => entry.sql.includes(`INSERT INTO ${TRAIN_RUNS_TABLE}`));
  assert.equal(runInsert.params[0], 'rolling:BTCJPY:demo:001');
  assert.equal(runInsert.params[1], 'BTCJPY');
  assert.equal(runInsert.params[3], 'rolling');
  assert.equal(runInsert.params[4], 'completed');

  const featureInsert = queries.find((entry) => entry.sql.includes(`INSERT INTO ${FEATURE_MEMORIES_TABLE}`));
  assert.equal(featureInsert.params[1], 'BTCJPY');
  assert.equal(featureInsert.params[2], 'rolling-feature-memory-v1');
  assert.equal(featureInsert.params[4], 'strong-trend');
  assert.deepEqual(JSON.parse(featureInsert.params[5]), {
    minutes: 120,
    realizedVolPct: 6.2,
    avgAbsReturnPct: 0.42,
    avgRangePct: 0.73,
    maxAbsReturnPct: 2.1,
    maxRangePct: 3.2,
    returnPct: 4.8,
    upMinuteRatio: 58,
    trendEfficiency: 0.62,
    volExpansionRatio: 1.18,
    openingImpulse: 0.91,
    reversalStrength: 0.33,
    positiveStrategyRatio: 100,
    bestVsMedianGap: 800,
    monthlyWeeklyAlignment: 0,
    weeklyDailyAlignment: 0,
  });
});
