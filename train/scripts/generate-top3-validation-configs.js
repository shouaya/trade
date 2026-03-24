#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const crypto = require('crypto');
const {
  BACKTEST_RESULTS_TABLE,
  createMysqlConnectionWithFallback,
  loadEnvFiles
} = require('@money/database');

loadEnvFiles(dotenv, [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../backend/.env'),
  path.resolve(__dirname, '../../.env')
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const index = arg.indexOf('=');
    if (index === -1) continue;
    args[arg.slice(0, index).replace(/^--/, '')] = arg.slice(index + 1);
  }
  return args;
}

function required(args, key) {
  const value = args[key];
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

function getYearFromConfig(config, fallbackName) {
  const baseYear = String(fallbackName || '').match(/^(\d{4})_/);
  if (baseYear) {
    return baseYear[1] || null;
  }

  const startIso = config?.timeRange?.startIso;
  if (startIso) {
    const year = new Date(startIso).getUTCFullYear();
    return Number.isNaN(year) ? null : String(year);
  }

  const startMs = config?.timeRange?.startTimeMs;
  if (startMs != null) {
    const year = new Date(Number(startMs)).getUTCFullYear();
    return Number.isNaN(year) ? null : String(year);
  }

  return null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function resolveTrainConfigRef(trainConfigPath, explicitRef) {
  if (explicitRef) {
    return toPosix(explicitRef);
  }

  const trainRoot = path.resolve(__dirname, '..');
  const relativePath = path.relative(trainRoot, trainConfigPath);
  return toPosix(relativePath);
}

function normalizeValidationProfile(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'future-window' || normalized === 'rolling-window' || normalized === 'custom-range') {
    return normalized;
  }
  return 'future-window';
}

function buildValidationTableName(symbol, year) {
  return `backtest_results_validation_${symbol.toLowerCase()}_${year}`;
}

function buildExactValidationTableName(symbol, year, limit, outPrefix) {
  const digest = crypto
    .createHash('md5')
    .update(`${outPrefix}:${symbol}:${year}:${limit}`)
    .digest('hex')
    .slice(0, 8);

  return `backtest_results_top${limit}_${symbol.toLowerCase()}_${year}_${digest}`;
}

function formatIsoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatCompactDate(value) {
  return formatIsoDate(value).replace(/-/g, '_');
}

function toUtcStartOfDay(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0);
}

function toUtcEndOfDay(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 0);
}

function toUtcStartOfMonth(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0);
}

function toUtcEndOfMonth(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 0);
}

function buildTimeRange(startMs, endMs) {
  return {
    startTimeMs: startMs,
    endTimeMs: endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString()
  };
}

function buildSnapshotFileName(outPrefix, limit) {
  return outPrefix.endsWith(`top${limit}`)
    ? `${outPrefix}.generated.json`
    : `${outPrefix}_top${limit}.generated.json`;
}

