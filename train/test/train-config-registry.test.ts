const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  normalizeTrainConfigKey,
  buildTrainConfigMetadata,
  upsertTrainConfig,
} = require('../dist/services/train-config-registry.js');

test('train config registry normalizes config key and rejects invalid paths', () => {
  assert.equal(
    normalizeTrainConfigKey('\\configs\\training\\\\2026_btcjpy_alpha.json'),
    'configs/training/2026_btcjpy_alpha.json'
  );

  assert.throws(
    () => normalizeTrainConfigKey('../configs/training/2026_btcjpy_alpha.json'),
    /configKey 不能包含/
  );
});

test('train config registry builds metadata for runnable training config', () => {
  const metadata = buildTrainConfigMetadata(
    'configs/training/2026_btcjpy_alpha.json',
    {
      name: '2026_BTCJPY_ALPHA',
      timeRange: {
        startIso: '2026-01-01T00:00:00.000Z',
      },
      market: {
        symbol: 'btcjpy',
        intervalType: '1min',
      },
      database: {
        tableName: 'btcjpy_alpha_train_2026',
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
    }
  );

  assert.equal(metadata.configType, 'training');
  assert.equal(metadata.symbol, 'BTCJPY');
  assert.equal(metadata.trainingYear, '2026');
  assert.equal(metadata.resultGroup, 'btcjpy_alpha_train_2026');
  assert.equal(typeof metadata.contentHash, 'string');
  assert.ok(metadata.contentHash.length > 10);
});

test('train config registry requires explicit fee model for runnable config', () => {
  assert.throws(
    () => buildTrainConfigMetadata(
      'configs/validation/2026_btcjpy_alpha_validation.json',
      {
        name: 'BTCJPY_FUTURE_VALIDATION',
      }
    ),
    /feeModel 为必填/
  );
});

test('train config registry persists rolling package child rows for top-strategies config', async () => {
  const queries = [];
  const db = {
    query: async (sql, params = []) => {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('SELECT id, version_no')) {
        return [[]];
      }
      if (String(sql).includes('INSERT INTO train_configs')) {
        return [{ insertId: 12 }];
      }
      return [{}];
    }
  };

  await upsertTrainConfig(
    db,
    'configs/top-strategies/rolling_alpha.generated.json',
    {
      artifactType: 'rolling-strategy-package',
      generatedAt: '2026-03-24T00:00:00.000Z',
      market: {
        symbol: 'BTCJPY',
        intervalType: '1min',
      },
      trainingContext: {
        trainId: 'train-abc',
      },
      rollingPlan: {
        monthlyPools: [
          {
            month: '2025-01',
            featureBucket: 'range-mid-vol',
            selectedStrategyName: 'alpha',
            actionType: 'trade',
            riskCap: 1,
            topStrategies: [{ strategyName: 'alpha', rank: 1 }]
          }
        ],
        rules: {
          monthlyGuard: [
            {
              id: 'monthly_guard_range_mid_vol',
              priority: 1,
              when: { featureBucket: ['range-mid-vol'] },
              action: { type: 'trade', riskCap: 1, strategyKey: 'rank1' },
              rationale: 'month rule'
            }
          ],
          weeklyGuard: [],
          dailyRouter: [],
          lossRecheck: []
        }
      },
      rollingRouter: {
        defaultStrategyKey: 'rank1',
        strategyCatalog: {
          rank1: {
            strategyName: 'alpha',
            shortLabel: 'TOP1'
          }
        },
        rules: []
      }
    },
    {
      explicitType: 'top-strategies'
    }
  );

  assert.ok(queries.some((entry) => entry.sql.includes('INSERT INTO snapshot_config_details')));
  assert.ok(queries.some((entry) => entry.sql.includes('INSERT INTO rolling_pool_details')));
  assert.ok(queries.some((entry) => entry.sql.includes('INSERT INTO rolling_rule_details')));
});

test('train config registry persists rolling rule detail fields needed by reports and db analysis', async () => {
  const rollingRuleInserts = [];
  const db = {
    query: async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('SELECT id, version_no')) {
        return [[]];
      }
      if (text.includes('INSERT INTO train_configs')) {
        return [{ insertId: 34 }];
      }
      if (text.includes('INSERT INTO rolling_rule_details')) {
        rollingRuleInserts.push(params);
      }
      return [{}];
    }
  };

  await upsertTrainConfig(
    db,
    'configs/top-strategies/rolling_beta.generated.json',
    {
      artifactType: 'rolling-strategy-package',
      generatedAt: '2026-03-25T00:00:00.000Z',
      market: {
        symbol: 'BTCJPY',
        intervalType: '1min',
      },
      trainingContext: {
        trainId: 'train-beta',
      },
      rollingPlan: {
        monthlyPools: [],
        rules: {
          monthlyGuard: [
            {
              id: 'monthly_guard_range_mid_vol',
              priority: 1,
              when: { featureBucket: ['range-mid-vol'] },
              action: { type: 'trade', riskCap: 1, strategyKey: 'rank1' },
              rationale: 'monthly trade rule'
            }
          ],
          weeklyGuard: [
            {
              id: 'weekly_guard_range_mid_vol',
              priority: 2,
              when: { featureBucket: ['range-mid-vol'] },
              action: { type: 'stop', riskCap: 0 },
              rationale: 'weekly stop rule'
            }
          ],
          dailyRouter: [],
          lossRecheck: []
        }
      },
      rollingRouter: {
        defaultStrategyKey: 'rank1',
        strategyCatalog: {
          rank1: {
            strategyName: 'alpha',
            shortLabel: 'TOP1'
          }
        },
        rules: []
      }
    },
    {
      explicitType: 'top-strategies'
    }
  );

  assert.equal(rollingRuleInserts.length, 2);

  const monthlyInsert = rollingRuleInserts.find((params) => params[1] === 'monthly_guard');
  const weeklyInsert = rollingRuleInserts.find((params) => params[1] === 'weekly_guard');

  assert.ok(monthlyInsert);
  assert.equal(monthlyInsert[4], 'range-mid-vol');
  assert.equal(monthlyInsert[5], 'rank1');
  assert.equal(monthlyInsert[6], 'alpha');
  assert.equal(monthlyInsert[7], 'trade');
  assert.equal(monthlyInsert[8], 1);

  assert.ok(weeklyInsert);
  assert.equal(weeklyInsert[4], 'range-mid-vol');
  assert.equal(weeklyInsert[5], null);
  assert.equal(weeklyInsert[6], null);
  assert.equal(weeklyInsert[7], 'stop');
  assert.equal(weeklyInsert[8], 0);
});
