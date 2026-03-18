#!/usr/bin/env node

/**
 * Monthly rolling runner for ETHJPY.
 *
 * Workflow:
 * 1. train on the previous 12 full months
 * 2. pick the single best strategy from the train table
 * 3. validate that exact strategy on the execution month
 * 4. persist generated configs and a markdown/json report
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');

const ROOT_DIR = path.resolve(__dirname, '..');
const GENERATED_DIR = path.join(ROOT_DIR, 'configs', 'generated', 'monthly');
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'monthly');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'trader',
  password: process.env.DB_PASSWORD || 'traderpass',
  database: process.env.DB_NAME || 'trading'
};

const TRAIN_STRATEGY = {
  types: ['rsi_only'],
  parameters: {
    rsi: {
      period: [14],
      oversold: [30],
      overbought: [70]
    },
    risk: {
      maxPositions: [1],
      lotSize: [0.1],
      maxHoldMinutes: [5, 10, 15, 20, 25, 30]
    },
    atr: {
      slMultiplier: [2, 2.5, 3, 3.5, 4],
      tpMultiplier: [3, 4, 5, 6, 7]
    },
    tradingSchedule: 'ALWAYS',
    tradingTimeRestriction: null
  }
};

const EXECUTOR = {
  version: 'v3',
  options: {
    enableMA200Filter: true,
    enableMultiTimeframe: true,
    enableATRSizing: true,
    enableTrailingStop: true,
    enableRSIReversion: true,
    feeModel: {
      venueCode: 'GMOCOIN',
      commissionRate: 0.00002,
      basis: 'notional',
      chargeOnEntry: true,
      chargeOnExit: true
    }
  }
};

function parseArgs(argv) {
  const parsed = {
    month: null,
    topN: 10,
    skipValidation: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg.startsWith('--month=')) {
      parsed.month = arg.slice('--month='.length);
      continue;
    }
    if (arg === '--month') {
      parsed.month = argv[++i] || null;
      continue;
    }
    if (arg.startsWith('--top-n=')) {
      parsed.topN = Number(arg.slice('--top-n='.length));
      continue;
    }
    if (arg === '--top-n') {
      parsed.topN = Number(argv[++i]);
      continue;
    }
    if (arg === '--skip-validation') {
      parsed.skipValidation = true;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }

  if (!parsed.month || !/^\d{4}-\d{2}$/.test(parsed.month)) {
    throw new Error('missing required --month YYYY-MM');
  }

  return parsed;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseMonth(monthStr) {
  const date = new Date(`${monthStr}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid month: ${monthStr}`);
  }
  return date;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 0, 0));
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

function toTimeRange(startDate, endDate) {
  return {
    startTimeMs: startDate.getTime(),
    endTimeMs: endDate.getTime(),
    startIso: `${toIsoDate(startDate)}T00:00:00.000Z`,
    endIso: `${toIsoDate(endDate)}T23:59:00.000Z`
  };
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function runTrainConfig(configPath) {
  execFileSync('node', ['dist/scripts/train.js', configPath], {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });
}

async function queryRows(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows;
}

async function queryMaxKlineTime(connection) {
  const rows = await queryRows(
    connection,
    `SELECT MAX(CAST(open_time AS UNSIGNED)) AS max_open_time
     FROM klines
     WHERE symbol = 'ETHJPY' AND interval_type = '1min'`
  );
  return rows[0] && rows[0].max_open_time ? Number(rows[0].max_open_time) : null;
}

function normalizeCandidate(row) {
  return {
    strategyName: row.strategy_name,
    hold: Number(row.maxHoldMinutes),
    atrsl: Number(row.slMultiplier),
    atrtp: Number(row.tpMultiplier),
    totalTrades: Number(row.total_trades),
    winRatePct: Number((Number(row.win_rate) * 100).toFixed(2)),
    totalPnl: Number(row.total_pnl),
    returnPct: Number(row.return_pct),
    maxDrawdown: Number(row.max_drawdown),
    maxDrawdownPct: Number(row.max_drawdown_pct),
    score: Number(row.score)
  };
}

async function loadTopCandidates(connection, tableName, topN) {
  const rows = await queryRows(
    connection,
    `SELECT
      strategy_name,
      JSON_UNQUOTE(JSON_EXTRACT(parameters, '$.risk.maxHoldMinutes')) AS maxHoldMinutes,
      JSON_UNQUOTE(JSON_EXTRACT(parameters, '$.atr.slMultiplier')) AS slMultiplier,
      JSON_UNQUOTE(JSON_EXTRACT(parameters, '$.atr.tpMultiplier')) AS tpMultiplier,
      total_trades,
      win_rate,
      total_pnl,
      return_pct,
      max_drawdown,
      max_drawdown_pct,
      score
    FROM ${tableName}
    WHERE total_trades > 0
    ORDER BY score DESC, return_pct DESC, total_pnl DESC, strategy_name ASC
    LIMIT ?`,
    [topN]
  );
  return rows.map(normalizeCandidate);
}

function createTrainingConfig({ runKey, timeRange, tableName, topN }) {
  return {
    name: `ETHJPY_ROLLING_${runKey}_TRAIN`,
    description: `${runKey} rolling train using previous 12 full months`,
    timeRange,
    market: {
      symbol: 'ETHJPY',
      intervalType: '1min'
    },
    database: {
      tableName,
      resetTableBeforeRun: true
    },
    strategy: TRAIN_STRATEGY,
    executor: EXECUTOR,
    output: {
      topN,
      strategyNamePrefix: `ETHJPY-Rolling-${runKey}-Train-`,
      descriptionPrefix: `ETHJPY rolling train ${runKey}`
    }
  };
}

function createValidationConfig({ runKey, timeRange, tableName, selected }) {
  return {
    name: `ETHJPY_ROLLING_${runKey}_VALIDATE`,
    description: `${runKey} rolling validate using best train strategy`,
    timeRange,
    market: {
      symbol: 'ETHJPY',
      intervalType: '1min'
    },
    database: {
      tableName,
      resetTableBeforeRun: true
    },
    strategy: {
      types: ['rsi_only'],
      parameters: {
        rsi: {
          period: [14],
          oversold: [30],
          overbought: [70]
        },
        risk: {
          maxPositions: [1],
          lotSize: [0.1],
          maxHoldMinutes: [selected.hold]
        },
        atr: {
          slMultiplier: [selected.atrsl],
          tpMultiplier: [selected.atrtp]
        },
        tradingSchedule: 'ALWAYS',
        tradingTimeRestriction: null
      }
    },
    executor: EXECUTOR,
    output: {
      topN: 1,
      strategyNamePrefix: `ETHJPY-Rolling-${runKey}-Validate-`,
      descriptionPrefix: `ETHJPY rolling validate ${runKey}`
    }
  };
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push(`# ETHJPY Monthly Rolling ${report.runMonth}`);
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push(`- Execution month: \`${report.runMonth}\``);
  lines.push(`- Train window: \`${report.trainWindow.start}\` to \`${report.trainWindow.end}\``);
  lines.push(`- Validation window: \`${report.validationWindow.start}\` to \`${report.validationWindow.end}\``);
  lines.push('- Symbol: `ETHJPY`');
  lines.push('- Interval: `1min`');
  lines.push('- Trading schedule: `ALWAYS`');
  lines.push('');
  lines.push('## Training Winner');
  lines.push('');
  lines.push(`- Strategy: \`${report.trainingWinner.strategyName}\``);
  lines.push(`- Params: \`H${report.trainingWinner.hold} + ATRSL${report.trainingWinner.atrsl} + ATRTP${report.trainingWinner.atrtp}\``);
  lines.push(`- Trades: \`${report.trainingWinner.totalTrades}\``);
  lines.push(`- Win rate: \`${report.trainingWinner.winRatePct}%\``);
  lines.push(`- Total PnL: \`${report.trainingWinner.totalPnl}\``);
  lines.push(`- Return %: \`${report.trainingWinner.returnPct}%\``);
  lines.push(`- Max drawdown %: \`${report.trainingWinner.maxDrawdownPct}%\``);
  lines.push(`- Score: \`${report.trainingWinner.score}\``);
  lines.push('');
  lines.push('## Validation Result');
  lines.push('');
  if (report.validationResult) {
    lines.push(`- Strategy: \`${report.validationResult.strategyName}\``);
    lines.push(`- Trades: \`${report.validationResult.totalTrades}\``);
    lines.push(`- Win rate: \`${report.validationResult.winRatePct}%\``);
    lines.push(`- Total PnL: \`${report.validationResult.totalPnl}\``);
    lines.push(`- Return %: \`${report.validationResult.returnPct}%\``);
    lines.push(`- Max drawdown %: \`${report.validationResult.maxDrawdownPct}%\``);
    lines.push(`- Score: \`${report.validationResult.score}\``);
  } else {
    lines.push(`- Status: \`skipped\``);
    lines.push(`- Reason: ${report.validationSkippedReason || 'no reason recorded'}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  ensureDir(GENERATED_DIR);
  ensureDir(REPORT_DIR);

  const executionMonth = parseMonth(args.month);
  const runKey = args.month.replace('-', '_');
  const validationStart = startOfUtcMonth(executionMonth);
  const validationEnd = endOfUtcMonth(executionMonth);
  const trainStart = addMonths(validationStart, -12);
  const trainEnd = new Date(Date.UTC(validationStart.getUTCFullYear(), validationStart.getUTCMonth(), 0, 23, 59, 0, 0));

  const trainingConfig = createTrainingConfig({
    runKey,
    timeRange: toTimeRange(trainStart, trainEnd),
    tableName: `backtest_results_ethjpy_rolling_${runKey}_train`,
    topN: args.topN
  });
  const trainingConfigPath = path.join(GENERATED_DIR, `ethjpy_${runKey}_train.json`);
  writeJson(trainingConfigPath, trainingConfig);

  console.log(`\n[monthly] run month: ${args.month}`);
  console.log(`[monthly] train window: ${toIsoDate(trainStart)} -> ${toIsoDate(trainEnd)}`);
  console.log(`[monthly] validation window: ${toIsoDate(validationStart)} -> ${toIsoDate(validationEnd)}`);

  console.log('\n[monthly] running train...');
  runTrainConfig(path.relative(ROOT_DIR, trainingConfigPath));

  const connection = await mysql.createConnection(DB_CONFIG);

  try {
    const candidates = await loadTopCandidates(connection, trainingConfig.database.tableName, args.topN);
    const trainingWinner = candidates[0];
    if (!trainingWinner) {
      throw new Error('no training winner found');
    }

    let validationResult = null;
    let validationSkippedReason = null;

    if (!args.skipValidation) {
      const maxKlineTime = await queryMaxKlineTime(connection);
      const validationStartMs = validationStart.getTime();
      const validationEndMs = validationEnd.getTime();

      if (!maxKlineTime || validationStartMs > maxKlineTime) {
        validationSkippedReason = 'validation month is beyond available market data';
      } else {
        const boundedValidationEndMs = Math.min(validationEndMs, maxKlineTime);
        const boundedValidationEnd = new Date(boundedValidationEndMs);
        const validationConfig = createValidationConfig({
          runKey,
          timeRange: toTimeRange(validationStart, boundedValidationEnd),
          tableName: `backtest_results_ethjpy_rolling_${runKey}_validate`,
          selected: trainingWinner
        });
        const validationConfigPath = path.join(GENERATED_DIR, `ethjpy_${runKey}_validate.json`);
        writeJson(validationConfigPath, validationConfig);
        console.log('\n[monthly] running validate...');
        runTrainConfig(path.relative(ROOT_DIR, validationConfigPath));
        validationResult = (await loadTopCandidates(connection, validationConfig.database.tableName, 1))[0] || null;
      }
    } else {
      validationSkippedReason = 'validation explicitly skipped';
    }

    const report = {
      runMonth: args.month,
      trainWindow: {
        start: toIsoDate(trainStart),
        end: toIsoDate(trainEnd)
      },
      validationWindow: {
        start: toIsoDate(validationStart),
        end: toIsoDate(validationEnd)
      },
      trainingWinner,
      topCandidates: candidates,
      validationResult,
      validationSkippedReason
    };

    const reportJsonPath = path.join(REPORT_DIR, `ethjpy_${runKey}_rolling.json`);
    const reportMdPath = path.join(REPORT_DIR, `ethjpy_${runKey}_rolling.md`);
    writeJson(reportJsonPath, report);
    fs.writeFileSync(reportMdPath, buildMarkdownReport(report), 'utf8');

    console.log('\n[monthly] completed');
    console.log(`[monthly] training winner: ${trainingWinner.strategyName}`);
    if (validationResult) {
      console.log(`[monthly] validation pnl: ${validationResult.totalPnl}`);
    } else {
      console.log(`[monthly] validation skipped: ${validationSkippedReason}`);
    }
    console.log(`[monthly] report json: ${path.relative(ROOT_DIR, reportJsonPath)}`);
    console.log(`[monthly] report md: ${path.relative(ROOT_DIR, reportMdPath)}`);
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(`[monthly] failed: ${error.message}`);
  process.exit(1);
});
