const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  buildRetrievedCandidates,
  findHistoricalMemoryMatches,
  resolveFeatureMemoryLearningConfig,
  selectEvenlySpacedStrategies,
} = require('../dist/scripts/generate-validation-artifacts.js');

test('feature-memory learning config uses defaults and accepts overrides', () => {
  const defaults = resolveFeatureMemoryLearningConfig({}, 10);
  assert.equal(defaults.bootstrapDiscoveryCount, 60);
  assert.equal(defaults.unknownDiscoveryCount, 20);
  assert.equal(defaults.matchTopK, 3);

  const overridden = resolveFeatureMemoryLearningConfig({
    featureMemory: {
      bootstrapDiscoveryCount: 12,
      unknownDiscoveryCount: 6,
      matchTopK: 2,
      minReuseSimilarity: 0.9,
      minRetrievedCandidates: 5,
      maxRetrievedCandidates: 7,
    },
  }, 10);

  assert.equal(overridden.bootstrapDiscoveryCount, 12);
  assert.equal(overridden.unknownDiscoveryCount, 6);
  assert.equal(overridden.matchTopK, 2);
  assert.equal(overridden.minReuseSimilarity, 0.9);
  assert.equal(overridden.minRetrievedCandidates, 5);
  assert.equal(overridden.maxRetrievedCandidates, 7);
});

test('feature-memory learning selects evenly spaced discovery strategies', () => {
  const selected = selectEvenlySpacedStrategies(
    Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      name: `strategy-${index + 1}`,
      type: 'rsi_macd',
      parameters: { risk: { maxHoldMinutes: index + 1 } },
    })),
    4
  );

  assert.deepEqual(
    selected.map((item) => item.name),
    ['strategy-1', 'strategy-4', 'strategy-7', 'strategy-10']
  );
});

test('feature-memory learning matches similar history and builds retrieved candidates without duplicates', () => {
  const learning = resolveFeatureMemoryLearningConfig({
    featureMemory: {
      matchTopK: 2,
      maxRetrievedCandidates: 4,
    },
  }, 2);

  const currentFeature = {
    key: '2025-02',
    minutes: 120,
    realizedVolPct: 5,
    avgAbsReturnPct: 0.4,
    avgRangePct: 0.7,
    maxAbsReturnPct: 1.8,
    maxRangePct: 2.4,
    returnPct: 3.2,
    upMinuteRatio: 57,
    trendEfficiency: 0.6,
    volExpansionRatio: 1.1,
    openingImpulse: 0.5,
    reversalStrength: 0.2,
    featureBucket: 'strong-trend',
    positiveStrategyRatio: 50,
    bestVsMedianGap: 300,
  };

  const matches = findHistoricalMemoryMatches(currentFeature, [
    {
      periodKey: '2025-01',
      feature: {
        ...currentFeature,
        key: '2025-01',
        positiveStrategyRatio: 80,
      },
      strategies: [
        { rank: 1, name: 'alpha', type: 'rsi_macd', parameters: { id: 'a' }, totalTrades: 10, totalPnl: 100, returnPct: 1, score: 80 },
        { rank: 2, name: 'beta', type: 'rsi_macd', parameters: { id: 'b' }, totalTrades: 9, totalPnl: 60, returnPct: 0.6, score: 70 },
      ],
      winnerName: 'alpha',
    },
    {
      periodKey: '2024-12',
      feature: {
        ...currentFeature,
        key: '2024-12',
        realizedVolPct: 1.2,
        trendEfficiency: 0.1,
        featureBucket: 'range-low-vol',
      },
      strategies: [
        { rank: 1, name: 'beta', type: 'rsi_macd', parameters: { id: 'b' }, totalTrades: 11, totalPnl: 40, returnPct: 0.4, score: 60 },
        { rank: 2, name: 'gamma', type: 'rsi_macd', parameters: { id: 'c' }, totalTrades: 7, totalPnl: -10, returnPct: -0.1, score: 40 },
      ],
      winnerName: 'beta',
    },
  ], learning);

  assert.equal(matches.length, 2);
  assert.equal(matches[0].matchedPeriodKey, '2025-01');
  assert.ok(matches[0].similarityScore > matches[1].similarityScore);

  const retrieved = buildRetrievedCandidates(matches, learning);
  assert.deepEqual(retrieved.map((item) => item.name), ['alpha', 'beta', 'gamma']);
});
