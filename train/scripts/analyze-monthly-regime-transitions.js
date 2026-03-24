#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { createMysqlConnectionWithFallback, loadEnvFiles } = require('@money/database');

loadEnvFiles(dotenv, [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../backend/.env'),
  path.resolve(__dirname, '../../.env')
]);

const ROOT_DIR = path.resolve(__dirname, '..');
const GENERATED_DIR = path.join(ROOT_DIR, 'configs', 'generated', 'monthly-regime');
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'monthly-regime');
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const eqIndex = arg.indexOf('=');
    if (eqIndex !== -1) {
      args[arg.slice(0, eqIndex).replace(/^--/, '')] = arg.slice(eqIndex + 1);
      continue;
    }
    if (arg.startsWith('--') && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[arg.replace(/^--/, '')] = argv[index + 1];
      index += 1;
    }
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

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function parseMonth(monthStr) {
  const date = new Date(`${monthStr}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid month: ${monthStr}`);
  }
  return date;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthKeyToLabel(key) {
  return key.replace('-', '_');
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

function enumerateMonths(startMonth, endMonth) {
  const months = [];
  let cursor = parseMonth(startMonth);
  const end = parseMonth(endMonth);
  while (cursor.getTime() <= end.getTime()) {
    months.push(monthKey(cursor));
    cursor = addMonths(cursor, 1);
  }
  return months;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function toTimeRange(startDate, endDate) {
  return {
    startTimeMs: startDate.getTime(),
    endTimeMs: endDate.getTime(),
    startIso: `${toIsoDate(startDate)}T00:00:00.000Z`,
    endIso: `${toIsoDate(endDate)}T23:59:00.000Z`
  };
}

function buildMonthConfig(template, month, range, tableName) {
  const label = monthKeyToLabel(month);
  return {
    ...template,
    name: `${template.name}_${label}`,
    description: `${template.description} | ${month}`,
    timeRange: range,
    database: {
      tableName,
      resetTableBeforeRun: true
    },
    output: {
      ...(template.output ?? {}),
      topN: Math.max(Number(template.output?.topN ?? 10), 10),
      strategyNamePrefix: `${template.output?.strategyNamePrefix ?? ''}${label}-`,
      descriptionPrefix: `${template.output?.descriptionPrefix ?? ''} ${month}`
    }
  };
}

function runTrainConfig(configPath) {
  execFileSync('node', ['dist/scripts/train.js', configPath], {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });
}

async function connect() {
  return createMysqlConnectionWithFallback(mysql, {
    defaults: {
      host: '127.0.0.1'
    }
  });
}

async function queryRows(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows;
}

async function loadTopRows(connection, tableName, topN) {
  return queryRows(
    connection,
    `SELECT
      strategy_name,
      total_trades,
      win_rate,
      total_pnl,
      return_pct,
      max_drawdown,
      max_drawdown_pct,
      score,
      parameters
     FROM ${tableName}
     WHERE total_trades > 0
     ORDER BY score DESC, return_pct DESC, total_pnl DESC, strategy_name ASC
     LIMIT ?`,
    [topN]
  );
}

function extractPrice(row, field) {
  const direct = Number(row[field]);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const bid = Number(row[`bid_${field}`]);
  const ask = Number(row[`ask_${field}`]);
  if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }
  if (Number.isFinite(bid) && bid > 0) return bid;
  if (Number.isFinite(ask) && ask > 0) return ask;
  return null;
}

function detectFeatureBucket(feature) {
  if (feature.monthReturnPct <= -8 && feature.realizedVolPct >= 9) {
    return 'crash-trend';
  }
  if (feature.monthReturnPct >= 8 && feature.realizedVolPct >= 9) {
    return 'strong-trend';
  }
  if (Math.abs(feature.monthReturnPct) <= 3 && feature.realizedVolPct < 8) {
    return 'range-low-vol';
  }
  if (Math.abs(feature.monthReturnPct) <= 6) {
    return 'range-mid-vol';
  }
  return 'mixed-trend';
}

async function loadMonthKlineFeatures(connection, symbol, range) {
  const rows = await queryRows(
    connection,
    `SELECT open_time,
            open, high, low, close,
            bid_open, bid_high, bid_low, bid_close,
            ask_open, ask_high, ask_low, ask_close
     FROM klines
     WHERE symbol = ?
       AND interval_type IN ('1m', '1min')
       AND open_time BETWEEN ? AND ?
     ORDER BY open_time ASC`,
    [symbol, range.startTimeMs, range.endTimeMs]
  );

  let count = 0;
  let firstOpen = null;
  let lastClose = null;
  let sumSquaredLogReturns = 0;
  let sumAbsReturnPct = 0;
  let sumRangePct = 0;
  let maxAbsReturnPct = 0;
  let maxRangePct = 0;
  let upMinutes = 0;

  for (const row of rows) {
    const open = extractPrice(row, 'open');
    const high = extractPrice(row, 'high');
    const low = extractPrice(row, 'low');
    const close = extractPrice(row, 'close');
    if (![open, high, low, close].every(Number.isFinite) || open <= 0 || close <= 0) {
      continue;
    }

    if (firstOpen === null) {
      firstOpen = open;
    }
    lastClose = close;

    const logReturn = Math.log(close / open);
    const absReturnPct = Math.abs(logReturn) * 100;
    const rangePct = ((high - low) / open) * 100;

    count += 1;
    sumSquaredLogReturns += logReturn * logReturn;
    sumAbsReturnPct += absReturnPct;
    sumRangePct += rangePct;
    maxAbsReturnPct = Math.max(maxAbsReturnPct, absReturnPct);
    maxRangePct = Math.max(maxRangePct, rangePct);
    if (close > open) {
      upMinutes += 1;
    }
  }

  if (!count || firstOpen === null || lastClose === null) {
    return null;
  }

  const realizedVolPct = Math.sqrt(sumSquaredLogReturns) * 100;
  const monthReturnPct = ((lastClose / firstOpen) - 1) * 100;
  const feature = {
    minutes: count,
    realizedVolPct: round(realizedVolPct, 2),
    avgAbsReturnPct: round(sumAbsReturnPct / count, 4),
    avgRangePct: round(sumRangePct / count, 4),
    maxAbsReturnPct: round(maxAbsReturnPct, 4),
    maxRangePct: round(maxRangePct, 4),
    monthReturnPct: round(monthReturnPct, 2),
    upMinuteRatio: round((upMinutes / count) * 100, 2)
  };

  return {
    ...feature,
    featureBucket: detectFeatureBucket({
      realizedVolPct,
      monthReturnPct
    })
  };
}

function shortLabel(parameters) {
  const rsi = parameters.rsi ?? {};
  const macd = parameters.macd ?? {};
  const risk = parameters.risk ?? {};
  const atr = parameters.atr ?? {};
  return `RP${rsi.period}/OS${rsi.oversold}/OB${rsi.overbought}/MF${macd.fastPeriod}/MS${macd.slowPeriod}/MSG${macd.signalPeriod}/H${risk.maxHoldMinutes}/SL${atr.slMultiplier}/TP${atr.tpMultiplier}`;
}

function buildMonthlyPivotSummary(months) {
  const pivots = [];
  for (let index = 1; index < months.length; index += 1) {
    const prev = months[index - 1];
    const curr = months[index];
    if (!prev?.bestStrategy || !curr?.bestStrategy) {
      continue;
    }

    const changes = [];
    const prevParams = prev.bestStrategy.parameters;
    const currParams = curr.bestStrategy.parameters;
    if (prev.featureBucket !== curr.featureBucket) {
      changes.push(`bucket ${prev.featureBucket} -> ${curr.featureBucket}`);
    }
    if (prevParams.rsi.period !== currParams.rsi.period) {
      changes.push(`RSI period ${prevParams.rsi.period} -> ${currParams.rsi.period}`);
    }
    if (prevParams.rsi.oversold !== currParams.rsi.oversold) {
      changes.push(`OS ${prevParams.rsi.oversold} -> ${currParams.rsi.oversold}`);
    }
    if (prevParams.rsi.overbought !== currParams.rsi.overbought) {
      changes.push(`OB ${prevParams.rsi.overbought} -> ${currParams.rsi.overbought}`);
    }
    if (prevParams.macd.fastPeriod !== currParams.macd.fastPeriod) {
      changes.push(`MACD fast ${prevParams.macd.fastPeriod} -> ${currParams.macd.fastPeriod}`);
    }
    if (prevParams.macd.slowPeriod !== currParams.macd.slowPeriod) {
      changes.push(`MACD slow ${prevParams.macd.slowPeriod} -> ${currParams.macd.slowPeriod}`);
    }
    if (prevParams.macd.signalPeriod !== currParams.macd.signalPeriod) {
      changes.push(`MACD signal ${prevParams.macd.signalPeriod} -> ${currParams.macd.signalPeriod}`);
    }
    if (prevParams.risk.maxHoldMinutes !== currParams.risk.maxHoldMinutes) {
      changes.push(`hold ${prevParams.risk.maxHoldMinutes} -> ${currParams.risk.maxHoldMinutes}`);
    }
    if (prevParams.atr.slMultiplier !== currParams.atr.slMultiplier) {
      changes.push(`ATR SL ${prevParams.atr.slMultiplier} -> ${currParams.atr.slMultiplier}`);
    }
    if (prevParams.atr.tpMultiplier !== currParams.atr.tpMultiplier) {
      changes.push(`ATR TP ${prevParams.atr.tpMultiplier} -> ${currParams.atr.tpMultiplier}`);
    }

    if (changes.length > 0) {
      pivots.push({
        fromMonth: prev.month,
        toMonth: curr.month,
        changes
      });
    }
  }
  return pivots;
}

function buildFeatureStrategyMap(months) {
  const map = new Map();
  for (const month of months) {
    if (!month.bestStrategy) continue;
    const key = `${month.featureBucket}__${month.bestStrategy.shortLabel}`;
    if (!map.has(key)) {
      map.set(key, {
        featureBucket: month.featureBucket,
        strategyName: month.bestStrategy.strategyName,
        shortLabel: month.bestStrategy.shortLabel,
        months: [],
        totalPnl: 0,
        realizedVolPct: [],
        monthReturnPct: [],
        avgRangePct: []
      });
    }
    const entry = map.get(key);
    entry.months.push(month.month);
    entry.totalPnl += month.bestStrategy.totalPnl;
    entry.realizedVolPct.push(month.realizedVolPct);
    entry.monthReturnPct.push(month.monthReturnPct);
    entry.avgRangePct.push(month.avgRangePct);
  }

  return Array.from(map.values())
    .map((entry) => ({
      featureBucket: entry.featureBucket,
      strategyName: entry.strategyName,
      shortLabel: entry.shortLabel,
      months: entry.months,
      monthCount: entry.months.length,
      totalPnl: round(entry.totalPnl, 2),
      avgPnl: round(entry.totalPnl / entry.months.length, 2),
      avgRealizedVolPct: round(entry.realizedVolPct.reduce((sum, value) => sum + value, 0) / entry.realizedVolPct.length, 2),
      avgMonthReturnPct: round(entry.monthReturnPct.reduce((sum, value) => sum + value, 0) / entry.monthReturnPct.length, 2),
      avgRangePct: round(entry.avgRangePct.reduce((sum, value) => sum + value, 0) / entry.avgRangePct.length, 4)
    }))
    .sort((left, right) => right.totalPnl - left.totalPnl || right.monthCount - left.monthCount || left.shortLabel.localeCompare(right.shortLabel));
}

function buildContiguousSegments(months) {
  if (months.length === 0) return [];
  const segments = [];
  let current = null;

  for (const month of months) {
    if (!month.bestStrategy) continue;
    const key = `${month.featureBucket}__${month.bestStrategy.shortLabel}`;
    if (!current || current.key !== key) {
      if (current) {
        segments.push(current);
      }
      current = {
        key,
        featureBucket: month.featureBucket,
        shortLabel: month.bestStrategy.shortLabel,
        startMonth: month.month,
        endMonth: month.month,
        months: [month.month],
        totalPnl: month.bestStrategy.totalPnl,
        realizedVolPct: [month.realizedVolPct],
        monthReturnPct: [month.monthReturnPct],
        avgRangePct: [month.avgRangePct]
      };
      continue;
    }

    current.endMonth = month.month;
    current.months.push(month.month);
    current.totalPnl += month.bestStrategy.totalPnl;
    current.realizedVolPct.push(month.realizedVolPct);
    current.monthReturnPct.push(month.monthReturnPct);
    current.avgRangePct.push(month.avgRangePct);
  }

  if (current) {
    segments.push(current);
  }

  return segments
    .map((segment) => ({
      featureBucket: segment.featureBucket,
      shortLabel: segment.shortLabel,
      startMonth: segment.startMonth,
      endMonth: segment.endMonth,
      months: segment.months,
      monthCount: segment.months.length,
      totalPnl: round(segment.totalPnl, 2),
      avgPnl: round(segment.totalPnl / segment.months.length, 2),
      avgRealizedVolPct: round(segment.realizedVolPct.reduce((sum, value) => sum + value, 0) / segment.realizedVolPct.length, 2),
      avgMonthReturnPct: round(segment.monthReturnPct.reduce((sum, value) => sum + value, 0) / segment.monthReturnPct.length, 2),
      avgRangePct: round(segment.avgRangePct.reduce((sum, value) => sum + value, 0) / segment.avgRangePct.length, 4)
    }))
    .sort((left, right) => right.totalPnl - left.totalPnl || right.monthCount - left.monthCount || left.startMonth.localeCompare(right.startMonth));
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# ${report.symbol} Monthly Regime Transition ${report.startMonth} -> ${report.endMonth}`);
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push(`- Symbol: \`${report.symbol}\``);
  lines.push(`- Template config: \`${report.templateConfig}\``);
  lines.push(`- Month range: \`${report.startMonth}\` -> \`${report.endMonth}\``);
  lines.push(`- Total months trained: \`${report.months.length}\``);
  lines.push(`- Strategy family: \`BTCJPY V7 HF RSI+MACD\``);
  lines.push('');
  lines.push('## Monthly Top1');
  lines.push('');
  lines.push('| Month | Feature Bucket | Return % | Realized Vol % | Avg Range % | Top Strategy | Trades | Win Rate % | PnL |');
  lines.push('| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |');
  for (const month of report.months) {
    lines.push(`| ${month.month} | ${month.featureBucket} | ${month.monthReturnPct} | ${month.realizedVolPct} | ${month.avgRangePct} | ${month.bestStrategy?.shortLabel ?? '-'} | ${month.bestStrategy?.totalTrades ?? 0} | ${month.bestStrategy?.winRatePct ?? 0} | ${month.bestStrategy?.totalPnl ?? 0} |`);
  }
  lines.push('');
  lines.push('## Pivot Points');
  lines.push('');
  for (const pivot of report.pivots) {
    lines.push(`- \`${pivot.toMonth}\`: ${pivot.changes.join(' | ')}`);
  }
  if (!report.pivots.length) {
    lines.push('- No pivots detected.');
  }
  lines.push('');
  lines.push('## Feature -> Strategy Map');
  lines.push('');
  for (const entry of report.featureStrategyMap.slice(0, 12)) {
    lines.push(`- \`${entry.featureBucket}\` -> \`${entry.shortLabel}\``);
    lines.push(`  months: \`${entry.months.join(', ')}\``);
    lines.push(`  totalPnL: \`${entry.totalPnl}\`, avgPnL: \`${entry.avgPnl}\`, avgRealizedVol: \`${entry.avgRealizedVolPct}%\`, avgReturn: \`${entry.avgMonthReturnPct}%\``);
  }
  lines.push('');
  lines.push('## Best Time Segments');
  lines.push('');
  for (const segment of report.bestSegments.slice(0, 10)) {
    lines.push(`- \`${segment.startMonth} -> ${segment.endMonth}\` | bucket=\`${segment.featureBucket}\` | strategy=\`${segment.shortLabel}\` | totalPnL=\`${segment.totalPnl}\``);
    lines.push(`  months: \`${segment.months.join(', ')}\``);
    lines.push(`  avgRealizedVol=\`${segment.avgRealizedVolPct}%\`, avgMonthReturn=\`${segment.avgMonthReturnPct}%\`, avgRange=\`${segment.avgRangePct}%\``);
  }
  lines.push('');
  if (report.bestFeatureCombo) {
    lines.push('## Strongest Feature/Strategy Combo');
    lines.push('');
    lines.push(`- Feature bucket: \`${report.bestFeatureCombo.featureBucket}\``);
    lines.push(`- Strategy: \`${report.bestFeatureCombo.shortLabel}\``);
    lines.push(`- Months: \`${report.bestFeatureCombo.months.join(', ')}\``);
    lines.push(`- Total PnL: \`${report.bestFeatureCombo.totalPnl}\``);
    lines.push(`- Avg realized vol: \`${report.bestFeatureCombo.avgRealizedVolPct}%\``);
    lines.push(`- Avg month return: \`${report.bestFeatureCombo.avgMonthReturnPct}%\``);
  }
  lines.push('');
  if (report.bestSegment) {
    lines.push('## Best Contiguous Interval');
    lines.push('');
    lines.push(`- Interval: \`${report.bestSegment.startMonth} -> ${report.bestSegment.endMonth}\``);
    lines.push(`- Feature bucket: \`${report.bestSegment.featureBucket}\``);
    lines.push(`- Strategy: \`${report.bestSegment.shortLabel}\``);
    lines.push(`- Total PnL: \`${report.bestSegment.totalPnl}\``);
    lines.push(`- Months: \`${report.bestSegment.months.join(', ')}\``);
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const templatePath = path.resolve(required(args, 'template'));
  const symbol = required(args, 'symbol').toUpperCase();
  const startMonth = required(args, 'startMonth');
  const endMonth = required(args, 'endMonth');
  const topN = Number(args.topN || '10');
  const template = loadJson(templatePath);

  ensureDir(GENERATED_DIR);
  ensureDir(REPORT_DIR);

  const connection = await connect();
  try {
    const months = [];
    for (const month of enumerateMonths(startMonth, endMonth)) {
      const monthDate = parseMonth(month);
      const range = toTimeRange(startOfUtcMonth(monthDate), endOfUtcMonth(monthDate));
      const label = monthKeyToLabel(month);
      const tableName = `backtest_results_${symbol.toLowerCase()}_monthly_regime_${label}`;
      const config = buildMonthConfig(template, month, range, tableName);
      const configPath = path.join(GENERATED_DIR, `${symbol.toLowerCase()}_${label}_train.json`);

      writeJson(configPath, config);
      console.log(`\n[monthly-regime] training ${month} ...`);
      runTrainConfig(path.relative(ROOT_DIR, configPath));

      const topRows = await loadTopRows(connection, tableName, topN);
      const bestRow = topRows[0];
      const feature = await loadMonthKlineFeatures(connection, symbol, range);
      if (!feature) {
        continue;
      }

      months.push({
        month,
        ...feature,
        topCandidates: topRows.map((row) => {
          const parameters = typeof row.parameters === 'string' ? JSON.parse(row.parameters) : row.parameters;
          return {
            strategyName: row.strategy_name,
            shortLabel: shortLabel(parameters),
            totalTrades: Number(row.total_trades),
            winRatePct: round(Number(row.win_rate) * 100, 2),
            totalPnl: round(Number(row.total_pnl), 2),
            returnPct: round(Number(row.return_pct), 4),
            score: round(Number(row.score), 4),
            parameters
          };
        }),
        bestStrategy: bestRow ? (() => {
          const parameters = typeof bestRow.parameters === 'string' ? JSON.parse(bestRow.parameters) : bestRow.parameters;
          return {
            strategyName: bestRow.strategy_name,
            shortLabel: shortLabel(parameters),
            totalTrades: Number(bestRow.total_trades),
            winRatePct: round(Number(bestRow.win_rate) * 100, 2),
            totalPnl: round(Number(bestRow.total_pnl), 2),
            returnPct: round(Number(bestRow.return_pct), 4),
            score: round(Number(bestRow.score), 4),
            parameters
          };
        })() : null
      });
    }

    const pivots = buildMonthlyPivotSummary(months);
    const featureStrategyMap = buildFeatureStrategyMap(months);
    const bestSegments = buildContiguousSegments(months);

    const report = {
      symbol,
      startMonth,
      endMonth,
      templateConfig: path.relative(ROOT_DIR, templatePath),
      generatedAt: new Date().toISOString(),
      months,
      pivots,
      featureStrategyMap,
      bestFeatureCombo: featureStrategyMap[0] ?? null,
      bestSegments,
      bestSegment: bestSegments[0] ?? null
    };

    const prefix = `${symbol}_${startMonth.replace('-', '_')}_${endMonth.replace('-', '_')}_monthly_regime_transition`;
    const jsonPath = path.join(REPORT_DIR, `${prefix}.json`);
    const mdPath = path.join(REPORT_DIR, `${prefix}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    fs.writeFileSync(mdPath, buildMarkdown(report), 'utf8');

    console.log(`\n[monthly-regime] JSON written: ${jsonPath}`);
    console.log(`[monthly-regime] MD written: ${mdPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[monthly-regime] failed: ${error.stack || error.message}`);
  process.exit(1);
});
