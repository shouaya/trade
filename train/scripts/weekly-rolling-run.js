#!/usr/bin/env node

/**
 * Weekly rolling MVP runner.
 *
 * Scope:
 * - fixed size only: 0.1 lot
 * - fee-aware optimization
 * - two training windows: 3m and 1m
 * - consensus-based decision only
 * - no position scaling
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');

const ROOT_DIR = path.resolve(__dirname, '..');
const GENERATED_DIR = path.join(ROOT_DIR, 'configs', 'generated', 'weekly');
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'weekly');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'trader',
  password: process.env.DB_PASSWORD || 'traderpass',
  database: process.env.DB_NAME || 'trading'
};

const BASE_STRATEGY = {
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
      maxHoldMinutes: [10, 25, 30]
    },
    atr: {
      slMultiplier: [3.5, 4],
      tpMultiplier: [3, 4]
    },
    tradingSchedule: '* 0-19 * * 1-5',
    tradingTimeRestriction: {
      enabled: true,
      utcExcludeStart: '19:30',
      utcExcludeEnd: '23:59',
      description: '排除UTC 19:30-23:59'
    }
  }
};

const BASE_EXECUTOR = {
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
    cutoff: null,
    topN: 5,
    currentHold: 10,
    currentAtrsl: 4,
    currentAtrtp: 4,
    skipValidation: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg.startsWith('--cutoff=')) {
      parsed.cutoff = arg.slice('--cutoff='.length);
      continue;
    }
    if (arg === '--cutoff') {
      parsed.cutoff = argv[++i] || null;
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
    if (arg.startsWith('--current-hold=')) {
      parsed.currentHold = Number(arg.slice('--current-hold='.length));
      continue;
    }
    if (arg === '--current-hold') {
      parsed.currentHold = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith('--current-atrsl=')) {
      parsed.currentAtrsl = Number(arg.slice('--current-atrsl='.length));
      continue;
    }
    if (arg === '--current-atrsl') {
      parsed.currentAtrsl = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith('--current-atrtp=')) {
      parsed.currentAtrtp = Number(arg.slice('--current-atrtp='.length));
      continue;
    }
    if (arg === '--current-atrtp') {
      parsed.currentAtrtp = Number(argv[++i]);
      continue;
    }
    if (arg === '--skip-validation') {
      parsed.skipValidation = true;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }

  if (!parsed.cutoff) {
    throw new Error('missing required --cutoff YYYY-MM-DD');
  }

  return parsed;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseUtcDate(dateStr) {
  const parsed = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid date: ${dateStr}`);
  }
  return parsed;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function endOfUtcDay(date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    23, 59, 0, 0
  ));
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0, 0, 0, 0
  ));
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function subtractMonthsInclusive(date, months) {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() + 1);
  return startOfUtcDay(d);
}

function toTimeRange(startDate, endDate) {
  return {
    startTimeMs: startOfUtcDay(startDate).getTime(),
    endTimeMs: endOfUtcDay(endDate).getTime(),
    startIso: `${toIsoDate(startDate)}T00:00:00.000Z`,
    endIso: `${toIsoDate(endDate)}T23:59:00.000Z`
  };
}

function holdToFamily(hold) {
  if (hold === 10 || hold === 15) return 'fast';
  if (hold === 25 || hold === 30) return 'slow';
  return 'other';
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => Number(a) - Number(b));
}

function round(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function pctOfMargin(value) {
  return round((Number(value) / 500) * 100, 1);
}

function createTrainingConfig({ runKey, label, timeRange, tableName, topN }) {
  return {
    name: `WEEKLY_${label.toUpperCase()}_TRAIN`,
    description: `${label} weekly rolling training`,
    timeRange,
    market: {
      symbol: 'USDJPY',
      intervalType: '1min'
    },
    database: {
      tableName,
      resetTableBeforeRun: true
    },
    strategy: BASE_STRATEGY,
    executor: BASE_EXECUTOR,
    output: {
      topN,
      strategyNamePrefix: `Weekly-${runKey}-${label}-`,
      descriptionPrefix: `weekly ${label} train`
    }
  };
}

function createValidationConfig({ runKey, timeRange, tableName, selectedParams }) {
  return {
    name: `WEEKLY_${runKey.toUpperCase()}_VALIDATE`,
    description: `${runKey} weekly execution-window validation`,
    timeRange,
    market: {
      symbol: 'USDJPY',
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
          maxHoldMinutes: [selectedParams.hold]
        },
        atr: {
          slMultiplier: [selectedParams.atrsl],
          tpMultiplier: [selectedParams.atrtp]
        },
        tradingSchedule: '* 0-19 * * 1-5',
        tradingTimeRestriction: {
          enabled: true,
          utcExcludeStart: '19:30',
          utcExcludeEnd: '23:59',
          description: '排除UTC 19:30-23:59'
        }
      }
    },
    executor: BASE_EXECUTOR,
    output: {
      topN: 1,
      strategyNamePrefix: `Weekly-${runKey}-validate-`,
      descriptionPrefix: `weekly validate ${runKey}`
    }
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

function normalizeCandidate(row) {
  return {
    strategyName: row.strategy_name,
    hold: Number(row.maxHoldMinutes),
    family: holdToFamily(Number(row.maxHoldMinutes)),
    atrsl: Number(row.slMultiplier),
    atrtp: Number(row.tpMultiplier),
    totalTrades: Number(row.total_trades),
    winRate: round(Number(row.win_rate) * 100, 2),
    grossPnl: Number(row.gross_pnl),
    totalCommission: Number(row.total_commission),
    netPnl: Number(row.total_pnl),
    avgNetPnl: Number(row.avg_pnl),
    sharpeRatio: Number(row.sharpe_ratio),
    maxDrawdown: Number(row.max_drawdown),
    profitFactor: Number(row.profit_factor),
    score: Number(row.score),
    grossReturnPct: pctOfMargin(row.gross_pnl),
    commissionPct: pctOfMargin(row.total_commission),
    netReturnPct: pctOfMargin(row.total_pnl),
    maxDrawdownPct: pctOfMargin(row.max_drawdown)
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
      gross_pnl,
      total_commission,
      total_pnl,
      avg_pnl,
      sharpe_ratio,
      max_drawdown,
      profit_factor,
      score
    FROM ${tableName}
    WHERE total_trades > 0
    ORDER BY total_pnl DESC, score DESC, strategy_name ASC
    LIMIT ?`,
    [topN]
  );
  return rows.map(normalizeCandidate);
}

async function loadSpecificCandidate(connection, tableName, params) {
  const rows = await queryRows(
    connection,
    `SELECT
      strategy_name,
      JSON_UNQUOTE(JSON_EXTRACT(parameters, '$.risk.maxHoldMinutes')) AS maxHoldMinutes,
      JSON_UNQUOTE(JSON_EXTRACT(parameters, '$.atr.slMultiplier')) AS slMultiplier,
      JSON_UNQUOTE(JSON_EXTRACT(parameters, '$.atr.tpMultiplier')) AS tpMultiplier,
      total_trades,
      win_rate,
      gross_pnl,
      total_commission,
      total_pnl,
      avg_pnl,
      sharpe_ratio,
      max_drawdown,
      profit_factor,
      score
    FROM ${tableName}
    WHERE total_trades > 0
      AND JSON_UNQUOTE(JSON_EXTRACT(parameters, '$.risk.maxHoldMinutes')) = ?
      AND JSON_UNQUOTE(JSON_EXTRACT(parameters, '$.atr.slMultiplier')) = ?
      AND JSON_UNQUOTE(JSON_EXTRACT(parameters, '$.atr.tpMultiplier')) = ?
    ORDER BY total_pnl DESC, score DESC, strategy_name ASC
    LIMIT 1`,
    [String(params.hold), String(params.atrsl), String(params.atrtp)]
  );
  return rows.length > 0 ? normalizeCandidate(rows[0]) : null;
}

function analyzeConsensus(candidates) {
  const familyCounts = new Map();
  const holdCounts = new Map();
  const atrslCounts = new Map();
  const atrtpCounts = new Map();

  for (const row of candidates) {
    familyCounts.set(row.family, (familyCounts.get(row.family) || 0) + 1);
    holdCounts.set(row.hold, (holdCounts.get(row.hold) || 0) + 1);
    atrslCounts.set(row.atrsl, (atrslCounts.get(row.atrsl) || 0) + 1);
    atrtpCounts.set(row.atrtp, (atrtpCounts.get(row.atrtp) || 0) + 1);
  }

  const positiveCount = candidates.filter(r => r.netPnl > 0).length;
  const majorityThreshold = Math.ceil(candidates.length / 2);
  const dominantFamilyEntry = [...familyCounts.entries()].sort((a, b) => b[1] - a[1])[0] || ['mixed', 0];
  const dominantFamily = dominantFamilyEntry[1] >= majorityThreshold ? dominantFamilyEntry[0] : 'mixed';

  return {
    positiveCount,
    dominantFamily,
    familyCounts: Object.fromEntries(familyCounts),
    holdValues: uniqueSorted(candidates.map(r => r.hold)),
    atrslBand: uniqueSorted(candidates.map(r => r.atrsl)),
    atrtpBand: uniqueSorted(candidates.map(r => r.atrtp)),
    topCandidate: candidates[0] || null
  };
}

function intersect(a, b) {
  const setB = new Set(b);
  return a.filter(v => setB.has(v));
}

function chooseSelectedParams(consensus3m, consensus1m, currentParams) {
  const family3m = consensus3m.dominantFamily;
  const family1m = consensus1m.dominantFamily;

  const allTopNegative = consensus3m.positiveCount === 0 && consensus1m.positiveCount === 0;
  if (allTopNegative) {
    return {
      action: 'pause',
      selectedParams: currentParams,
      reason: 'both 3m and 1m top candidates are non-positive after fees'
    };
  }

  // If the 3m window still has a viable current setup but the short window is noisy,
  // prefer continuity instead of pausing.
  if (consensus3m.positiveCount > 0 && consensus1m.positiveCount === 0) {
    return {
      action: 'keep',
      selectedParams: currentParams,
      reason: '3m window remains viable while 1m window is temporarily weak'
    };
  }

  if (family3m === 'slow' && family1m === 'slow') {
    const best = consensus3m.topCandidate;
    return {
      action: 'fallback',
      selectedParams: {
        hold: best.hold,
        atrsl: best.atrsl,
        atrtp: best.atrtp
      },
      reason: 'both windows favor the slow family'
    };
  }

  if (family3m === 'mixed' && family1m === 'mixed') {
    return {
      action: 'pause',
      selectedParams: currentParams,
      reason: 'no stable consensus in either window'
    };
  }

  if (family3m === 'slow' && family1m !== 'slow') {
    if (holdToFamily(currentParams.hold) === 'fast' && consensus1m.positiveCount > 0) {
      return {
        action: 'keep',
        selectedParams: currentParams,
        reason: '3m favors slow but 1m still supports the current fast family'
      };
    }
    const best = consensus3m.topCandidate;
    return {
      action: 'fallback',
      selectedParams: {
        hold: best.hold,
        atrsl: best.atrsl,
        atrtp: best.atrtp
      },
      reason: '3m window is the regime anchor and favors the slow family'
    };
  }

  const family = family3m === 'fast' ? 'fast' : family1m === 'fast' ? 'fast' : 'mixed';
  if (family === 'mixed') {
    return {
      action: 'keep',
      selectedParams: currentParams,
      reason: 'windows do not establish a stable family change'
    };
  }

  const holdOptions = intersect(consensus3m.holdValues, consensus1m.holdValues)
    .filter(v => holdToFamily(v) === 'fast');
  const atrslOptions = intersect(consensus3m.atrslBand, consensus1m.atrslBand);
  const atrtpOptions = intersect(consensus3m.atrtpBand, consensus1m.atrtpBand);

  const selected = {
    hold: holdOptions.includes(currentParams.hold)
      ? currentParams.hold
      : (holdOptions[0] || consensus3m.topCandidate.hold),
    atrsl: atrslOptions.includes(currentParams.atrsl)
      ? currentParams.atrsl
      : (atrslOptions.includes(4) ? 4 : (atrslOptions[0] || consensus3m.topCandidate.atrsl)),
    atrtp: atrtpOptions.includes(currentParams.atrtp)
      ? currentParams.atrtp
      : (atrtpOptions.includes(4) ? 4 : (atrtpOptions.includes(3) ? 3 : (atrtpOptions[0] || consensus3m.topCandidate.atrtp)))
  };

  return {
    action: 'switch',
    selectedParams: selected,
    reason: 'fast-family consensus survives across 3m and 1m windows'
  };
}

function decideAction(baseDecision, current3m, selected3m) {
  if (baseDecision.action === 'pause' || baseDecision.action === 'fallback') {
    return baseDecision;
  }

  if (!selected3m) {
    return {
      action: 'keep',
      selectedParams: baseDecision.selectedParams,
      reason: 'selected candidate not found in 3m results; keep current parameters'
    };
  }

  if (!current3m) {
    return baseDecision;
  }

  const sameParams =
    current3m.hold === selected3m.hold &&
    current3m.atrsl === selected3m.atrsl &&
    current3m.atrtp === selected3m.atrtp;

  if (sameParams) {
    return {
      action: 'keep',
      selectedParams: baseDecision.selectedParams,
      reason: 'current parameters are already inside the weekly consensus zone'
    };
  }

  const currentNet = current3m.netPnl;
  const selectedNet = selected3m.netPnl;
  const currentAvg = current3m.avgNetPnl;
  const selectedAvg = selected3m.avgNetPnl;
  const tradeInflated = selected3m.totalTrades > current3m.totalTrades * 1.3;
  const marginDeltaThreshold = 50; // 10% of 500 USD margin basis
  const meaningfulImprovement =
    selectedNet >= currentNet + marginDeltaThreshold ||
    (currentNet <= 0 && selectedNet > currentNet + marginDeltaThreshold / 2);
  const avgImprovedEnough = selectedAvg > currentAvg + 0.25;

  if (selectedNet > 0 && meaningfulImprovement && avgImprovedEnough && !tradeInflated) {
    return baseDecision;
  }

  return {
    action: 'keep',
    selectedParams: {
      hold: current3m.hold,
      atrsl: current3m.atrsl,
      atrtp: current3m.atrtp
    },
    reason: 'switch threshold not met; keeping current production parameters'
  };
}

async function queryMaxKlineTime(connection) {
  const rows = await queryRows(
    connection,
    `SELECT MAX(CAST(open_time AS UNSIGNED)) AS max_open_time
     FROM klines
     WHERE symbol = 'USDJPY' AND interval_type = '1min'`
  );
  return rows[0] && rows[0].max_open_time ? Number(rows[0].max_open_time) : null;
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push(`# Weekly Rolling Decision ${report.runDate}`);
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push(`- Cutoff date: \`${report.runDate}\``);
  lines.push(`- 3m window: \`${report.trainWindow3m.start}\` to \`${report.trainWindow3m.end}\``);
  lines.push(`- 1m window: \`${report.trainWindow1m.start}\` to \`${report.trainWindow1m.end}\``);
  lines.push(`- Execution window: \`${report.executionWindow.start}\` to \`${report.executionWindow.end}\``);
  lines.push('- Initial margin capital: `500 USD`');
  lines.push('- Leverage: `20x`');
  lines.push('- Position basis: `0.1 lot = 10,000 USD notional`');
  lines.push('');
  lines.push('## Consensus');
  lines.push('');
  lines.push(`- 3m dominant family: \`${report.consensus.family3m}\``);
  lines.push(`- 1m dominant family: \`${report.consensus.family1m}\``);
  lines.push(`- Shared ATRSL band: \`${report.consensus.sharedAtrslBand.join(', ') || 'none'}\``);
  lines.push(`- Shared ATRTP band: \`${report.consensus.sharedAtrtpBand.join(', ') || 'none'}\``);
  lines.push(`- Agreement level: \`${report.consensus.agreementLevel}\``);
  lines.push('');
  lines.push('## Decision');
  lines.push('');
  lines.push(`- Action: \`${report.decision.action}\``);
  lines.push(`- Selected params: \`H${report.decision.selectedParams.hold} + ATRSL${report.decision.selectedParams.atrsl} + ATRTP${report.decision.selectedParams.atrtp}\``);
  lines.push(`- Reason: ${report.decision.reason}`);
  lines.push('');
  lines.push('## Training Comparison');
  lines.push('');
  lines.push(`- Current 3m net return: \`${report.currentMetrics.window3m?.netReturnPct ?? 'n/a'}%\``);
  lines.push(`- Selected 3m net return: \`${report.selectedMetrics.window3m?.netReturnPct ?? 'n/a'}%\``);
  lines.push(`- Current 1m net return: \`${report.currentMetrics.window1m?.netReturnPct ?? 'n/a'}%\``);
  lines.push(`- Selected 1m net return: \`${report.selectedMetrics.window1m?.netReturnPct ?? 'n/a'}%\``);
  lines.push('');
  lines.push('## Validation');
  lines.push('');
  if (report.validation) {
    lines.push(`- Validation status: \`completed\``);
    lines.push(`- Execution-week net return: \`${report.validation.netReturnPct}%\``);
    lines.push(`- Execution-week commission / margin: \`${report.validation.commissionPct}%\``);
    lines.push(`- Execution-week max drawdown / margin: \`${report.validation.maxDrawdownPct}%\``);
  } else {
    lines.push(`- Validation status: \`skipped\``);
    lines.push(`- Reason: ${report.validationSkippedReason || 'no reason recorded'}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  ensureDir(GENERATED_DIR);
  ensureDir(REPORT_DIR);

  const cutoffDate = parseUtcDate(args.cutoff);
  const runKey = args.cutoff.replace(/-/g, '_');
  const currentParams = {
    hold: args.currentHold,
    atrsl: args.currentAtrsl,
    atrtp: args.currentAtrtp
  };

  const train3mStart = subtractMonthsInclusive(cutoffDate, 3);
  const train1mStart = subtractMonthsInclusive(cutoffDate, 1);
  const executionStart = addDays(cutoffDate, 1);
  const executionEnd = addDays(cutoffDate, 7);

  const config3m = createTrainingConfig({
    runKey,
    label: '3m',
    timeRange: toTimeRange(train3mStart, cutoffDate),
    tableName: `backtest_results_weekly_${runKey}_3m_train`,
    topN: args.topN
  });
  const config1m = createTrainingConfig({
    runKey,
    label: '1m',
    timeRange: toTimeRange(train1mStart, cutoffDate),
    tableName: `backtest_results_weekly_${runKey}_1m_train`,
    topN: args.topN
  });

  const config3mPath = path.join(GENERATED_DIR, `weekly_${runKey}_3m_train.json`);
  const config1mPath = path.join(GENERATED_DIR, `weekly_${runKey}_1m_train.json`);
  writeJson(config3mPath, config3m);
  writeJson(config1mPath, config1m);

  console.log(`\n[weekly] run key: ${runKey}`);
  console.log(`[weekly] 3m window: ${toIsoDate(train3mStart)} -> ${toIsoDate(cutoffDate)}`);
  console.log(`[weekly] 1m window: ${toIsoDate(train1mStart)} -> ${toIsoDate(cutoffDate)}`);
  console.log(`[weekly] execution window: ${toIsoDate(executionStart)} -> ${toIsoDate(executionEnd)}`);

  console.log('\n[weekly] running 3m training...');
  runTrainConfig(path.relative(ROOT_DIR, config3mPath));
  console.log('\n[weekly] running 1m training...');
  runTrainConfig(path.relative(ROOT_DIR, config1mPath));

  const connection = await mysql.createConnection(DB_CONFIG);

  try {
    const top3m = await loadTopCandidates(connection, config3m.database.tableName, args.topN);
    const top1m = await loadTopCandidates(connection, config1m.database.tableName, args.topN);
    const current3m = await loadSpecificCandidate(connection, config3m.database.tableName, currentParams);
    const current1m = await loadSpecificCandidate(connection, config1m.database.tableName, currentParams);

    const consensus3m = analyzeConsensus(top3m);
    const consensus1m = analyzeConsensus(top1m);
    const baseDecision = chooseSelectedParams(consensus3m, consensus1m, currentParams);
    const selected3m = await loadSpecificCandidate(connection, config3m.database.tableName, baseDecision.selectedParams);
    const selected1m = await loadSpecificCandidate(connection, config1m.database.tableName, baseDecision.selectedParams);
    const finalDecision = decideAction(baseDecision, current3m, selected3m);

    let validationResult = null;
    let validationSkippedReason = null;

    if (!args.skipValidation && finalDecision.action !== 'pause') {
      const maxKlineTime = await queryMaxKlineTime(connection);
      const executionEndMs = endOfUtcDay(executionEnd).getTime();
      const executionStartMs = startOfUtcDay(executionStart).getTime();

      if (!maxKlineTime || executionStartMs > maxKlineTime) {
        validationSkippedReason = 'execution window is beyond available market data';
      } else {
        const boundedExecutionEnd = executionEndMs > maxKlineTime ? new Date(maxKlineTime) : executionEnd;
        const validationConfig = createValidationConfig({
          runKey,
          timeRange: toTimeRange(executionStart, boundedExecutionEnd),
          tableName: `backtest_results_weekly_${runKey}_validate`,
          selectedParams: finalDecision.selectedParams
        });
        const validationConfigPath = path.join(GENERATED_DIR, `weekly_${runKey}_validate.json`);
        writeJson(validationConfigPath, validationConfig);
        console.log('\n[weekly] running execution-window validation...');
        runTrainConfig(path.relative(ROOT_DIR, validationConfigPath));
        validationResult = await loadTopCandidates(connection, validationConfig.database.tableName, 1).then(rows => rows[0] || null);
      }
    } else if (finalDecision.action === 'pause') {
      validationSkippedReason = 'decision is pause';
    } else {
      validationSkippedReason = 'validation explicitly skipped';
    }

    const sharedAtrslBand = intersect(consensus3m.atrslBand, consensus1m.atrslBand);
    const sharedAtrtpBand = intersect(consensus3m.atrtpBand, consensus1m.atrtpBand);
    const agreementLevel =
      consensus3m.dominantFamily !== 'mixed' &&
      consensus3m.dominantFamily === consensus1m.dominantFamily
        ? 'strong'
        : (consensus3m.dominantFamily === consensus1m.dominantFamily || sharedAtrslBand.length > 0 || sharedAtrtpBand.length > 0)
          ? 'mild'
          : 'weak';

    const report = {
      runDate: args.cutoff,
      trainWindow3m: {
        start: toIsoDate(train3mStart),
        end: toIsoDate(cutoffDate),
        topCandidates: top3m
      },
      trainWindow1m: {
        start: toIsoDate(train1mStart),
        end: toIsoDate(cutoffDate),
        topCandidates: top1m
      },
      executionWindow: {
        start: toIsoDate(executionStart),
        end: toIsoDate(executionEnd)
      },
      consensus: {
        family3m: consensus3m.dominantFamily,
        family1m: consensus1m.dominantFamily,
        atrslBand3m: consensus3m.atrslBand,
        atrslBand1m: consensus1m.atrslBand,
        atrtpBand3m: consensus3m.atrtpBand,
        atrtpBand1m: consensus1m.atrtpBand,
        sharedAtrslBand,
        sharedAtrtpBand,
        agreementLevel
      },
      decision: finalDecision,
      currentMetrics: {
        window3m: current3m,
        window1m: current1m
      },
      selectedMetrics: {
        window3m: selected3m,
        window1m: selected1m
      },
      validation: validationResult,
      validationSkippedReason
    };

    const reportJsonPath = path.join(REPORT_DIR, `weekly_${runKey}_decision.json`);
    const reportMdPath = path.join(REPORT_DIR, `weekly_${runKey}_decision.md`);
    writeJson(reportJsonPath, report);
    fs.writeFileSync(reportMdPath, buildMarkdownReport(report), 'utf8');

    console.log('\n[weekly] decision complete');
    console.log(`[weekly] action: ${finalDecision.action}`);
    console.log(`[weekly] params: H${finalDecision.selectedParams.hold} + ATRSL${finalDecision.selectedParams.atrsl} + ATRTP${finalDecision.selectedParams.atrtp}`);
    console.log(`[weekly] report json: ${path.relative(ROOT_DIR, reportJsonPath)}`);
    console.log(`[weekly] report md: ${path.relative(ROOT_DIR, reportMdPath)}`);
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(`[weekly] failed: ${error.message}`);
  process.exit(1);
});
