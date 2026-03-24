const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { test } = require('./harness.ts');
const {
  resolvePathFromFile,
  validateRouterPolicyCatalog,
  loadRouterPolicyCatalogByPath,
  loadRouterPolicyCatalogByRouterConfig,
  loadRouterPolicyCatalogFromRefs,
  summarizePolicyCatalog,
  renderPolicyCatalogMarkdown,
} = require('../dist/services/router-policy-catalog.js');

function createRouterConfig() {
  return {
    symbol: 'BTCJPY',
    routerVersion: 'btc_router_v1',
    policyCatalogPath: './btc_router.policy.json',
    strategyCatalog: {
      rank1: { strategyName: 'alpha', shortLabel: 'TOP1' },
      rank2: { strategyName: 'beta', shortLabel: 'TOP2' },
    },
    executionModel: {
      defaultFallback: {
        action: 'trade',
        riskMultiplier: 1,
        strategyKey: 'rank1',
      },
    },
    rules: [
      {
        id: 'monthly_a',
        layer: 'monthly_guard',
        action: { type: 'trade', strategyKey: 'rank1' },
      },
      {
        id: 'loss_a',
        layer: 'loss_recheck',
        action: { type: 'reduce', strategyKey: 'rank2' },
      },
    ],
  };
}

function createPolicyCatalog() {
  return {
    symbol: 'BTCJPY',
    routerVersion: 'btc_router_v1',
    catalogVersion: 'btc_router_v1_policy_v1',
    generatedDate: '2026-03-25T00:00:00.000Z',
    source: {
      routerConfigPath: 'btc_router.json',
      notes: ['fixture'],
    },
    defaultFallback: {
      action: 'trade',
      riskMultiplier: 1,
      strategy: {
        strategyKey: 'rank1',
        strategyLabel: 'TOP1',
        strategyName: 'alpha',
      },
    },
    eventSegments: [
      {
        eventSegment: 'range-low-vol',
        layer: 'monthly_guard',
        ruleId: 'monthly_a',
        featureSummary: 'featureBucket=range-low-vol',
        actionType: 'trade',
        strategy: {
          strategyKey: 'rank1',
          strategyLabel: 'TOP1',
          strategyName: 'alpha',
        },
      },
    ],
    dailyGuards: [
      {
        eventSegment: 'loss-feedback',
        layer: 'loss_recheck',
        ruleId: 'loss_a',
        featureSummary: 'previousDayRoutedPnl=lt:-1',
        actionType: 'reduce',
        riskMultiplier: 0.5,
        strategy: {
          strategyKey: 'rank2',
          strategyLabel: 'TOP2',
          strategyName: 'beta',
        },
      },
    ],
  };
}

test('router policy catalog validates, loads from refs, and renders markdown', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'money-router-policy-'));
  const routerPath = path.join(tempDir, 'btc_router.json');
  const policyPath = path.join(tempDir, 'btc_router.policy.json');
  const routerConfig = createRouterConfig();
  const catalog = createPolicyCatalog();

  fs.writeFileSync(routerPath, JSON.stringify(routerConfig, null, 2), 'utf8');
  fs.writeFileSync(policyPath, JSON.stringify(catalog, null, 2), 'utf8');

  assert.equal(resolvePathFromFile(routerPath, './btc_router.policy.json'), policyPath);
  assert.deepEqual(loadRouterPolicyCatalogByPath(policyPath), catalog);

  validateRouterPolicyCatalog(catalog, routerConfig);
  assert.deepEqual(loadRouterPolicyCatalogByRouterConfig(routerPath, routerConfig), catalog);
  assert.deepEqual(loadRouterPolicyCatalogFromRefs({
    baseFilePath: routerPath,
    routerConfigPath: './btc_router.json',
    policyCatalogPath: undefined,
  }), catalog);
  assert.deepEqual(loadRouterPolicyCatalogFromRefs({
    baseFilePath: routerPath,
    routerConfigPath: undefined,
    policyCatalogPath: './btc_router.policy.json',
  }), catalog);

  assert.deepEqual(summarizePolicyCatalog(catalog), [
    '事件段策略: 1',
    '日级保护: 1',
    '停做规则: 0',
    '减仓规则: 1',
  ]);

  const markdown = renderPolicyCatalogMarkdown(catalog);
  assert.match(markdown, /Policy Catalog/);
  assert.match(markdown, /monthly_a/);
  assert.match(markdown, /loss_a/);
  assert.match(markdown, /TOP1/);
});

test('router policy catalog rejects mismatched rule details', () => {
  const routerConfig = createRouterConfig();
  const catalog = createPolicyCatalog();
  const broken = {
    ...catalog,
    eventSegments: [
      {
        ...catalog.eventSegments[0],
        actionType: 'stop',
      },
    ],
  };

  assert.throws(() => validateRouterPolicyCatalog(broken, routerConfig), /action mismatch/);
});
