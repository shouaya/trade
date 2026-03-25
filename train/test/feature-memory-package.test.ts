const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const { runBuildRouterArtifacts } = require('../dist/scripts/build-router-artifacts.js');
const { loadLatestRollingSnapshotFromFeatureMemory } = require('../dist/services/feature-memory-package.js');

test('feature memory package loader returns rolling artifact snapshot from db payload', async () => {
  const db = {
    async query(sql, params = []) {
      const text = String(sql);
      assert.match(text, /FROM analysis_artifacts/);
      assert.equal(params[0], 'BTCJPY');
      assert.equal(params[1], 'BTCJPY');
      assert.equal(params[2], 'train-memory-1');
      return [[{
        payload_json: JSON.stringify({
          trainId: 'train-memory-1',
          artifact: {
            artifactType: 'rolling-strategy-package',
            symbol: 'BTCJPY',
            rollingRouter: {
              defaultStrategyKey: 'rank1',
              strategyCatalog: {
                rank1: { strategyName: 'alpha', shortLabel: 'A1', role: 'default-fallback' },
              },
              rules: [],
            },
          },
        }),
      }], {}];
    },
  };

  const snapshot = await loadLatestRollingSnapshotFromFeatureMemory(db, {
    trainId: 'train-memory-1',
    symbol: 'BTCJPY',
  });

  assert.equal(snapshot.artifactType, 'rolling-strategy-package');
  assert.equal(snapshot.symbol, 'BTCJPY');
  assert.equal(snapshot.rollingRouter.defaultStrategyKey, 'rank1');
});

test('build router artifacts loads rolling package from feature-memory db artifact', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      const text = String(sql);
      queries.push({ sql: text, params });

      if (text.includes('FROM analysis_artifacts')) {
        return [[{
          payload_json: JSON.stringify({
            trainId: 'train-memory-2',
            artifact: {
              artifactType: 'rolling-strategy-package',
              symbol: 'BTCJPY',
              trainId: 'train-memory-2',
              rollingRouter: {
                defaultStrategyKey: 'rank1',
                strategyCatalog: {
                  rank1: { strategyName: 'alpha', shortLabel: 'A1', role: 'default-fallback' },
                  rank2: { strategyName: 'beta', shortLabel: 'B2', role: 'candidate' },
                },
                rules: [
                  {
                    id: 'weekly_rule',
                    layer: 'weekly_guard',
                    priority: 1,
                    when: { featureBucket: ['strong-trend'] },
                    action: { type: 'trade', riskCap: 1, strategyKey: 'rank1' },
                    rationale: 'from feature memory',
                  },
                ],
              },
            },
          }),
        }], {}];
      }

      if (text.includes('INSERT INTO train_configs')) {
        return [{ insertId: 1 }, {}];
      }

      if (text.includes('ON DUPLICATE KEY UPDATE')) {
        return [{ affectedRows: 1 }, {}];
      }

      if (text.includes("SET status = 'archived'")) {
        return [{ affectedRows: 0 }, {}];
      }

      if (text.includes('SELECT id, version_no, config_type, train_id, content_hash')) {
        return [[], {}];
      }

      if (text.includes('DELETE FROM')) {
        return [{ affectedRows: 0 }, {}];
      }

      throw new Error(`Unexpected SQL in feature-memory router fallback test: ${text}`);
    },
  };

  const result = await runBuildRouterArtifacts({
    trainConfigPath: '/tmp/2024_btcjpy_alpha.json',
    trainConfigRef: 'configs/training/2024_btcjpy_alpha.json',
  }, {
    db,
    trainRoot: '/tmp',
    skipEnsureSchema: true,
    trainingConfig: {
      name: '2024_BTCJPY_ALPHA',
      market: { symbol: 'BTCJPY' },
      trainId: 'train-memory-2',
      executor: {
        options: {
          feeModel: {
            venueCode: 'GMOCOIN',
            market: 'exchange-leverage',
            productCode: 'BTC_JPY',
            commissionRate: 0,
            basis: 'notional',
            chargeOnEntry: true,
            chargeOnExit: true,
            leverageMultiplier: 2,
            dailyLeverageRate: 0.0004,
            liquidationFeeRate: 0.005,
            forcedCloseFeeRate: 0.005,
            settlementHourJst: 6,
          },
        },
      },
    },
  });

  assert.equal(result.strategyCatalogCount, 2);
  assert.equal(result.carriedRuleCount, 1);
  assert.ok(queries.some((entry) => entry.sql.includes('FROM analysis_artifacts')));
});

