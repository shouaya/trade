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
const GENERATED_DIR = path.join(ROOT_DIR, 'configs', 'generated', 'weekly-regime');
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'weekly-regime');
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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

function startOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 0, 0));
}

function parseMonthsArg(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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

function jstDateFromUtcMs(timestampMs) {
  return new Date(timestampMs + JST_OFFSET_MS);
}

function utcMsFromJstDate(date) {
  return date.getTime() - JST_OFFSET_MS;
}

function getIsoWeekInfoFromUtcMs(timestampMs) {
  const jst = jstDateFromUtcMs(timestampMs);
  const utcDate = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const key = `${isoYear}-W${String(weekNo).padStart(2, '0')}`;

  const weekStartJst = new Date(utcDate);
  weekStartJst.setUTCDate(utcDate.getUTCDate() - 3);
  weekStartJst.setUTCHours(0, 0, 0, 0);

  const weekEndJst = new Date(weekStartJst.getTime() + WEEK_MS - 60 * 1000);

  return {
    key,
    isoYear,
    isoWeek: weekNo,
    startUtc: new Date(utcMsFromJstDate(weekStartJst)),
    endUtc: new Date(utcMsFromJstDate(weekEndJst))
  };
}

function enumerateWeeksForMonths(months) {
  const seen = new Map();
  for (const month of months) {
    const monthDate = parseMonth(month);
    const monthStart = startOfUtcMonth(monthDate).getTime();
    const monthEnd = endOfUtcMonth(monthDate).getTime();
    for (let cursor = monthStart; cursor <= monthEnd; cursor += 24 * 60 * 60 * 1000) {
      const info = getIsoWeekInfoFromUtcMs(cursor);
      if (!seen.has(info.key)) {
        seen.set(info.key, {
          week: info.key,
          isoYear: info.isoYear,
          isoWeek: info.isoWeek,
          startUtc: info.startUtc,
          endUtc: info.endUtc,
          months: new Set()
        });
      }
      seen.get(info.key).months.add(month);
    }
  }

  return Array.from(seen.values())
    .map((item) => ({
      ...item,
      months: Array.from(item.months).sort(),
      label: item.week.replace(/[^0-9A-Z]/gi, '_')
    }))
    .sort((left, right) => left.startUtc.getTime() - right.startUtc.getTime());
}

function buildWeekConfig(template, weekInfo, range, tableName) {
  return {
    ...template,
    name: `${template.name}_${weekInfo.label}`,
    description: `${template.description} | ${weekInfo.week}`,
    timeRange: range,
    database: {
      tableName,
      resetTableBeforeRun: true
    },
    output: {
      ...(template.output ?? {}),
      topN: Math.max(Number(template.output?.topN ?? 10), 10),
      strategyNamePrefix: `${template.output?.strategyNamePrefix ?? ''}${weekInfo.label}-`,
      descriptionPrefix: `${template.output?.descriptionPrefix ?? ''} ${weekInfo.week}`
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
  if (feature.periodReturnPct <= -4 && feature.realizedVolPct >= 5) {
    return 'crash-trend';
  }
  if (feature.periodReturnPct >= 4 && feature.realizedVolPct >= 5) {
    return 'strong-trend';
  }
  if (Math.abs(feature.periodReturnPct) <= 1.5 && feature.realizedVolPct < 4) {
    return 'range-low-vol';
  }
  if (Math.abs(feature.periodReturnPct) <= 3.5) {
    return 'range-mid-vol';
  }
  return 'mixed-trend';
}

async function loadWeekKlineFeatures(connection, symbol, range) {
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
  const periodReturnPct = ((lastClose / firstOpen) - 1) * 100;
  const feature = {
    minutes: count,
    realizedVolPct: round(realizedVolPct, 2),
    avgAbsReturnPct: round(sumAbsReturnPct / count, 4),
    avgRangePct: round(sumRangePct / count, 4),
    maxAbsReturnPct: round(maxAbsReturnPct, 4),
    maxRangePct: round(maxRangePct, 4),
    periodReturnPct: round(periodReturnPct, 2),
    upMinuteRatio: round((upMinutes / count) * 100, 2)
  };

  return {
    ...feature,
    featureBucket: detectFeatureBucket({
      realizedVolPct,
      periodReturnPct
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

function buildPivotSummary(weeks) {
  const pivots = [];
  for (let index = 1; index < weeks.length; index += 1) {
    const prev = weeks[index - 1];
    const curr = weeks[index];
    if (!prev?.bestStrategy || !curr?.bestStrategy) continue;

    const prevParams = prev.bestStrategy.parameters;
    const currParams = curr.bestStrategy.parameters;
    const changes = [];
    if (prev.featureBucket !== curr.featureBucket) changes.push(`bucket ${prev.featureBucket} -> ${curr.featureBucket}`);
    if (prevParams.rsi.period !== currParams.rsi.period) changes.push(`RSI period ${prevParams.rsi.period} -> ${currParams.rsi.period}`);
    if (prevParams.rsi.oversold !== currParams.rsi.oversold) changes.push(`OS ${prevParams.rsi.oversold} -> ${currParams.rsi.oversold}`);
    if (prevParams.rsi.overbought !== currParams.rsi.overbought) changes.push(`OB ${prevParams.rsi.overbought} -> ${currParams.rsi.overbought}`);
    if (prevParams.macd.fastPeriod !== currParams.macd.fastPeriod) changes.push(`MACD fast ${prevParams.macd.fastPeriod} -> ${currParams.macd.fastPeriod}`);
    if (prevParams.macd.slowPeriod !== currParams.macd.slowPeriod) changes.push(`MACD slow ${prevParams.macd.slowPeriod} -> ${currParams.macd.slowPeriod}`);
    if (prevParams.macd.signalPeriod !== currParams.macd.signalPeriod) changes.push(`MACD signal ${prevParams.macd.signalPeriod} -> ${currParams.macd.signalPeriod}`);
    if (prevParams.risk.maxHoldMinutes !== currParams.risk.maxHoldMinutes) changes.push(`hold ${prevParams.risk.maxHoldMinutes} -> ${currParams.risk.maxHoldMinutes}`);
    if (prevParams.atr.slMultiplier !== currParams.atr.slMultiplier) changes.push(`ATR SL ${prevParams.atr.slMultiplier} -> ${currParams.atr.slMultiplier}`);
    if (prevParams.atr.tpMultiplier !== currParams.atr.tpMultiplier) changes.push(`ATR TP ${prevParams.atr.tpMultiplier} -> ${currParams.atr.tpMultiplier}`);

    if (changes.length > 0) {
      pivots.push({
        fromWeek: prev.week,
        toWeek: curr.week,
        changes
      });
    }
  }
  return pivots;
}

function buildFeatureStrategyMap(weeks) {
  const map = new Map();
  for (const week of weeks) {
    if (!week.bestStrategy) continue;
    const key = `${week.featureBucket}__${week.bestStrategy.shortLabel}`;
    if (!map.has(key)) {
      map.set(key, {
        featureBucket: week.featureBucket,
        strategyName: week.bestStrategy.strategyName,
        shortLabel: week.bestStrategy.shortLabel,
        weeks: [],
        sourceMonths: new Set(),
        totalPnl: 0,
        realizedVolPct: [],
        periodReturnPct: [],
        avgRangePct: []
      });
    }
    const entry = map.get(key);
    entry.weeks.push(week.week);
    for (const month of week.sourceMonths) {
      entry.sourceMonths.add(month);
    }
    entry.totalPnl += week.bestStrategy.totalPnl;
    entry.realizedVolPct.push(week.realizedVolPct);
    entry.periodReturnPct.push(week.periodReturnPct);
    entry.avgRangePct.push(week.avgRangePct);
  }

  return Array.from(map.values())
    .map((entry) => ({
      featureBucket: entry.featureBucket,
      strategyName: entry.strategyName,
      shortLabel: entry.shortLabel,
      weeks: entry.weeks,
      sourceMonths: Array.from(entry.sourceMonths).sort(),
      weekCount: entry.weeks.length,
      totalPnl: round(entry.totalPnl, 2),
      avgPnl: round(entry.totalPnl / entry.weeks.length, 2),
      avgRealizedVolPct: round(entry.realizedVolPct.reduce((sum, value) => sum + value, 0) / entry.realizedVolPct.length, 2),
      avgPeriodReturnPct: round(entry.periodReturnPct.reduce((sum, value) => sum + value, 0) / entry.periodReturnPct.length, 2),
      avgRangePct: round(entry.avgRangePct.reduce((sum, value) => sum + value, 0) / entry.avgRangePct.length, 4)
    }))
    .sort((left, right) => right.totalPnl - left.totalPnl || right.weekCount - left.weekCount || left.shortLabel.localeCompare(right.shortLabel));
}

function buildContiguousSegments(weeks) {
  if (!weeks.length) return [];
  const segments = [];
  let current = null;

  for (const week of weeks) {
    if (!week.bestStrategy) continue;
    const key = `${week.featureBucket}__${week.bestStrategy.shortLabel}`;
    if (!current || current.key !== key) {
      if (current) segments.push(current);
      current = {
        key,
        featureBucket: week.featureBucket,
        shortLabel: week.bestStrategy.shortLabel,
        startWeek: week.week,
        endWeek: week.week,
        weeks: [week.week],
        sourceMonths: new Set(week.sourceMonths),
        totalPnl: week.bestStrategy.totalPnl,
        realizedVolPct: [week.realizedVolPct],
        periodReturnPct: [week.periodReturnPct],
        avgRangePct: [week.avgRangePct]
      };
      continue;
    }

    current.endWeek = week.week;
    current.weeks.push(week.week);
    for (const month of week.sourceMonths) {
      current.sourceMonths.add(month);
    }
    current.totalPnl += week.bestStrategy.totalPnl;
    current.realizedVolPct.push(week.realizedVolPct);
    current.periodReturnPct.push(week.periodReturnPct);
    current.avgRangePct.push(week.avgRangePct);
  }

  if (current) segments.push(current);

  return segments
    .map((segment) => ({
      featureBucket: segment.featureBucket,
      shortLabel: segment.shortLabel,
      startWeek: segment.startWeek,
      endWeek: segment.endWeek,
      weeks: segment.weeks,
      sourceMonths: Array.from(segment.sourceMonths).sort(),
      weekCount: segment.weeks.length,
      totalPnl: round(segment.totalPnl, 2),
      avgPnl: round(segment.totalPnl / segment.weeks.length, 2),
      avgRealizedVolPct: round(segment.realizedVolPct.reduce((sum, value) => sum + value, 0) / segment.realizedVolPct.length, 2),
      avgPeriodReturnPct: round(segment.periodReturnPct.reduce((sum, value) => sum + value, 0) / segment.periodReturnPct.length, 2),
      avgRangePct: round(segment.avgRangePct.reduce((sum, value) => sum + value, 0) / segment.avgRangePct.length, 4)
    }))
    .sort((left, right) => right.totalPnl - left.totalPnl || right.weekCount - left.weekCount || left.startWeek.localeCompare(right.startWeek));
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# ${report.symbol} Weekly Regime Transition ${report.months.join(', ')}`);
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push(`- Symbol: \`${report.symbol}\``);
  lines.push(`- Template config: \`${report.templateConfig}\``);
  lines.push(`- Focus months: \`${report.months.join(', ')}\``);
  lines.push(`- Total weeks trained: \`${report.weeks.length}\``);
  lines.push(`- Strategy family: \`BTCJPY V7 HF RSI+MACD\``);
  lines.push('');
  lines.push('## Weekly Top1');
  lines.push('');
  lines.push('| Week | Source Months | Feature Bucket | Return % | Realized Vol % | Avg Range % | Top Strategy | Trades | Win Rate % | PnL |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |');
  for (const week of report.weeks) {
    lines.push(`| ${week.week} | ${week.sourceMonths.join(', ')} | ${week.featureBucket} | ${week.periodReturnPct} | ${week.realizedVolPct} | ${week.avgRangePct} | ${week.bestStrategy?.shortLabel ?? '-'} | ${week.bestStrategy?.totalTrades ?? 0} | ${week.bestStrategy?.winRatePct ?? 0} | ${week.bestStrategy?.totalPnl ?? 0} |`);
  }
  lines.push('');
  lines.push('## Pivot Points');
  lines.push('');
  if (!report.pivots.length) {
    lines.push('- No pivots detected.');
  } else {
    for (const pivot of report.pivots) {
      lines.push(`- \`${pivot.toWeek}\`: ${pivot.changes.join(' | ')}`);
    }
  }
  lines.push('');
  lines.push('## Feature -> Strategy Map');
  lines.push('');
  for (const entry of report.featureStrategyMap.slice(0, 16)) {
    lines.push(`- \`${entry.featureBucket}\` -> \`${entry.shortLabel}\``);
    lines.push(`  weeks: \`${entry.weeks.join(', ')}\``);
    lines.push(`  months: \`${entry.sourceMonths.join(', ')}\``);
    lines.push(`  totalPnL: \`${entry.totalPnl}\`, avgPnL: \`${entry.avgPnl}\`, avgRealizedVol: \`${entry.avgRealizedVolPct}%\`, avgReturn: \`${entry.avgPeriodReturnPct}%\``);
  }
  lines.push('');
  lines.push('## Best Time Segments');
  lines.push('');
  for (const segment of report.bestSegments.slice(0, 12)) {
    lines.push(`- \`${segment.startWeek} -> ${segment.endWeek}\` | bucket=\`${segment.featureBucket}\` | strategy=\`${segment.shortLabel}\` | totalPnL=\`${segment.totalPnl}\``);
    lines.push(`  weeks: \`${segment.weeks.join(', ')}\``);
    lines.push(`  months: \`${segment.sourceMonths.join(', ')}\``);
    lines.push(`  avgRealizedVol=\`${segment.avgRealizedVolPct}%\`, avgWeekReturn=\`${segment.avgPeriodReturnPct}%\`, avgRange=\`${segment.avgRangePct}%\``);
  }
  lines.push('');
  if (report.bestFeatureCombo) {
    lines.push('## Strongest Feature/Strategy Combo');
    lines.push('');
    lines.push(`- Feature bucket: \`${report.bestFeatureCombo.featureBucket}\``);
    lines.push(`- Strategy: \`${report.bestFeatureCombo.shortLabel}\``);
    lines.push(`- Weeks: \`${report.bestFeatureCombo.weeks.join(', ')}\``);
    lines.push(`- Total PnL: \`${report.bestFeatureCombo.totalPnl}\``);
    lines.push(`- Avg realized vol: \`${report.bestFeatureCombo.avgRealizedVolPct}%\``);
    lines.push(`- Avg week return: \`${report.bestFeatureCombo.avgPeriodReturnPct}%\``);
  }
  lines.push('');
  if (report.bestSegment) {
    lines.push('## Best Contiguous Interval');
    lines.push('');
    lines.push(`- Interval: \`${report.bestSegment.startWeek} -> ${report.bestSegment.endWeek}\``);
    lines.push(`- Feature bucket: \`${report.bestSegment.featureBucket}\``);
    lines.push(`- Strategy: \`${report.bestSegment.shortLabel}\``);
    lines.push(`- Total PnL: \`${report.bestSegment.totalPnl}\``);
    lines.push(`- Weeks: \`${report.bestSegment.weeks.join(', ')}\``);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const templatePath = path.resolve(required(args, 'template'));
  const symbol = required(args, 'symbol').toUpperCase();
  const months = parseMonthsArg(required(args, 'months'));
  const topN = Number(args.topN || '10');
  const template = loadJson(templatePath);

  ensureDir(GENERATED_DIR);
  ensureDir(REPORT_DIR);

  const connection = await connect();
  try {
    const weeks = [];
    for (const weekInfo of enumerateWeeksForMonths(months)) {
      const range = toTimeRange(weekInfo.startUtc, weekInfo.endUtc);
      const tableName = `backtest_results_${symbol.toLowerCase()}_weekly_regime_${weekInfo.label.toLowerCase()}`;
      const config = buildWeekConfig(template, weekInfo, range, tableName);
      const configPath = path.join(GENERATED_DIR, `${symbol.toLowerCase()}_${weekInfo.label.toLowerCase()}_train.json`);

      writeJson(configPath, config);
      console.log(`\n[weekly-regime] training ${weekInfo.week} (${weekInfo.months.join(', ')}) ...`);
      runTrainConfig(path.relative(ROOT_DIR, configPath));

      const topRows = await loadTopRows(connection, tableName, topN);
      const bestRow = topRows[0];
      const feature = await loadWeekKlineFeatures(connection, symbol, range);
      if (!feature) {
        continue;
      }

      weeks.push({
        week: weekInfo.week,
        sourceMonths: weekInfo.months,
        range,
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

    const pivots = buildPivotSummary(weeks);
    const featureStrategyMap = buildFeatureStrategyMap(weeks);
    const bestSegments = buildContiguousSegments(weeks);
    const report = {
      symbol,
      months,
      templateConfig: path.relative(ROOT_DIR, templatePath),
      generatedAt: new Date().toISOString(),
      weeks,
      pivots,
      featureStrategyMap,
      bestFeatureCombo: featureStrategyMap[0] ?? null,
      bestSegments,
      bestSegment: bestSegments[0] ?? null
    };

    const prefix = `${symbol}_${months.join('_').replace(/-/g, '_')}_weekly_regime_transition`;
    const jsonPath = path.join(REPORT_DIR, `${prefix}.json`);
    const mdPath = path.join(REPORT_DIR, `${prefix}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    fs.writeFileSync(mdPath, buildMarkdown(report), 'utf8');

    console.log(`\n[weekly-regime] JSON written: ${jsonPath}`);
    console.log(`[weekly-regime] MD written: ${mdPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[weekly-regime] failed: ${error.stack || error.message}`);
  process.exit(1);
});
