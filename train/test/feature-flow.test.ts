const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { test } = require('./harness.ts');
const {
  runGenerateValidationArtifacts,
} = require('../dist/scripts/generate-validation-artifacts.js');
const {
  runBuildRouterArtifacts,
} = require('../dist/scripts/build-router-artifacts.js');
const {
  upsertTrainConfig,
} = require('../dist/services/train-config-registry.js');
const {
  runRouterValidation,
} = require('../dist/services/regime-router-validation.js');
const dbModule = require('../dist/configs/database.js');
const {
  TRAIN_CONFIGS_TABLE,
  ROLLING_POOL_DETAILS_TABLE,
  ROLLING_RULE_DETAILS_TABLE,
} = require('@money/database');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function countPlaceholders(sql) {
  return (String(sql).match(/\?/g) || []).length;
}

function makeKlineRow(isoTime, open, high, low, close) {
  return {
    open_time: Date.parse(isoTime),
    open,
    high,
    low,
    close,
    bid_open: open - 0.1,
    bid_high: high - 0.1,
    bid_low: low - 0.1,
    bid_close: close - 0.1,
    ask_open: open + 0.1,
    ask_high: high + 0.1,
    ask_low: low + 0.1,
    ask_close: close + 0.1,
  };
}

function createPlaceholderCheckedConnection(fixtures) {
  return {
    async query(sql, params = []) {
      const text = String(sql);
      assert.equal(countPlaceholders(text), params.length, `SQL placeholders mismatch: ${text}`);

      if (text.includes('FROM backtest_results') && text.includes('SELECT run_id')) {
        return [[{ run_id: fixtures.runId }], {}];
      }
      if (text.includes('FROM backtest_results') && text.includes('strategy_name, strategy_type')) {
        return [fixtures.strategyRows, {}];
      }
      if (text.includes('FROM trades')) {
        return [fixtures.trainingTrades, {}];
      }
      if (text.includes('FROM klines')) {
        return [fixtures.klines, {}];
      }

      throw new Error(`Unexpected feature-flow SQL: ${text}`);
    },
    async end() {
      return undefined;
    },
  };
}

function createRegistryDb() {
  const state = {
    nextId: 1,
    configs: [],
    rollingPools: [],
    rollingRules: [],
  };

  function getActiveConfig(configKey) {
    return state.configs
      .filter((item) => item.config_key === configKey && item.status === 'active')
      .sort((left, right) => right.version_no - left.version_no || right.id - left.id)[0] || null;
  }

  function getConfigById(id) {
    return state.configs.find((item) => item.id === id) || null;
  }

  return {
    state,
    async query(sql, params = []) {
      const text = String(sql);
      assert.equal(countPlaceholders(text), params.length, `SQL placeholders mismatch: ${text}`);

      if (text.includes(`SELECT id, version_no, config_type, train_id, content_hash
     FROM ${TRAIN_CONFIGS_TABLE}`)) {
        const existing = getActiveConfig(String(params[0] || ''));
        return [existing ? [existing] : [], {}];
      }

      if (text.includes(`UPDATE ${TRAIN_CONFIGS_TABLE}`) && text.includes("SET status = 'archived'")) {
        const configKey = String(params[0] || '');
        for (const row of state.configs) {
          if (row.config_key === configKey && row.status === 'active') {
            row.status = 'archived';
          }
        }
        return [{ affectedRows: 1 }, {}];
      }

      if (text.includes(`INSERT INTO ${TRAIN_CONFIGS_TABLE}`)) {
        const row = {
          id: state.nextId++,
          config_key: params[0],
          config_type: params[1],
          config_name: params[2],
          symbol: params[3],
          interval_type: params[4],
          result_group: params[5],
          source_table: params[6],
          train_config_ref: params[7],
          training_year: params[8],
          train_id: params[9],
          parent_config_id: params[10],
          version_no: params[11],
          status: params[12],
          is_generated: params[13],
          content_hash: params[14],
          updated_at: new Date('2026-03-25T00:00:00.000Z').toISOString(),
          content: null,
        };
        state.configs.push(row);
        return [{ insertId: row.id }, {}];
      }

      if (text.includes('INSERT INTO') && text.includes('ON DUPLICATE KEY UPDATE')) {
        const configId = Number(params[0]);
        const row = getConfigById(configId);
        assert.ok(row, `missing config row ${configId} for detail insert`);
        row.content = JSON.parse(String(params[params.length - 1] || '{}'));
        return [{ affectedRows: 1 }, {}];
      }

      if (text.includes('DELETE FROM') && text.includes('WHERE config_id = ?')) {
        const configId = Number(params[0]);
        if (text.includes(ROLLING_POOL_DETAILS_TABLE)) {
          state.rollingPools = state.rollingPools.filter((item) => item.config_id !== configId);
        }
        if (text.includes(ROLLING_RULE_DETAILS_TABLE)) {
          state.rollingRules = state.rollingRules.filter((item) => item.config_id !== configId);
        }
        return [{ affectedRows: 1 }, {}];
      }

      if (text.includes(`INSERT INTO ${ROLLING_POOL_DETAILS_TABLE}`)) {
        state.rollingPools.push({
          config_id: params[0],
          month_key: params[1],
          feature_bucket: params[2],
          selected_strategy_name: params[3],
          action_type: params[4],
          risk_cap: params[5],
          top_strategies_json: params[6],
        });
        return [{ insertId: state.rollingPools.length }, {}];
      }

      if (text.includes(`INSERT INTO ${ROLLING_RULE_DETAILS_TABLE}`)) {
        state.rollingRules.push({
          config_id: params[0],
          layer_key: params[1],
          rule_id: params[2],
          priority_no: params[3],
          feature_bucket: params[4],
          strategy_key: params[5],
          strategy_name: params[6],
          action_type: params[7],
          risk_cap: params[8],
          risk_multiplier: params[9],
          rationale: params[10],
          rule_json: params[11],
        });
        return [{ insertId: state.rollingRules.length }, {}];
      }

      if (text.includes(`FROM ${TRAIN_CONFIGS_TABLE} tc`) && text.includes("tc.config_type = 'top-strategies'")) {
        const trainId = String(params[0] || '');
        const row = state.configs
          .filter((item) => item.config_type === 'top-strategies' && item.train_id === trainId && item.status === 'active')
          .sort((left, right) => right.version_no - left.version_no || right.id - left.id)[0];
        return [row ? [{ ...row, content: row.content }] : [], {}];
      }

      throw new Error(`Unexpected registry SQL: ${text}`);
    },
  };
}