function buildValidationArtifacts({
  validationDefinitions,
  outPrefix,
  limit,
  symbol,
  trainingYear,
  trainConfig,
  sourceTable,
  trainConfigRef,
  exact,
  strategyPrefix,
  descriptionPrefix,
  explicitStrategies,
  merged,
  sourceRunId,
  rows,
  profile
}) {
  const validationConfigs = validationDefinitions.map((definition) => {
    const configKey = `configs/validation/${outPrefix}_${definition.suffix}.json`;
    return {
      configKey,
      configType: 'validation',
      content: {
        name: `${symbol}_TOP${limit}_${definition.shortLabel.toUpperCase().replace(/-/g, '_')}_FROM_${trainingYear}_VALIDATION`,
        description: `${symbol} ${definition.descriptionLabel} - 基于 ${trainingYear} training Top${limit} 参数`,
        timeRange: definition.timeRange,
        market: {
          symbol,
          intervalType: trainConfig.market.intervalType
        },
        database: {
          tableName: exact
            ? buildExactValidationTableName(symbol, definition.tableToken, limit, `${outPrefix}_${definition.suffix}`)
            : buildValidationTableName(symbol, definition.tableToken),
          resetTableBeforeRun: true
        },
        strategy: {
          ...(exact
            ? { explicitStrategies }
            : {
                types: trainConfig.strategy.types,
                parameters: merged
              })
        },
        executor: trainConfig.executor,
        output: {
          topN: limit,
          strategyNamePrefix: `${strategyPrefix}${definition.shortLabel.toUpperCase()}-`,
          descriptionPrefix: `${descriptionPrefix} ${definition.descriptionLabel}`
        },
        sourceTable,
        trainConfig: trainConfigRef,
        validationProfile: profile,
        validationTarget: {
          label: definition.label,
          cutoffDate: formatIsoDate(definition.timeRange.endTimeMs),
          startIso: definition.timeRange.startIso,
          endIso: definition.timeRange.endIso
        }
      }
    };
  });

  const snapshotConfigKey = `configs/top-strategies/${buildSnapshotFileName(outPrefix, limit)}`;
  const snapshotContent = {
    artifactType: 'final-strategy-config',
    name: `${symbol}_TOP${limit}_FINAL_CONFIG_FROM_${trainingYear}`,
    description: `${symbol} Top${limit} 最终策略配置 - 基于 ${trainingYear} training 候选池`,
    generatedAt: new Date().toISOString(),
    sourceTable,
    sourcePhysicalTable: BACKTEST_RESULTS_TABLE,
    sourceRunId,
    symbol,
    market: {
      symbol,
      intervalType: trainConfig.market.intervalType
    },
    executor: trainConfig.executor,
    strategy: {
      explicitStrategies
    },
    output: {
      topN: limit,
      persistTopStrategies: false,
      persistTrades: false,
      strategyNamePrefix: `${strategyPrefix}FINAL-`,
      descriptionPrefix: `${descriptionPrefix} final strategy package`
    },
    trainingContext: {
      trainingYear,
      timeRange: trainConfig.timeRange,
      resultGroup: sourceTable
    },
    validationTargets: validationDefinitions.map((definition) => ({
      label: definition.label,
      startIso: definition.timeRange.startIso,
      endIso: definition.timeRange.endIso
    })),
    validationProfile: profile,
    exact,
    limit,
    trainConfig: trainConfigRef,
    strategies: rows.map((row, index) => ({
      rank: index + 1,
      strategyName: row.strategy_name,
      strategyType: row.strategy_type,
      totalTrades: row.total_trades,
      winRate: row.win_rate,
      totalPnl: row.total_pnl,
      score: row.score,
      parameters: typeof row.parameters === 'string' ? JSON.parse(row.parameters) : row.parameters
    }))
  };

  return {
    validationConfigs,
    snapshot: {
      configKey: snapshotConfigKey,
      configType: 'top-strategies',
      content: snapshotContent
    }
  };
}

async function loadKlineCoverage(connection, symbol, intervalType) {
  const [rows] = await connection.query(
    `SELECT MIN(open_time) AS min_open_time, MAX(open_time) AS max_open_time
     FROM klines
     WHERE symbol = ?
       AND interval_type = ?`,
    [symbol, intervalType]
  );

  const row = rows[0] || {};
  const minOpenTime = row.min_open_time == null ? null : Number(row.min_open_time);
  const maxOpenTime = row.max_open_time == null ? null : Number(row.max_open_time);

  if (minOpenTime == null || maxOpenTime == null) {
    throw new Error(`no klines found for symbol=${symbol} interval=${intervalType}`);
  }

  return {
    minOpenTime,
    maxOpenTime
  };
}

