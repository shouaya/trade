const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  buildDefaultRouterConfigKey,
  buildDefaultPolicyConfigKey,
  buildRelativeConfigRef,
  resolveRelativeConfigRef,
  buildStrategyCatalogFromRollingPackage,
  buildPolicyContent,
  buildRollingRouterArtifacts,
} = require('../dist/services/router-artifact-builder.js');

test('router artifact builder resolves config paths and rolling package strategy catalog', () => {
  assert.equal(
    buildDefaultRouterConfigKey('configs/training/2024_btcjpy_alpha.json'),
    'configs/generated/regime-routing/2024_btcjpy_alpha_router.json'
  );
  assert.equal(
    buildDefaultPolicyConfigKey('configs/generated/regime-routing/a_router.json'),
    'configs/generated/regime-routing/a_router.policy.json'
  );
  assert.equal(
    buildRelativeConfigRef('configs/training/a.json', 'configs/generated/regime-routing/a_router.json'),
    '../generated/regime-routing/a_router.json'
  );
  assert.equal(
    resolveRelativeConfigRef('configs/training/a.json', '../generated/regime-routing/a_router.json'),
    'configs/generated/regime-routing/a_router.json'
  );

  const strategyCatalog = buildStrategyCatalogFromRollingPackage({
    rollingRouter: {
      strategyCatalog: {
        rank1: { strategyName: 'alpha', shortLabel: 'A1', role: 'default-fallback' },
        rank2: { strategyName: 'beta', shortLabel: 'B2', role: 'candidate' },
      },
    },
  });
  assert.deepEqual(strategyCatalog, {
    rank1: { strategyName: 'alpha', shortLabel: 'A1', role: 'default-fallback' },
    rank2: { strategyName: 'beta', shortLabel: 'B2', role: 'candidate' },
  });
});

test('router artifact builder creates router and policy artifacts from rolling package', () => {
  const rollingPackage = {
    symbol: 'BTCJPY',
    trainId: 'train-abc',
    rollingRouter: {
      defaultStrategyKey: 'rank1',
      strategyCatalog: {
        rank1: { strategyName: 'alpha', shortLabel: 'A1', role: 'default-fallback' },
        rank2: { strategyName: 'beta', shortLabel: 'B2', role: 'candidate' },
      },
      rules: [
        {
          id: 'monthly_rule',
          layer: 'monthly_guard',
          priority: 1,
          when: { featureBucket: ['range-low-vol'], trendEfficiency: { gt: 0.5 } },
          action: { type: 'trade', riskCap: 1, strategyKey: 'rank1' },
          rationale: 'monthly split',
        },
        {
          id: 'daily_rule',
          layer: 'daily_router',
          priority: 2,
          when: { featureBucket: ['range-low-vol'], positiveStrategyRatio: { gt: 50 } },
          action: { type: 'reduce', riskMultiplier: 0.5, strategyKey: 'rank2' },
          rationale: 'daily split',
        },
        {
          id: 'invalid_rule',
          layer: 'daily_router',
          priority: 3,
          when: { featureBucket: ['mixed-trend'] },
          action: { type: 'trade', strategyKey: 'missing' },
        },
      ],
    },
  };

  const artifacts = buildRollingRouterArtifacts({
    trainingConfig: {
      name: '2024_BTCJPY_ALPHA',
      market: { symbol: 'BTCJPY' },
      trainId: 'train-abc',
    },
    trainingConfigKey: 'configs/training/2024_btcjpy_alpha.json',
    rollingPackage,
  });

  assert.equal(artifacts.routerConfigKey, 'configs/generated/regime-routing/2024_btcjpy_alpha_router.json');
  assert.equal(artifacts.policyConfigKey, 'configs/generated/regime-routing/2024_btcjpy_alpha_router.policy.json');
  assert.equal(artifacts.routerRelativeRef, '../generated/regime-routing/2024_btcjpy_alpha_router.json');
  assert.equal(artifacts.policyRelativeRef, '../generated/regime-routing/2024_btcjpy_alpha_router.policy.json');
  assert.equal(artifacts.routerContent.symbol, 'BTCJPY');
  assert.equal(artifacts.routerContent.executionModel.defaultFallback.strategyKey, 'rank1');
  assert.equal(artifacts.routerContent.rules.length, 2);
  assert.ok(artifacts.routerContent.rules.every((rule) => rule.id !== 'invalid_rule'));
  assert.equal(artifacts.policyContent.eventSegments.length, 1);
  assert.equal(artifacts.policyContent.dailyGuards.length, 1);

  const policyContent = buildPolicyContent(artifacts.routerContent, artifacts.routerConfigKey, ['fixture']);
  assert.equal(policyContent.defaultFallback.strategy.strategyKey, 'rank1');
  assert.match(policyContent.source.notes.join(' '), /fixture/);
  assert.match(policyContent.eventSegments[0].featureSummary, /trendEfficiency/);
});

test('router artifact builder carries forward compatible previous router when rolling rules are absent', () => {
  const previousRouter = {
    routerVersion: 'btcjpy_router_v1',
    trainId: 'train-old',
    executionModel: {
      defaultFallback: {
        action: 'reduce',
        riskMultiplier: 0.5,
        strategyKey: 'rank2',
      },
    },
    rules: [
      {
        id: 'previous_rule',
        layer: 'weekly_guard',
        priority: 3,
        when: { featureBucket: ['strong-trend'] },
        action: { type: 'trade', strategyKey: 'rank2', riskCap: 1 },
      },
    ],
  };

  const artifacts = buildRollingRouterArtifacts({
    trainingConfig: {
      name: '2024_BTCJPY_ALPHA',
      market: { symbol: 'BTCJPY' },
      regimeRouting: {
        routerConfigPath: '../generated/regime-routing/custom_router.json',
        policyCatalogPath: '../generated/regime-routing/custom_router.policy.json',
      },
    },
    trainingConfigKey: 'configs/training/2024_btcjpy_alpha.json',
    rollingPackage: {
      symbol: 'BTCJPY',
      rollingRouter: {
        strategyCatalog: {
          rank1: { strategyName: 'alpha', shortLabel: 'A1', role: 'default-fallback' },
          rank2: { strategyName: 'beta', shortLabel: 'B2', role: 'candidate' },
        },
        rules: [],
      },
    },
    previousRouter,
  });

  assert.equal(artifacts.routerConfigKey, 'configs/generated/regime-routing/custom_router.json');
  assert.equal(artifacts.policyConfigKey, 'configs/generated/regime-routing/custom_router.policy.json');
  assert.equal(artifacts.routerContent.executionModel.defaultFallback.action, 'reduce');
  assert.equal(artifacts.routerContent.executionModel.defaultFallback.strategyKey, 'rank2');
  assert.equal(artifacts.routerContent.rules[0].id, 'previous_rule');
  assert.match(artifacts.policyContent.source.notes.join(' '), /carried forward/);
});