test('build router artifacts can load previous router from db relative ref without local files', async () => {
  const db = {
    async query(sql, params = []) {
      const text = String(sql);

      if (text.includes('FROM analysis_artifacts')) {
        return [[{
          payload_json: JSON.stringify({
            trainId: 'train-memory-3',
            artifact: {
              artifactType: 'rolling-strategy-package',
              symbol: 'BTCJPY',
              trainId: 'train-memory-3',
              rollingRouter: {
                defaultStrategyKey: 'rank1',
                strategyCatalog: {
                  rank1: { strategyName: 'alpha', shortLabel: 'A1', role: 'default-fallback' },
                  rank2: { strategyName: 'beta', shortLabel: 'B2', role: 'candidate' },
                },
                rules: [],
              },
            },
          }),
        }], {}];
      }

      if (text.includes('WHERE tc.config_key = ?') && params[0] === 'configs/generated/regime-routing/legacy_router.json') {
        return [[{
          content: JSON.stringify({
            routerVersion: 'legacy_router_v1',
            executionModel: {
              defaultFallback: {
                action: 'reduce',
                riskMultiplier: 0.35,
                strategyKey: 'rank2',
              },
            },
            rules: [
              {
                id: 'legacy_weekly_rule',
                layer: 'weekly_guard',
                priority: 7,
                when: { featureBucket: ['strong-trend'] },
                action: { type: 'trade', strategyKey: 'rank2', riskCap: 1 },
              },
            ],
          }),
        }], {}];
      }

      if (text.includes('INSERT INTO train_configs')) {
        return [{ insertId: 1 }, {}];
      }

      if (text.includes('ON DUPLICATE KEY UPDATE')) {
        return [{ affectedRows: 1 }, {}];
      }

      if (text.includes("SET status = 'archived'")) {
        return [{ affectedRows: 0 }, {}];
      }

      if (text.includes('SELECT id, version_no, config_type, train_id, content_hash')) {
        return [[], {}];
      }

      if (text.includes('DELETE FROM')) {
        return [{ affectedRows: 0 }, {}];
      }

      throw new Error(`Unexpected SQL in previous-router db fallback test: ${text}`);
    },
  };

  const result = await runBuildRouterArtifacts({
    trainConfigPath: '/tmp/2024_btcjpy_alpha.json',
    trainConfigRef: 'configs/training/2024_btcjpy_alpha.json',
  }, {
    db,
    trainRoot: '/tmp',
    skipEnsureSchema: true,
    trainingConfig: {
      name: '2024_BTCJPY_ALPHA',
      market: { symbol: 'BTCJPY' },
      trainId: 'train-memory-3',
      regimeRouting: {
        routerConfigPath: '../generated/regime-routing/legacy_router.json',
      },
      executor: {
        options: {
          feeModel: {
            venueCode: 'GMOCOIN',
            market: 'exchange-leverage',
            productCode: 'BTC_JPY',
            commissionRate: 0,
            basis: 'notional',
            chargeOnEntry: true,
            chargeOnExit: true,
            leverageMultiplier: 2,
            dailyLeverageRate: 0.0004,
            liquidationFeeRate: 0.005,
            forcedCloseFeeRate: 0.005,
            settlementHourJst: 6,
          },
        },
      },
    },
  });

  assert.equal(result.strategyCatalogCount, 2);
  assert.equal(result.carriedRuleCount, 1);
});