function buildValidationDefinitions({
  profile,
  trainingYear,
  symbol,
  limit,
  trainConfig,
  coverage,
  customStartIso,
  customEndIso
}) {
  const trainingEndSource = trainConfig?.timeRange?.endIso || trainConfig?.timeRange?.endTimeMs;
  if (!trainingEndSource) {
    throw new Error('training end time is missing');
  }

  const trainingEndDate = new Date(trainingEndSource);
  if (Number.isNaN(trainingEndDate.getTime())) {
    throw new Error('training end time is invalid');
  }

  const futureStartMs = toUtcStartOfDay(trainingEndDate.getTime() + 24 * 60 * 60 * 1000);
  const futureEndMs = Number(coverage.maxOpenTime);

  if (futureStartMs > futureEndMs) {
    throw new Error(`future window is empty for symbol=${symbol}`);
  }

  if (profile === 'future-window') {
    const startLabel = formatIsoDate(futureStartMs);
    const cutoffLabel = formatIsoDate(futureEndMs);
    return [
      {
        suffix: `future_from_${trainingYear}_to_${formatCompactDate(futureEndMs)}_validation`,
        label: `future ${startLabel} -> ${cutoffLabel}`,
        shortLabel: 'future-window',
        tableToken: `future_${formatCompactDate(futureEndMs)}`,
        descriptionLabel: `未来期 ${startLabel} -> ${cutoffLabel}`,
        timeRange: buildTimeRange(futureStartMs, futureEndMs)
      }
    ];
  }

  if (profile === 'custom-range') {
    if (!customStartIso || !customEndIso) {
      throw new Error('custom-range requires validationPlan.customRange');
    }

    const startMs = toUtcStartOfDay(customStartIso);
    const endMs = toUtcEndOfDay(customEndIso);
    if (startMs > endMs) {
      throw new Error('custom validation range is invalid');
    }

    return [
      {
        suffix: `custom_${formatCompactDate(startMs)}_to_${formatCompactDate(endMs)}_validation`,
        label: `custom ${formatIsoDate(startMs)} -> ${formatIsoDate(endMs)}`,
        shortLabel: 'custom-range',
        tableToken: `custom_${formatCompactDate(startMs)}_${formatCompactDate(endMs)}`,
        descriptionLabel: `自定义验证 ${formatIsoDate(startMs)} -> ${formatIsoDate(endMs)}`,
        timeRange: buildTimeRange(startMs, endMs)
      }
    ];
  }

  if (profile === 'rolling-window') {
    const definitions = [];
    let cursorMs = toUtcStartOfMonth(futureStartMs);

    while (cursorMs <= futureEndMs) {
      const cursorDate = new Date(cursorMs);
      const monthToken = `${cursorDate.getUTCFullYear()}_${String(cursorDate.getUTCMonth() + 1).padStart(2, '0')}`;
      const segmentStartMs = Math.max(futureStartMs, cursorMs);
      const segmentEndMs = Math.min(futureEndMs, toUtcEndOfMonth(cursorMs));
      if (segmentStartMs > segmentEndMs) {
        cursorMs = Date.UTC(cursorDate.getUTCFullYear(), cursorDate.getUTCMonth() + 1, 1, 0, 0, 0);
        continue;
      }

      definitions.push({
        suffix: `rolling_${monthToken}_validation`,
        label: `rolling ${formatIsoDate(segmentStartMs)} -> ${formatIsoDate(segmentEndMs)}`,
        shortLabel: 'rolling-window',
        tableToken: `rolling_${monthToken}`,
        descriptionLabel: `Rolling 验证 ${formatIsoDate(segmentStartMs)} -> ${formatIsoDate(segmentEndMs)}`,
        timeRange: buildTimeRange(segmentStartMs, segmentEndMs)
      });

      cursorMs = Date.UTC(cursorDate.getUTCFullYear(), cursorDate.getUTCMonth() + 1, 1, 0, 0, 0);
    }

    if (!definitions.length) {
      throw new Error(`rolling-window produced no validation windows for ${symbol}`);
    }

    return definitions;
  }

  throw new Error(`unsupported validation profile: ${profile}`);
}

