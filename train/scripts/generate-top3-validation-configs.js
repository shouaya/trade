#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const crypto = require('crypto');

const BACKTEST_RESULTS_TABLE = 'backtest_results';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });
dotenv.config();

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function buildValidationTableName(symbol, year) {
  return `backtest_results_top3_from_2025_${symbol.toLowerCase()}_${year}`;
}

function buildExactValidationTableName(symbol, year, limit, outPrefix) {
  const digest = crypto
    .createHash('md5')
    .update(`${outPrefix}:${symbol}:${year}:${limit}`)
    .digest('hex')
    .slice(0, 8);

  return `backtest_results_top${limit}_${symbol.toLowerCase()}_${year}_${digest}`;
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
  const strategyPrefix = required(args, 'strategyPrefix');
  const descriptionPrefix = required(args, 'descriptionPrefix');
  const limit = Number(args.limit || '3');
  const exact = String(args.exact || 'false').toLowerCase() === 'true';

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`invalid --limit=${args.limit}`);
  }

  const timeRanges = {
    '2024': {
      startTimeMs: 1704067200000,
      endTimeMs: 1735689540000,
      startIso: '2024-01-01T00:00:00.000Z',
      endIso: '2024-12-31T23:59:00.000Z'
    },
    '2026': {
      startTimeMs: 1767225600000,
      endTimeMs: 1773964740000,
      startIso: '2026-01-01T00:00:00.000Z',
      endIso: '2026-03-19T23:59:00.000Z'
    }
  };

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'trader',
    password: process.env.DB_PASSWORD || 'traderpass',
    database: process.env.DB_NAME || 'trading',
    charset: 'utf8mb4'
  }).catch(async (error) => {
    if ((process.env.DB_HOST || '127.0.0.1') !== '127.0.0.1') {
      return mysql.createConnection({
        host: '127.0.0.1',
        port: Number(process.env.DB_PORT || '3306'),
        user: process.env.DB_USER || 'trader',
        password: process.env.DB_PASSWORD || 'traderpass',
        database: process.env.DB_NAME || 'trading',
        charset: 'utf8mb4'
      });
    }
    throw error;
  });

  try {
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

    for (const year of ['2024', '2026']) {
      const outputPath = path.resolve(__dirname, `../configs/validation/${outPrefix}_${year}_validation.json`);
      const config = {
        name: `${year}_${symbol}_TOP${limit}_FROM_2025_VALIDATION`,
        description: `${year}年 ${symbol} 验证 - 使用2025训练 Top${limit} 参数`,
        timeRange: timeRanges[year],
        market: {
          symbol,
          intervalType: trainConfig.market.intervalType
        },
        database: {
          tableName: exact
            ? buildExactValidationTableName(symbol, year, limit, outPrefix)
            : buildValidationTableName(symbol, year),
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
          strategyNamePrefix: `${strategyPrefix}${year}-`,
          descriptionPrefix: `${descriptionPrefix} ${year} 验证`
        }
      };

      writeJson(outputPath, config);
      console.log(`Validation config written: ${outputPath}`);
    }

    const snapshotPath = path.resolve(__dirname, `../configs/top-strategies/${outPrefix}_top${limit}.generated.json`);
    writeJson(snapshotPath, {
      generatedAt: new Date().toISOString(),
      sourceTable,
      sourcePhysicalTable: BACKTEST_RESULTS_TABLE,
      sourceRunId,
      symbol,
      exact,
      limit,
      trainConfig: path.relative(path.resolve(__dirname, '..'), trainConfigPath),
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
    });
    console.log(`Top${limit} snapshot written: ${snapshotPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