test('feature flow runs training params to rolling artifacts and router outputs end-to-end', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'money-feature-flow-'));
  const trainRoot = path.join(tempRoot, 'train');
  const trainingConfigKey = 'configs/training/2025_btcjpy_feature_flow.json';
  const trainingConfigPath = path.join(trainRoot, trainingConfigKey);

  const trainingConfig = {
    trainId: 'train-feature-001',
    name: '2025_BTCJPY_FEATURE_FLOW',
    description: 'feature flow smoke',
    timeRange: {
      startTimeMs: Date.parse('2025-01-03T00:00:00.000Z'),
      endTimeMs: Date.parse('2025-02-05T23:59:00.000Z'),
      startIso: '2025-01-03T00:00:00.000Z',
      endIso: '2025-02-05T23:59:00.000Z',
    },
    market: {
      symbol: 'BTCJPY',
      intervalType: '1min',
    },
    database: {
      tableName: 'btcjpy_feature_flow_train',
    },
    strategy: {
      types: ['rsi_macd'],
      parameters: {
        risk: {
          lotSize: [0.008],
          maxHoldMinutes: [6, 8],
        },
      },
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
    output: {
      topN: 2,
    },
    validationPlan: {
      profile: 'rolling-window',
    },
    featureEngineering: {
      openingWindowMinutes: 1,
      volBaselineLookbackPeriods: 1,
      routerSplit: {
        enabled: true,
        minSamplesPerBranch: 1,
        metrics: ['positiveStrategyRatio', 'trendEfficiency'],
      },
    },
  };
  writeJson(trainingConfigPath, trainingConfig);

  const fixtures = {
    runId: 'train-run-feature-1',
    strategyRows: [
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
          atr: { slMultiplier: 1.5, tpMultiplier: 1.2 },
        },
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
          atr: { slMultiplier: 2, tpMultiplier: 1.5 },
        },
      },
    ],
    trainingTrades: [
      { strategy_name: 'alpha', exit_time: Date.parse('2025-01-03T03:00:00.000Z'), pnl: 1200 },
      { strategy_name: 'beta', exit_time: Date.parse('2025-01-03T03:00:00.000Z'), pnl: 200 },
      { strategy_name: 'alpha', exit_time: Date.parse('2025-01-10T03:00:00.000Z'), pnl: -200 },
      { strategy_name: 'beta', exit_time: Date.parse('2025-01-10T03:00:00.000Z'), pnl: 900 },
      { strategy_name: 'alpha', exit_time: Date.parse('2025-02-05T03:00:00.000Z'), pnl: 1500 },
      { strategy_name: 'beta', exit_time: Date.parse('2025-02-05T03:00:00.000Z'), pnl: -300 },
    ],
    klines: [
      makeKlineRow('2025-01-03T00:00:00.000Z', 100, 102, 99, 101),
      makeKlineRow('2025-01-03T00:01:00.000Z', 101, 103, 100, 102),
      makeKlineRow('2025-01-10T00:00:00.000Z', 102, 103, 100, 101),
      makeKlineRow('2025-01-10T00:01:00.000Z', 101, 101.5, 99, 100),
      makeKlineRow('2025-02-05T00:00:00.000Z', 100, 104, 99, 103),
      makeKlineRow('2025-02-05T00:01:00.000Z', 103, 105, 102, 104),
    ],
  };

  const artifacts = await runGenerateValidationArtifacts({
    trainConfig: trainingConfigPath,
    trainConfigRef: trainingConfigKey,
    symbol: 'BTCJPY',
    sourceTable: 'btcjpy_feature_flow_train',
    outPrefix: '2025_btcjpy_feature_flow',
    strategyPrefix: '2025-BTCJPY-FLOW-',
    descriptionPrefix: '2025 BTCJPY flow',
    limit: 2,
    exact: true,
    profile: 'rolling-window',
    outputMode: 'json',
  }, {
    connection: createPlaceholderCheckedConnection(fixtures),
    trainRoot,
    trainConfig: trainingConfig,
  });

  assert.equal(artifacts.validationConfigs.length, 2);
  assert.equal(artifacts.snapshot.content.trainId, 'train-feature-001');
  assert.ok(artifacts.snapshot.content.rollingPlan.monthlyPools.length >= 2);
  assert.ok(artifacts.snapshot.content.rollingRouter.rules.length >= 1);

  const registryDb = createRegistryDb();
  await upsertTrainConfig(registryDb, trainingConfigKey, trainingConfig, { explicitType: 'training' });
  await upsertTrainConfig(registryDb, artifacts.snapshot.configKey, artifacts.snapshot.content, { explicitType: 'top-strategies' });
  for (const item of artifacts.validationConfigs) {
    await upsertTrainConfig(registryDb, item.configKey, item.content, { explicitType: 'validation' });
  }

  assert.ok(registryDb.state.rollingPools.length >= 2);
  assert.ok(registryDb.state.rollingRules.length >= 1);

  const firstValidation = artifacts.validationConfigs[0];
  const firstValidationPath = path.join(trainRoot, firstValidation.configKey);
  writeJson(firstValidationPath, firstValidation.content);

  const routerBuildResult = await runBuildRouterArtifacts({
    trainConfigPath: trainingConfigPath,
    trainConfigRef: trainingConfigKey,
  }, {
    db: registryDb,
    trainRoot,
    trainingConfig,
    skipEnsureSchema: true,
  });

  const routerPath = path.join(trainRoot, routerBuildResult.routerConfigKey);
  const policyPath = path.join(trainRoot, routerBuildResult.policyConfigKey);
  assert.equal(fs.existsSync(routerPath), true);
  assert.equal(fs.existsSync(policyPath), true);

  const updatedTraining = registryDb.state.configs
    .filter((item) => item.config_key === trainingConfigKey && item.status === 'active')
    .sort((left, right) => right.version_no - left.version_no)[0];
  assert.ok(updatedTraining.content.regimeRouting.routerConfigPath);
  assert.ok(updatedTraining.content.regimeRouting.policyCatalogPath);

  const validationTrades = [
    { strategy_name: 'alpha', exit_time: Date.parse('2025-01-03T12:00:00.000Z'), pnl: 80 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-01-03T12:00:00.000Z'), pnl: -20 },
    { strategy_name: 'alpha', exit_time: Date.parse('2025-01-10T12:00:00.000Z'), pnl: -30 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-01-10T12:00:00.000Z'), pnl: 60 },
  ];
  const validationKlines = fixtures.klines.slice(0, 4);
  const originalQuery = dbModule.default.query;
  dbModule.default.query = async (sql, params = []) => {
    const text = String(sql);
    assert.equal(countPlaceholders(text), params.length, `SQL placeholders mismatch: ${text}`);
    if (text.includes('FROM trades') && text.includes('ORDER BY exit_time ASC')) {
      return [validationTrades, {}];
    }
    if (text.includes('FROM klines')) {
      return [validationKlines, {}];
    }
    throw new Error(`Unexpected router validation SQL: ${text}`);
  };

  try {
    const routerReport = await runRouterValidation({
      validationConfigPath: firstValidationPath,
      routerConfigPath: routerPath,
      tradeCreatedAt: '2026-03-25 10:00:00',
    });

    assert.equal(routerReport.symbol, 'BTCJPY');
    assert.equal(routerReport.policyCatalog !== null, true);
    assert.equal(routerReport.dailyRoutes.length >= 1, true);
    assert.equal(typeof routerReport.comparison.router.totalPnl, 'number');
  } finally {
    dbModule.default.query = originalQuery;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