async function findLatestRunId(connection, resultGroup) {
  const [rows] = await connection.query(
    `SELECT run_id
     FROM ${BACKTEST_RESULTS_TABLE}
     WHERE result_group = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [resultGroup]
  );

  return rows[0] && rows[0].run_id ? String(rows[0].run_id) : null;
}

async function main() {
  const args = parseArgs(process.argv);
  const trainConfigPath = path.resolve(required(args, 'trainConfig'));
  const trainConfig = readJson(trainConfigPath);
  const symbol = required(args, 'symbol').toUpperCase();
  const sourceTable = required(args, 'sourceTable');
  const outPrefix = required(args, 'outPrefix');
  const trainConfigRef = resolveTrainConfigRef(trainConfigPath, args.trainConfigRef);
  const strategyPrefix = required(args, 'strategyPrefix');
  const descriptionPrefix = required(args, 'descriptionPrefix');
  const limit = Number(args.limit || '3');
  const exact = String(args.exact || 'false').toLowerCase() === 'true';
  const profile = normalizeValidationProfile(args.profile || 'future-window');
  const outputMode = String(args.outputMode || 'files').trim().toLowerCase();

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`invalid --limit=${args.limit}`);
  }

  const connection = await createMysqlConnectionWithFallback(mysql, {
    defaults: {
      host: '127.0.0.1'
    }
  });

  try {
    const trainingYear = getYearFromConfig(trainConfig, path.basename(trainConfigPath)) || 'run';
    const validationPlan = trainConfig.validationPlan && typeof trainConfig.validationPlan === 'object'
      ? trainConfig.validationPlan
      : {};
    const customRange = validationPlan.customRange && typeof validationPlan.customRange === 'object'
      ? validationPlan.customRange
      : {};
    const coverage = await loadKlineCoverage(connection, symbol, trainConfig.market.intervalType);
    const validationDefinitions = buildValidationDefinitions({
      profile,
      trainingYear,
      symbol,
      limit,
      trainConfig,
      coverage,
      customStartIso: customRange.startIso,
      customEndIso: customRange.endIso
    });
    const sourceRunId = await findLatestRunId(connection, sourceTable);
    if (!sourceRunId) {
      throw new Error(`no run found in logical result group ${sourceTable}`);
    }

    const [rows] = await connection.query(
      `SELECT strategy_name, strategy_type, total_trades, win_rate, total_pnl, score, parameters
       FROM ${BACKTEST_RESULTS_TABLE}
       WHERE result_group = ?
         AND run_id = ?
         AND total_trades > 0
       ORDER BY score DESC, return_pct DESC, total_pnl DESC, strategy_name ASC
       LIMIT ?`,
      [sourceTable, sourceRunId, limit]
    );

    if (!rows.length) {
      throw new Error(`no top strategies found in logical result group ${sourceTable}`);
    }

    const parameterSets = rows.map((row) => typeof row.parameters === 'string' ? JSON.parse(row.parameters) : row.parameters);
    const first = parameterSets[0];

    const merged = {
      rsi: {
        period: [...new Set(parameterSets.map((p) => p.rsi.period))],
        oversold: [...new Set(parameterSets.map((p) => p.rsi.oversold))],
        overbought: [...new Set(parameterSets.map((p) => p.rsi.overbought))]
      },
      risk: {
        maxPositions: [...new Set(parameterSets.map((p) => p.risk.maxPositions))],
        lotSize: [...new Set(parameterSets.map((p) => p.risk.lotSize))],
        maxHoldMinutes: [...new Set(parameterSets.map((p) => p.risk.maxHoldMinutes))]
      },
      atr: {
        slMultiplier: [...new Set(parameterSets.map((p) => p.atr.slMultiplier))],
        tpMultiplier: [...new Set(parameterSets.map((p) => p.atr.tpMultiplier))]
      },
      tradingSchedule: first.tradingSchedule ?? null,
      tradingTimeRestriction: first.tradingTimeRestriction ?? null
    };

    const explicitStrategies = rows.map((row, index) => ({
      rank: index + 1,
      name: row.strategy_name,
      type: row.strategy_type,
      parameters: typeof row.parameters === 'string' ? JSON.parse(row.parameters) : row.parameters
    }));

    const artifacts = buildValidationArtifacts({
      validationDefinitions,
      outPrefix,
      limit,
      symbol,
      trainingYear,
      trainConfig,
      sourceTable,
      trainConfigRef,
      exact,
      strategyPrefix,
      descriptionPrefix,
      explicitStrategies,
      merged,
      sourceRunId,
      rows,
      profile
    });

    if (outputMode === 'json') {
      process.stdout.write(`${JSON.stringify(artifacts)}\n`);
      return;
    }

    for (const item of artifacts.validationConfigs) {
      const outputPath = path.resolve(__dirname, `../${item.configKey}`);
      writeJson(outputPath, item.content);
      console.log(`Validation config written: ${outputPath}`);
    }

    const snapshotPath = path.resolve(__dirname, `../${artifacts.snapshot.configKey}`);
    writeJson(snapshotPath, artifacts.snapshot.content);
    console.log(`Top${limit} snapshot written: ${snapshotPath}`);
  } finally {
    await connection.end();
  }
}

module.exports = {
  buildValidationArtifacts
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
