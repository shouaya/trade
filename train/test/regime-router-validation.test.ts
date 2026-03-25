const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { test } = require('./harness.ts');
const dbModule = require('../dist/configs/database.js');
const { runRouterValidation } = require('../dist/services/regime-router-validation.js');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
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

test('runRouterValidation applies rolling rules, monthly pools, and loss guards', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'money-router-validation-'));
  const validationPath = path.join(tempDir, 'validation.json');
  const routerPath = path.join(tempDir, 'router.json');
  const policyPath = path.join(tempDir, 'router.policy.json');

  const validationConfig = {
    name: 'BTCJPY_ROLLING_VALIDATION',
    timeRange: {
      startTimeMs: Date.parse('2025-01-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2025-01-03T23:59:00.000Z'),
    },
    market: {
      symbol: 'BTCJPY',
      intervalType: '1min',
    },
    strategy: {
      explicitStrategies: [
        {
          rank: 1,
          name: 'alpha',
          type: 'rsi_macd',
          parameters: {
            atr: { slMultiplier: 2, tpMultiplier: 4 },
            rsi: { oversold: 25, overbought: 75 },
            risk: { maxHoldMinutes: 6 },
          },
        },
        {
          rank: 2,
          name: 'beta',
          type: 'rsi_macd',
          parameters: {
            atr: { slMultiplier: 2.5, tpMultiplier: 5 },
            rsi: { oversold: 30, overbought: 70 },
            risk: { maxHoldMinutes: 8 },
          },
        },
      ],
    },
    featureEngineering: {
      openingWindowMinutes: 1,
      volBaselineLookbackPeriods: 1,
    },
  };

  const routerConfig = {
    symbol: 'BTCJPY',
    routerVersion: 'btcjpy_router_v2',
    policyCatalogPath: './router.policy.json',
    executionModel: {
      precedence: ['monthly_guard', 'weekly_guard', 'daily_router', 'loss_recheck'],
      defaultFallback: {
        action: 'trade',
        riskMultiplier: 1,
        strategyKey: 'rank1',
      },
    },
    strategyCatalog: {
      rank1: { strategyName: 'alpha', shortLabel: 'TOP1', role: 'default-fallback' },
      rank2: { strategyName: 'beta', shortLabel: 'TOP2', role: 'candidate' },
    },
    rules: [
      {
        id: 'month_pool_bias',
        layer: 'monthly_guard',
        priority: 1,
        when: {
          positiveStrategyRatio: { gte: 50 },
          bestVsMedianGap: { gte: 0 },
        },
        action: {
          type: 'trade',
          riskCap: 0.8,
          strategyKey: 'rank1',
        },
      },
      {
        id: 'week_alignment_cap',
        layer: 'weekly_guard',
        priority: 1,
        when: {
          monthlyWeeklyAlignment: { gte: 0.5 },
        },
        action: {
          type: 'trade',
          riskCap: 0.5,
        },
      },
      {
        id: 'day_vol_route',
        layer: 'daily_router',
        priority: 1,
        when: {
          anyOf: [
            { volExpansionRatio: { gte: 1 } },
            { openingImpulse: { lte: 0 } },
          ],
        },
        action: {
          type: 'reduce',
          riskMultiplier: 0.5,
          strategyKey: 'rank2',
        },
      },
      {
        id: 'loss_pause',
        layer: 'loss_recheck',
        priority: 1,
        when: {
          previousDayFeatureBucket: [
            'range-low-vol',
            'range-mid-vol',
            'mixed-trend',
            'strong-trend',
            'crash-trend',
          ],
          previousDayRoutedPnl: { lt: 0 },
          consecutiveLossDays: { gte: 1 },
        },
        action: {
          type: 'stop',
        },
      },
    ],
  };

  const policyCatalog = {
    symbol: 'BTCJPY',
    routerVersion: 'btcjpy_router_v2',
    catalogVersion: 'policy_v2',
    generatedDate: '2026-03-25',
    source: {
      routerConfigPath: 'router.json',
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
        eventSegment: 'month pool bias',
        layer: 'monthly_guard',
        ruleId: 'month_pool_bias',
        featureSummary: 'positiveStrategyRatio >= 50',
        actionType: 'trade',
        riskCap: 0.8,
        strategy: {
          strategyKey: 'rank1',
          strategyLabel: 'TOP1',
          strategyName: 'alpha',
        },
      },
      {
        eventSegment: 'week alignment',
        layer: 'weekly_guard',
        ruleId: 'week_alignment_cap',
        featureSummary: 'monthlyWeeklyAlignment >= 0.5',
        actionType: 'trade',
        riskCap: 0.5,
      },
    ],
    dailyGuards: [
      {
        eventSegment: 'day route',
        layer: 'daily_router',
        ruleId: 'day_vol_route',
        featureSummary: 'volExpansionRatio >= 1',
        actionType: 'reduce',
        riskMultiplier: 0.5,
        strategy: {
          strategyKey: 'rank2',
          strategyLabel: 'TOP2',
          strategyName: 'beta',
        },
      },
      {
        eventSegment: 'loss pause',
        layer: 'loss_recheck',
        ruleId: 'loss_pause',
        featureSummary: 'previousDayRoutedPnl < 0',
        actionType: 'stop',
      },
    ],
  };

  writeJson(validationPath, validationConfig);
  writeJson(routerPath, routerConfig);
  writeJson(policyPath, policyCatalog);

  const trades = [
    { strategy_name: 'alpha', exit_time: Date.parse('2025-01-01T12:00:00.000Z'), pnl: 40 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-01-01T12:00:00.000Z'), pnl: -50 },
    { strategy_name: 'alpha', exit_time: Date.parse('2025-01-02T12:00:00.000Z'), pnl: -30 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-01-02T12:00:00.000Z'), pnl: 80 },
    { strategy_name: 'alpha', exit_time: Date.parse('2025-01-03T12:00:00.000Z'), pnl: 10 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-01-03T12:00:00.000Z'), pnl: 20 },
  ];

  const klines = [
    makeKlineRow('2025-01-01T00:00:00.000Z', 100, 101, 99, 99.5),
    makeKlineRow('2025-01-01T00:01:00.000Z', 99.5, 100, 99, 99),
    makeKlineRow('2025-01-02T00:00:00.000Z', 99, 99.5, 97.5, 98),
    makeKlineRow('2025-01-02T00:01:00.000Z', 98, 98.5, 96.5, 97),
    makeKlineRow('2025-01-03T00:00:00.000Z', 97, 99, 96.8, 98.8),
    makeKlineRow('2025-01-03T00:01:00.000Z', 98.8, 100.2, 98.5, 100),
  ];

  const originalQuery = dbModule.default.query;
  dbModule.default.query = async (sql) => {
    const text = String(sql);
    if (text.includes('FROM feature_candidate_pools')) {
      return [[{
        window_start_ms: Date.parse('2025-01-01T00:00:00.000Z'),
        strategy_name: 'beta',
      }], {}];
    }
    if (text.includes('FROM trades') && text.includes('ORDER BY exit_time ASC')) {
      return [trades, {}];
    }
    if (text.includes('FROM klines')) {
      return [klines, {}];
    }
    throw new Error(`Unexpected SQL: ${text}`);
  };

  try {
    const report = await runRouterValidation({
      validationConfigPath: validationPath,
      routerConfigPath: routerPath,
      tradeCreatedAt: '2026-03-25 00:00:00',
    });

    assert.equal(report.symbol, 'BTCJPY');
    assert.equal(report.routerVersion, 'btcjpy_router_v2');
    assert.equal(report.tradeCreatedAt, '2026-03-25 00:00:00');
    assert.equal(report.policyCatalog.catalogVersion, 'policy_v2');
    assert.equal(report.dailyRoutes.length, 3);

    const [day1, day2, day3] = report.dailyRoutes;
    assert.equal(day1.selectedStrategyName, 'beta');
    assert.equal(day1.dayRuleId, 'day_vol_route');
    assert.equal(day1.monthRuleId, null);
    assert.equal(day1.weekRuleId, null);
    assert.equal(day1.effectiveRiskMultiplier, 0.5);
    assert.equal(day1.positiveStrategyRatio, 0);
    assert.equal(day1.routedPnl, -25);

    assert.equal(day2.lossRuleId, 'loss_pause');
    assert.equal(day2.selectedStrategyKey, null);
    assert.equal(day2.effectiveRiskMultiplier, 0);
    assert.equal(day2.previousDayRoutedPnl, -25);
    assert.equal(day2.consecutiveLossDaysBefore, 1);
    assert.equal(day2.routedPnl, 0);

    assert.equal(day3.selectedStrategyName, 'beta');
    assert.equal(day3.positiveStrategyRatio, 100);
    assert.equal(day3.routedPnl, 10);
    assert.equal(day3.oracleBestOfDayPnl, 20);

    assert.equal(report.comparison.router.totalPnl, -15);
    assert.equal(report.comparison.defaultStrategy.totalPnl, 20);
    assert.equal(report.comparison.rank1Strategy.totalPnl, 20);
    assert.equal(report.comparison.top10EqualWeight.totalPnl, 35);
    assert.equal(report.comparison.oracleBestOfDay.totalPnl, 140);
    assert.equal(report.comparison.router.negativeDays, 1);
    assert.equal(report.comparison.router.tradedDays, 2);
    assert.equal(report.comparison.router.finalEquity, 999985);
  } finally {
    dbModule.default.query = originalQuery;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runRouterValidation uses opening-window daily features instead of full-day hindsight buckets', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'money-router-opening-'));
  const validationPath = path.join(tempDir, 'validation.json');
  const routerPath = path.join(tempDir, 'router.json');

  writeJson(validationPath, {
    name: 'OPENING_WINDOW_CAUSAL_VALIDATION',
    timeRange: {
      startTimeMs: Date.parse('2025-02-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2025-02-01T23:59:00.000Z'),
    },
    market: {
      symbol: 'BTCJPY',
      intervalType: '1min',
    },
    strategy: {
      explicitStrategies: [
        {
          rank: 1,
          name: 'alpha',
          type: 'rsi_macd',
          parameters: {
            atr: { slMultiplier: 2, tpMultiplier: 4 },
            rsi: { oversold: 25, overbought: 75 },
            risk: { maxHoldMinutes: 6 },
          },
        },
        {
          rank: 2,
          name: 'beta',
          type: 'rsi_macd',
          parameters: {
            atr: { slMultiplier: 2, tpMultiplier: 4 },
            rsi: { oversold: 30, overbought: 70 },
            risk: { maxHoldMinutes: 8 },
          },
        },
      ],
    },
    featureEngineering: {
      openingWindowMinutes: 1,
      volBaselineLookbackPeriods: 1,
    },
  });

  writeJson(routerPath, {
    symbol: 'BTCJPY',
    routerVersion: 'btcjpy_router_opening_only',
    executionModel: {
      precedence: ['monthly_guard', 'weekly_guard', 'daily_router', 'loss_recheck'],
      defaultFallback: {
        action: 'trade',
        riskMultiplier: 1,
        strategyKey: 'rank1',
      },
    },
    strategyCatalog: {
      rank1: { strategyName: 'alpha', shortLabel: 'TOP1', role: 'default-fallback' },
      rank2: { strategyName: 'beta', shortLabel: 'TOP2', role: 'candidate' },
    },
    rules: [
      {
        id: 'opening-range-route',
        layer: 'daily_router',
        priority: 1,
        when: {
          featureBucket: ['range-low-vol'],
        },
        action: {
          type: 'trade',
          strategyKey: 'rank2',
        },
      },
    ],
  });

  const trades = [
    { strategy_name: 'alpha', exit_time: Date.parse('2025-02-01T12:00:00.000Z'), pnl: -10 },
    { strategy_name: 'beta', exit_time: Date.parse('2025-02-01T12:00:00.000Z'), pnl: 50 },
  ];

  const klines = [
    makeKlineRow('2025-02-01T00:00:00.000Z', 100, 100.2, 99.9, 100.05),
    makeKlineRow('2025-02-01T00:01:00.000Z', 100.05, 104.5, 99.8, 104),
  ];

  const originalQuery = dbModule.default.query;
  dbModule.default.query = async (sql) => {
    const text = String(sql);
    if (text.includes('FROM feature_candidate_pools')) {
      return [[
        {
          window_start_ms: Date.parse('2025-02-01T00:00:00.000Z'),
          strategy_name: 'alpha',
        },
        {
          window_start_ms: Date.parse('2025-02-01T00:00:00.000Z'),
          strategy_name: 'beta',
        },
      ], {}];
    }
    if (text.includes('FROM trades') && text.includes('ORDER BY exit_time ASC')) {
      return [trades, {}];
    }
    if (text.includes('FROM klines')) {
      return [klines, {}];
    }
    throw new Error(`Unexpected SQL: ${text}`);
  };

  try {
    const report = await runRouterValidation({
      validationConfigPath: validationPath,
      routerConfigPath: routerPath,
      tradeCreatedAt: '2026-03-25 00:00:00',
    });

    assert.equal(report.dailyRoutes.length, 1);
    assert.equal(report.dailyRoutes[0].featureBucket, 'range-low-vol');
    assert.equal(report.dailyRoutes[0].selectedStrategyName, 'beta');
    assert.equal(report.dailyRoutes[0].routedPnl, 50);
    assert.equal(report.comparison.router.totalPnl, 50);
  } finally {
    dbModule.default.query = originalQuery;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runRouterValidation can auto-detect trade batch and handle empty samples', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'money-router-batch-'));
  const validationPath = path.join(tempDir, 'validation.json');
  const routerPath = path.join(tempDir, 'router.json');

  writeJson(validationPath, {
    name: 'EMPTY_SAMPLE_VALIDATION',
    timeRange: {
      startTimeMs: Date.parse('2025-02-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2025-02-02T00:00:00.000Z'),
    },
    market: {
      symbol: 'BTCUSD',
      intervalType: '1min',
    },
    strategy: {
      explicitStrategies: [
        {
          rank: 1,
          name: 'solo',
          type: 'rsi_only',
          parameters: {
            rsi: { oversold: 20, overbought: 80 },
            risk: { maxHoldMinutes: 5 },
          },
        },
      ],
    },
  });

  writeJson(routerPath, {
    symbol: 'BTCUSD',
    routerVersion: 'router_empty_v1',
    executionModel: {
      precedence: ['daily_router'],
      defaultFallback: {
        action: 'trade',
        riskMultiplier: 1,
        strategyKey: 'rank1',
      },
    },
    strategyCatalog: {
      rank1: {
        strategyName: 'solo',
        shortLabel: 'TOP1',
      },
    },
    rules: [],
  });

  const originalQuery = dbModule.default.query;
  dbModule.default.query = async (sql) => {
    const text = String(sql);
    if (text.includes('FROM feature_candidate_pools')) {
      return [[], {}];
    }
    if (text.includes('DATE_FORMAT(MAX(created_at)')) {
      return [[{ created_at: '2026-03-24 12:34:56' }], {}];
    }
    if (text.includes('FROM trades') && text.includes('ORDER BY exit_time ASC')) {
      return [[], {}];
    }
    if (text.includes('FROM klines')) {
      return [[], {}];
    }
    throw new Error(`Unexpected SQL: ${text}`);
  };

  try {
    const report = await runRouterValidation({
      validationConfigPath: validationPath,
      routerConfigPath: routerPath,
    });

    assert.equal(report.tradeCreatedAt, '2026-03-24 12:34:56');
    assert.equal(report.policyCatalog, null);
    assert.equal(report.dailyRoutes.length, 0);
    assert.equal(report.comparison.router.totalPnl, 0);
    assert.equal(report.comparison.router.finalEquity, 10000);
  } finally {
    dbModule.default.query = originalQuery;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runRouterValidation can load validation and router configs from db when files are absent', async () => {
  const originalQuery = dbModule.default.query;
  dbModule.default.query = async (sql, params = []) => {
    const text = String(sql);

    if (text.includes('FROM train_configs tc')) {
      const key = String(params[0] || '');
      if (key === 'configs/validation/db_validation.json') {
        return [[{
          content: {
            name: 'DB_VALIDATION',
            trainId: 'train-db-1',
            timeRange: {
              startTimeMs: Date.parse('2025-03-01T00:00:00.000Z'),
              endTimeMs: Date.parse('2025-03-01T23:59:00.000Z'),
            },
            market: {
              symbol: 'BTCJPY',
              intervalType: '1min',
            },
            strategy: {
              explicitStrategies: [
                {
                  rank: 1,
                  name: 'alpha',
                  type: 'rsi_macd',
                  parameters: {
                    atr: { slMultiplier: 2, tpMultiplier: 4 },
                    rsi: { oversold: 25, overbought: 75 },
                    risk: { maxHoldMinutes: 6 },
                  },
                },
              ],
            },
          },
        }], {}];
      }
      if (key === 'configs/generated/regime-routing/db_router.json') {
        return [[{
          content: {
            symbol: 'BTCJPY',
            routerVersion: 'db_router_v1',
            executionModel: {
              precedence: ['daily_router'],
              defaultFallback: {
                action: 'trade',
                riskMultiplier: 1,
                strategyKey: 'rank1',
              },
            },
            strategyCatalog: {
              rank1: {
                strategyName: 'alpha',
                shortLabel: 'TOP1',
              },
            },
            rules: [],
          },
        }], {}];
      }
      return [[], {}];
    }
    if (text.includes('FROM feature_candidate_pools')) {
      return [[], {}];
    }

    if (text.includes('FROM trades') && text.includes('ORDER BY exit_time ASC')) {
      return [[
        { strategy_name: 'alpha', exit_time: Date.parse('2025-03-01T12:00:00.000Z'), pnl: 25 },
      ], {}];
    }
    if (text.includes('FROM klines')) {
      return [[
        makeKlineRow('2025-03-01T00:00:00.000Z', 100, 101, 99.5, 100.5),
      ], {}];
    }
    throw new Error(`Unexpected SQL: ${text}`);
  };

  try {
    const report = await runRouterValidation({
      validationConfigPath: 'configs/validation/db_validation.json',
      routerConfigPath: 'configs/generated/regime-routing/db_router.json',
      tradeCreatedAt: '2026-03-25 00:00:00',
    });

    assert.equal(report.symbol, 'BTCJPY');
    assert.equal(report.routerVersion, 'db_router_v1');
    assert.equal(report.dailyRoutes.length, 1);
    assert.equal(report.dailyRoutes[0].selectedStrategyName, 'alpha');
    assert.equal(report.comparison.router.totalPnl, 25);
  } finally {
    dbModule.default.query = originalQuery;
  }
});

test('runRouterValidation uses feature-memory monthly candidate pools when rollingPlan is absent', async () => {
  const originalQuery = dbModule.default.query;
  dbModule.default.query = async (sql, params = []) => {
    const text = String(sql);

    if (text.includes('FROM feature_candidate_pools')) {
      return [[
        {
          window_start_ms: Date.parse('2025-04-01T00:00:00.000Z'),
          rank_no: 1,
          strategy_name: 'beta',
        },
      ], {}];
    }
    if (text.includes('FROM trades') && text.includes('ORDER BY exit_time ASC')) {
      return [[
        { strategy_name: 'alpha', exit_time: Date.parse('2025-04-01T12:00:00.000Z'), pnl: -40 },
        { strategy_name: 'beta', exit_time: Date.parse('2025-04-01T12:00:00.000Z'), pnl: 60 },
        { strategy_name: 'alpha', exit_time: Date.parse('2025-04-02T12:00:00.000Z'), pnl: -10 },
        { strategy_name: 'beta', exit_time: Date.parse('2025-04-02T12:00:00.000Z'), pnl: 30 },
      ], {}];
    }
    if (text.includes('FROM klines')) {
      return [[
        makeKlineRow('2025-03-01T00:00:00.000Z', 100, 100.5, 99.7, 100.1),
        makeKlineRow('2025-03-01T00:01:00.000Z', 100.1, 100.6, 99.9, 100.2),
        makeKlineRow('2025-04-01T00:00:00.000Z', 100, 100.2, 99.8, 100.05),
        makeKlineRow('2025-04-02T00:00:00.000Z', 100.05, 100.4, 99.9, 100.2),
      ], {}];
    }
    throw new Error(`Unexpected SQL: ${text} :: ${JSON.stringify(params)}`);
  };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'money-router-memory-pool-'));
  const validationPath = path.join(tempDir, 'validation.json');
  const routerPath = path.join(tempDir, 'router.json');

    writeJson(validationPath, {
      name: 'MEMORY_POOL_VALIDATION',
      trainId: 'train-memory-pool-1',
      timeRange: {
        startTimeMs: Date.parse('2025-04-01T00:00:00.000Z'),
        endTimeMs: Date.parse('2025-04-02T23:59:00.000Z'),
      },
    market: {
      symbol: 'BTCJPY',
      intervalType: '1min',
    },
    strategy: {
      explicitStrategies: [
        {
          rank: 1,
          name: 'alpha',
          type: 'rsi_macd',
          parameters: {
            atr: { slMultiplier: 2, tpMultiplier: 4 },
            rsi: { oversold: 25, overbought: 75 },
            risk: { maxHoldMinutes: 6 },
          },
        },
        {
          rank: 2,
          name: 'beta',
          type: 'rsi_macd',
          parameters: {
            atr: { slMultiplier: 2, tpMultiplier: 4 },
            rsi: { oversold: 30, overbought: 70 },
            risk: { maxHoldMinutes: 8 },
          },
        },
      ],
    },
    featureEngineering: {
      openingWindowMinutes: 1,
      volBaselineLookbackPeriods: 1,
    },
  });

  writeJson(routerPath, {
    symbol: 'BTCJPY',
    routerVersion: 'memory_pool_router_v1',
    executionModel: {
      precedence: ['daily_router'],
      defaultFallback: {
        action: 'trade',
        riskMultiplier: 1,
        strategyKey: 'rank1',
      },
    },
    strategyCatalog: {
      rank1: { strategyName: 'alpha', shortLabel: 'TOP1', role: 'default-fallback' },
      rank2: { strategyName: 'beta', shortLabel: 'TOP2', role: 'candidate' },
    },
    rules: [
      {
        id: 'positive_pool_route',
        layer: 'daily_router',
        priority: 1,
        when: {
          positiveStrategyRatio: { gte: 100 },
        },
        action: {
          type: 'trade',
          strategyKey: 'rank2',
        },
      },
    ],
  });

    try {
      const report = await runRouterValidation({
        validationConfigPath: validationPath,
        routerConfigPath: routerPath,
        tradeCreatedAt: '2026-03-25 00:00:00',
      });

    assert.equal(report.dailyRoutes.length, 2);
    assert.equal(report.dailyRoutes[0].positiveStrategyRatio, 0);
    assert.equal(report.dailyRoutes[0].selectedStrategyName, 'alpha');
    assert.equal(report.dailyRoutes[1].positiveStrategyRatio, 100);
    assert.equal(report.dailyRoutes[1].selectedStrategyName, 'beta');
    assert.equal(report.comparison.router.totalPnl, -10);
  } finally {
    dbModule.default.query = originalQuery;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
