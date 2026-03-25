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

function makeWaveKlines(startIso, closes) {
  const startTime = Date.parse(startIso);
  return closes.map((close, index) => {
    const previousClose = index === 0 ? close : closes[index - 1];
    const open = previousClose;
    const high = Math.max(open, close) + 1;
    const low = Math.min(open, close) - 1;
    return makeKlineRow(new Date(startTime + (index * 60_000)).toISOString(), open, high, low, close);
  });
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
      if (text.includes('SELECT MIN(open_time) AS min_open_time')) {
        return [[{ min_open_time: fixtures.klines[0]?.open_time ?? null }], {}];
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
    rollingPackagePayload: null,
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

      if (text.includes('FROM analysis_artifacts')) {
        return state.rollingPackagePayload
          ? [[{ payload_json: JSON.stringify({ artifact: state.rollingPackagePayload }) }], {}]
          : [[], {}];
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
        rsi: {
          period: [2],
          oversold: [60],
          overbought: [81],
        },
        macd: {
          fastPeriod: [2],
          slowPeriod: [4],
          signalPeriod: [2],
          histogramThreshold: [0],
        },
        risk: {
          maxPositions: [1],
          lotSize: [0.008],
          maxHoldMinutes: [6, 8],
        },
        atr: {
          slMultiplier: [1.5],
          tpMultiplier: [1.5],
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
      ...makeWaveKlines('2024-12-16T00:00:00.000Z', [110, 108, 106, 104, 102, 100, 102, 104, 106, 108]),
      ...makeWaveKlines('2025-01-03T00:00:00.000Z', [100, 98, 96, 94, 95, 97, 99, 101]),
      ...makeWaveKlines('2025-01-10T00:00:00.000Z', [101, 103, 105, 107, 106, 104, 102, 100]),
      ...makeWaveKlines('2025-02-05T00:00:00.000Z', [100, 97, 94, 92, 93, 96, 99, 103]),
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
  assert.equal(artifacts.rollingPackage.trainId, 'train-feature-001');
  assert.equal(artifacts.rollingPackage.rollingPlan.monthlyPools.length, 2);
  assert.equal(artifacts.rollingPackage.rollingPlan.monthlyPools[0].sourceMonth, '2025-01');
  assert.ok(artifacts.rollingPackage.rollingRouter.rules.length >= 1);
  assert.equal(artifacts.validationConfigs[0].content.validationTarget.evaluationTimeRange.startIso, '2025-01-03T00:00:00.000Z');
  assert.equal(artifacts.validationConfigs[0].content.validationTarget.executionTimeRange.startIso, '2024-12-01T00:00:00.000Z');
  assert.equal(artifacts.validationConfigs[0].content.timeRange.startIso, '2024-12-01T00:00:00.000Z');

  const registryDb = createRegistryDb();
  await upsertTrainConfig(registryDb, trainingConfigKey, trainingConfig, { explicitType: 'training' });
  registryDb.state.rollingPackagePayload = artifacts.rollingPackage;
  for (const item of artifacts.validationConfigs) {
    await upsertTrainConfig(registryDb, item.configKey, item.content, { explicitType: 'validation' });
  }

  const firstValidation = artifacts.validationConfigs[0];
  const firstValidationPath = path.join(trainRoot, firstValidation.configKey);
  writeJson(firstValidationPath, firstValidation.content);
  const validationStrategyNames = Array.isArray(firstValidation.content?.strategy?.explicitStrategies)
    ? firstValidation.content.strategy.explicitStrategies.map((item) => String(item.name || '')).filter(Boolean)
    : [];
  const primaryStrategyName = validationStrategyNames[0] || 'alpha';
  const secondaryStrategyName = validationStrategyNames[1] || primaryStrategyName;

  const routerBuildResult = await runBuildRouterArtifacts({
    trainConfigPath: trainingConfigPath,
    trainConfigRef: trainingConfigKey,
  }, {
    db: registryDb,
    trainRoot,
    trainingConfig,
    skipEnsureSchema: true,
  });

  const updatedTraining = registryDb.state.configs
    .filter((item) => item.config_key === trainingConfigKey && item.status === 'active')
    .sort((left, right) => right.version_no - left.version_no)[0];
  assert.ok(updatedTraining.content.regimeRouting.routerConfigPath);
  assert.ok(updatedTraining.content.regimeRouting.policyCatalogPath);
  assert.equal(routerBuildResult.routerConfigKey, 'configs/generated/regime-routing/2025_btcjpy_feature_flow_router.json');
  assert.equal(routerBuildResult.policyConfigKey, 'configs/generated/regime-routing/2025_btcjpy_feature_flow_router.policy.json');

  const validationTrades = [
    { strategy_name: primaryStrategyName, exit_time: Date.parse('2025-01-03T12:00:00.000Z'), pnl: 80 },
    { strategy_name: secondaryStrategyName, exit_time: Date.parse('2025-01-03T12:00:00.000Z'), pnl: -20 },
    { strategy_name: primaryStrategyName, exit_time: Date.parse('2025-01-10T12:00:00.000Z'), pnl: -30 },
    { strategy_name: secondaryStrategyName, exit_time: Date.parse('2025-01-10T12:00:00.000Z'), pnl: 60 },
  ];
  const validationKlines = fixtures.klines.filter((row) => {
    const openTime = Number(row.open_time);
    return openTime >= Date.parse('2025-01-03T00:00:00.000Z')
      && openTime <= Date.parse('2025-01-10T00:07:00.000Z');
  });
  const originalQuery = dbModule.default.query;
  dbModule.default.query = async (sql, params = []) => {
    const text = String(sql);
    assert.equal(countPlaceholders(text), params.length, `SQL placeholders mismatch: ${text}`);
    if (text.includes(`FROM ${TRAIN_CONFIGS_TABLE} tc`) && text.includes('WHERE tc.config_key = ?')) {
      const configKey = String(params[0] || '');
      const row = registryDb.state.configs
        .filter((item) => item.config_key === configKey && item.status === 'active')
        .sort((left, right) => right.version_no - left.version_no || right.id - left.id)[0];
      return [row ? [{ ...row, content: row.content }] : [], {}];
    }
    if (text.includes('FROM feature_candidate_pools')) {
      const monthlyPools = Array.isArray(artifacts.rollingPackage?.rollingPlan?.monthlyPools)
        ? artifacts.rollingPackage.rollingPlan.monthlyPools
        : [];
      const rows = monthlyPools.flatMap((pool) => {
        const startMs = Date.parse(`${String(pool.month || '2025-01')}-01T00:00:00.000Z`);
        const topStrategies = Array.isArray(pool.topStrategies) ? pool.topStrategies : [];
        return topStrategies.map((strategy, index) => ({
          window_start_ms: startMs,
          rank_no: index + 1,
          strategy_name: String(strategy.strategyName || ''),
        }));
      });
      return [rows, {}];
    }
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
      routerConfigPath: routerBuildResult.routerConfigKey,
      tradeCreatedAt: '2026-03-25 10:00:00',
    });

    assert.equal(routerReport.symbol, 'BTCJPY');
    assert.equal(routerReport.policyCatalog !== null, true);
    assert.equal(routerReport.dailyRoutes.length >= 1, true);
    assert.equal(typeof routerReport.comparison.router.totalPnl, 'number');
    assert.equal(routerReport.comparison.router.tradedDays > 0, true);
    assert.notEqual(routerReport.comparison.router.totalPnl, 0);
  } finally {
    dbModule.default.query = originalQuery;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
