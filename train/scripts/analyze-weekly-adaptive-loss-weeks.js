#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });
dotenv.config();

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const REPORT_DIR = path.resolve(__dirname, '../reports/weekly-adaptive-losses');

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

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function toJstDate(timestampMs) {
  return new Date(timestampMs + JST_OFFSET_MS);
}

function getJstDayKey(timestampMs) {
  const date = toJstDate(timestampMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function choosePrice(row, field) {
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

function detectDailyFeatureBucket(feature) {
  if (feature.dayReturnPct <= -2.5 && feature.realizedVolPct >= 2.5) return 'crash-trend';
  if (feature.dayReturnPct >= 2.5 && feature.realizedVolPct >= 2.5) return 'strong-trend';
  if (Math.abs(feature.dayReturnPct) <= 0.8 && feature.realizedVolPct < 2.2) return 'range-low-vol';
  if (Math.abs(feature.dayReturnPct) <= 1.5) return 'range-mid-vol';
  return 'mixed-trend';
}

function getWeekRangeFromIsoWeekKey(weekKey) {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) {
    throw new Error(`invalid week key: ${weekKey}`);
  }
  const isoYear = Number(match[1]);
  const isoWeek = Number(match[2]);

  const jan4 = new Date(Date.UTC(isoYear, 0, 4, 0, 0, 0, 0));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayJst = new Date(jan4.getTime() - (jan4Day - 1) * DAY_MS + (isoWeek - 1) * WEEK_MS);
  mondayJst.setUTCHours(0, 0, 0, 0);
  const weekStartUtcMs = mondayJst.getTime() - JST_OFFSET_MS;
  const weekEndUtcMs = weekStartUtcMs + WEEK_MS - 60 * 1000;

  return {
    weekKey,
    startTimeMs: weekStartUtcMs,
    endTimeMs: weekEndUtcMs
  };
}

async function connect() {
  return mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'trader',
    password: process.env.DB_PASSWORD || 'traderpass',
    database: process.env.DB_NAME || 'trading',
    charset: 'utf8mb4'
  }).catch(async () => mysql.createConnection({
    host: '127.0.0.1',
    port: Number(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'trader',
    password: process.env.DB_PASSWORD || 'traderpass',
    database: process.env.DB_NAME || 'trading',
    charset: 'utf8mb4'
  }));
}

async function queryRows(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows;
}

async function findLatestTradeBatch(connection, strategyNames, symbol, range) {
  const placeholders = strategyNames.map(() => '?').join(', ');
  const rows = await queryRows(
    connection,
    `SELECT DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i:%s') AS created_at
     FROM trades
     WHERE strategy_name IN (${placeholders})
       AND symbol = ?
       AND exit_time BETWEEN ? AND ?`,
    [...strategyNames, symbol, range.startTimeMs, range.endTimeMs]
  );
  return rows[0]?.created_at ? String(rows[0].created_at) : null;
}

async function loadTrades(connection, strategyNames, symbol, range, createdAt) {
  const placeholders = strategyNames.map(() => '?').join(', ');
  return queryRows(
    connection,
    `SELECT strategy_name, exit_time, pnl, exit_reason, actual_hold_minutes
     FROM trades
     WHERE created_at = ?
       AND strategy_name IN (${placeholders})
       AND symbol = ?
       AND exit_time BETWEEN ? AND ?
     ORDER BY exit_time ASC, strategy_name ASC`,
    [createdAt, ...strategyNames, symbol, range.startTimeMs, range.endTimeMs]
  );
}

async function loadKlines(connection, symbol, range) {
  return queryRows(
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
}

function aggregateDailyFeatures(klines) {
  const dayMap = new Map();

  for (const row of klines) {
    const openTime = Number(row.open_time);
    const open = choosePrice(row, 'open');
    const high = choosePrice(row, 'high');
    const low = choosePrice(row, 'low');
    const close = choosePrice(row, 'close');
    if (![openTime, open, high, low, close].every(Number.isFinite) || open <= 0 || close <= 0) {
      continue;
    }

    const dayKey = getJstDayKey(openTime);
    let day = dayMap.get(dayKey);
    if (!day) {
      day = {
        day: dayKey,
        count: 0,
        firstOpen: open,
        lastClose: close,
        sumSquaredLogReturns: 0,
        sumRangePct: 0,
        maxAbsReturnPct: 0,
        maxRangePct: 0,
        upMinutes: 0
      };
      dayMap.set(dayKey, day);
    }

    const logReturn = Math.log(close / open);
    const absReturnPct = Math.abs(logReturn) * 100;
    const rangePct = ((high - low) / open) * 100;

    day.count += 1;
    day.lastClose = close;
    day.sumSquaredLogReturns += logReturn * logReturn;
    day.sumRangePct += rangePct;
    day.maxAbsReturnPct = Math.max(day.maxAbsReturnPct, absReturnPct);
    day.maxRangePct = Math.max(day.maxRangePct, rangePct);
    if (close > open) {
      day.upMinutes += 1;
    }
  }

  return new Map(
    Array.from(dayMap.values())
      .sort((left, right) => left.day.localeCompare(right.day))
      .map((day) => {
        const feature = {
          day: day.day,
          realizedVolPct: round(Math.sqrt(day.sumSquaredLogReturns) * 100, 2),
          avgRangePct: round(day.sumRangePct / day.count, 4),
          maxAbsReturnPct: round(day.maxAbsReturnPct, 4),
          maxRangePct: round(day.maxRangePct, 4),
          dayReturnPct: round(((day.lastClose / day.firstOpen) - 1) * 100, 2),
          upMinuteRatio: round((day.upMinutes / day.count) * 100, 2)
        };
        return [day.day, {
          ...feature,
          featureBucket: detectDailyFeatureBucket(feature)
        }];
      })
  );
}

function aggregateDailyTrades(trades, strategyNames) {
  const dayMap = new Map();

  for (const row of trades) {
    const dayKey = getJstDayKey(Number(row.exit_time));
    let day = dayMap.get(dayKey);
    if (!day) {
      day = {
        day: dayKey,
        strategies: new Map()
      };
      dayMap.set(dayKey, day);
    }

    const strategyName = String(row.strategy_name);
    let strategy = day.strategies.get(strategyName);
    if (!strategy) {
      strategy = {
        strategyName,
        pnl: 0,
        trades: 0,
        stopLossTrades: 0,
        takeProfitTrades: 0,
        holdExitTrades: 0,
        avgHoldMinutesSum: 0
      };
      day.strategies.set(strategyName, strategy);
    }

    const pnl = Number(row.pnl);
    const holdMinutes = Number(row.actual_hold_minutes);
    strategy.pnl += Number.isFinite(pnl) ? pnl : 0;
    strategy.trades += 1;
    strategy.avgHoldMinutesSum += Number.isFinite(holdMinutes) ? holdMinutes : 0;
    if (row.exit_reason === 'stop_loss') strategy.stopLossTrades += 1;
    if (row.exit_reason === 'take_profit') strategy.takeProfitTrades += 1;
    if (row.exit_reason === 'hold_time_reached') strategy.holdExitTrades += 1;
  }

  return Array.from(dayMap.values())
    .sort((left, right) => left.day.localeCompare(right.day))
    .map((day) => {
      const strategyRows = strategyNames.map((strategyName) => {
        const row = day.strategies.get(strategyName);
        return {
          strategyName,
          pnl: round(row?.pnl ?? 0, 2),
          trades: row?.trades ?? 0,
          stopLossTrades: row?.stopLossTrades ?? 0,
          takeProfitTrades: row?.takeProfitTrades ?? 0,
          holdExitTrades: row?.holdExitTrades ?? 0,
          avgHoldMinutes: row?.trades ? round(row.avgHoldMinutesSum / row.trades, 2) : 0
        };
      });
      const comboPnl = round(strategyRows.reduce((sum, row) => sum + row.pnl, 0) / strategyNames.length, 2);
      const totalTrades = strategyRows.reduce((sum, row) => sum + row.trades, 0);
      const totalStopLossTrades = strategyRows.reduce((sum, row) => sum + row.stopLossTrades, 0);
      const totalTakeProfitTrades = strategyRows.reduce((sum, row) => sum + row.takeProfitTrades, 0);
      const totalHoldExitTrades = strategyRows.reduce((sum, row) => sum + row.holdExitTrades, 0);
      return {
        day: day.day,
        comboPnl,
        totalTrades,
        totalStopLossTrades,
        totalTakeProfitTrades,
        totalHoldExitTrades,
        allStrategiesNegative: strategyRows.every((row) => row.pnl < 0),
        anyStrategyPositive: strategyRows.some((row) => row.pnl > 0),
        strategyRows
      };
    });
}

function buildDayRows(dailyFeatures, dailyTrades, weeklyRow) {
  const tradeByDay = new Map(dailyTrades.map((row) => [row.day, row]));
  const featureByDay = dailyFeatures;
  const allDays = [...new Set([...featureByDay.keys(), ...tradeByDay.keys()])].sort();

  return allDays.map((dayKey) => {
    const feature = featureByDay.get(dayKey) ?? null;
    const trade = tradeByDay.get(dayKey) ?? {
      day: dayKey,
      comboPnl: 0,
      totalTrades: 0,
      totalStopLossTrades: 0,
      totalTakeProfitTrades: 0,
      totalHoldExitTrades: 0,
      allStrategiesNegative: false,
      anyStrategyPositive: false,
      strategyRows: weeklyRow.comboStrategies.map((strategy) => ({
        strategyName: strategy.strategyName,
        pnl: 0,
        trades: 0,
        stopLossTrades: 0,
        takeProfitTrades: 0,
        holdExitTrades: 0,
        avgHoldMinutes: 0
      }))
    };

    return {
      day: dayKey,
      featureBucket: feature?.featureBucket ?? null,
      realizedVolPct: feature?.realizedVolPct ?? null,
      dayReturnPct: feature?.dayReturnPct ?? null,
      avgRangePct: feature?.avgRangePct ?? null,
      upMinuteRatio: feature?.upMinuteRatio ?? null,
      sameBucketAsWeek: feature?.featureBucket === weeklyRow.featureBucket,
      comboPnl: trade.comboPnl,
      totalTrades: trade.totalTrades,
      totalStopLossTrades: trade.totalStopLossTrades,
      totalTakeProfitTrades: trade.totalTakeProfitTrades,
      totalHoldExitTrades: trade.totalHoldExitTrades,
      allStrategiesNegative: trade.allStrategiesNegative,
      anyStrategyPositive: trade.anyStrategyPositive,
      strategyRows: trade.strategyRows
    };
  });
}

function sumPnls(rows) {
  return round(rows.reduce((sum, row) => sum + (Number(row.comboPnl) || 0), 0), 2);
}

function classifyLossWeek(weeklyRow, dayRows) {
  const negativeDays = dayRows.filter((row) => row.comboPnl < 0);
  const positiveDays = dayRows.filter((row) => row.comboPnl > 0);
  const sortedLossDays = [...negativeDays].sort((left, right) => left.comboPnl - right.comboPnl);
  const worstDay = sortedLossDays[0] ?? null;
  const worstTwoLoss = round(sortedLossDays.slice(0, 2).reduce((sum, row) => sum + Math.abs(row.comboPnl), 0), 2);
  const weeklyLossAbs = Math.abs(weeklyRow.comboPnl);
  const worstDayShare = worstDay ? round(Math.abs(worstDay.comboPnl) / weeklyLossAbs, 4) : 0;
  const worstTwoShare = weeklyLossAbs > 0 ? round(worstTwoLoss / weeklyLossAbs, 4) : 0;
  const crossBucketDays = dayRows.filter((row) => row.featureBucket && row.featureBucket !== weeklyRow.featureBucket).length;
  const allNegativeLossDays = negativeDays.filter((row) => row.allStrategiesNegative).length;

  let primaryReason = 'normal-loss-drift';
  let reasonDetail = '亏损由多天分散积累，暂未出现单一主导型诱因。';

  if (weeklyRow.matchSource === 'nearest') {
    primaryReason = 'nearest-mismatch';
    reasonDetail = '这周没有 exact 命中，属于近邻特征迁移；周度路由本身就存在错配风险。';
  } else if (worstDay && worstDay.featureBucket && worstDay.featureBucket !== weeklyRow.featureBucket && worstDayShare >= 0.35) {
    primaryReason = 'intraweek-regime-shift';
    reasonDetail = '周标签掩盖了日级风格偏转，关键亏损日已经切到另一种日特征。';
  } else if (worstDay && worstDay.featureBucket === 'crash-trend' && worstDayShare >= 0.4) {
    primaryReason = 'single-day-crash';
    reasonDetail = '主要亏损来自单日急跌，属于单日崩跌拖累整周。';
  } else if (negativeDays.length >= 3 && crossBucketDays <= 1 && allNegativeLossDays >= 2) {
    primaryReason = 'strategy-cluster-failed';
    reasonDetail = '被选中的 3 条策略在同类日结构下同时失效，说明不是组合平均问题，而是整簇都不适配。';
  } else if (negativeDays.length >= 3 && positiveDays.length <= 2 && dayRows.every((row) => row.realizedVolPct === null || row.realizedVolPct < 2.5)) {
    primaryReason = 'low-vol-chop';
    reasonDetail = '整周偏低波震荡，信号容易被磨损，止盈不够、止损和时间出场在反复消耗。';
  } else if (negativeDays.some((row) => row.anyStrategyPositive) && negativeDays.length >= 2) {
    primaryReason = 'combo-composition';
    reasonDetail = '亏损日里并非所有子策略都失效，说明组合内有错配，平均持有拖累了更好的子策略。';
  }

  return {
    primaryReason,
    reasonDetail,
    worstDayShare,
    worstTwoShare,
    crossBucketDays,
    negativeDays: negativeDays.length,
    positiveDays: positiveDays.length,
    allNegativeLossDays
  };
}

function summarizeAnalyses(analyses) {
  const reasonMap = new Map();
  const bucketMap = new Map();
  const nearestLossWeeks = analyses.filter((entry) => entry.week.matchSource === 'nearest').length;

  for (const entry of analyses) {
    reasonMap.set(entry.classification.primaryReason, (reasonMap.get(entry.classification.primaryReason) ?? 0) + 1);
    bucketMap.set(entry.week.featureBucket, (bucketMap.get(entry.week.featureBucket) ?? 0) + 1);
  }

  const reasonCounts = Array.from(reasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
  const bucketCounts = Array.from(bucketMap.entries())
    .map(([featureBucket, count]) => ({ featureBucket, count }))
    .sort((left, right) => right.count - left.count || left.featureBucket.localeCompare(right.featureBucket));

  return {
    totalLossWeeks: analyses.length,
    nearestLossWeeks,
    exactLossWeeks: analyses.length - nearestLossWeeks,
    reasonCounts,
    bucketCounts
  };
}

function formatPct(value, digits = 2) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${Number(value).toFixed(digits)}%`;
}

function formatNum(value, digits = 2) {
  if (!Number.isFinite(value)) return 'n/a';
  return Number(value).toFixed(digits);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# ${report.symbol} Weekly Adaptive Loss Analysis`);
  lines.push('');
  lines.push(`- Source report: \`${report.sourceReport}\``);
  lines.push(`- Loss weeks analyzed: \`${report.summary.totalLossWeeks}\``);
  lines.push(`- Exact loss weeks: \`${report.summary.exactLossWeeks}\``);
  lines.push(`- Nearest loss weeks: \`${report.summary.nearestLossWeeks}\``);
  lines.push('');
  lines.push('## Loss Reason Mix');
  lines.push('');
  lines.push('| Reason | Count |');
  lines.push('| --- | ---: |');
  for (const row of report.summary.reasonCounts) {
    lines.push(`| ${row.reason} | ${row.count} |`);
  }
  lines.push('');
  lines.push('## Loss Bucket Mix');
  lines.push('');
  lines.push('| Weekly Feature Bucket | Count |');
  lines.push('| --- | ---: |');
  for (const row of report.summary.bucketCounts) {
    lines.push(`| ${row.featureBucket} | ${row.count} |`);
  }
  lines.push('');
  lines.push('## Worst Weeks');
  lines.push('');
  lines.push('| Week | Week PnL | Match | Weekly Bucket | Primary Reason | Worst Day Share | Worst Two Day Share |');
  lines.push('| --- | ---: | --- | --- | --- | ---: | ---: |');
  for (const entry of report.analyses.slice(0, 12)) {
    lines.push(`| ${entry.week.week} | ${entry.week.comboPnl} | ${entry.week.matchSource} | ${entry.week.featureBucket} | ${entry.classification.primaryReason} | ${formatPct(entry.classification.worstDayShare * 100)} | ${formatPct(entry.classification.worstTwoShare * 100)} |`);
  }
  lines.push('');

  for (const entry of report.analyses.slice(0, report.detailLimit)) {
    lines.push(`## ${entry.week.week}`);
    lines.push('');
    lines.push(`- Weekly PnL: \`${entry.week.comboPnl}\``);
    lines.push(`- Match: \`${entry.week.matchSource}\` / weekly feature \`${entry.week.featureKey}\``);
    lines.push(`- Reason: ${entry.classification.reasonDetail}`);
    lines.push(`- Cross-bucket days: \`${entry.classification.crossBucketDays}\` / negative days: \`${entry.classification.negativeDays}\` / positive days: \`${entry.classification.positiveDays}\``);
    lines.push('');
    lines.push('| Day | Day Bucket | Day Return % | Day RV % | Combo PnL | Trades | SL | TP | Hold | All 3 Negative |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const day of entry.dayRows) {
      lines.push(`| ${day.day} | ${day.featureBucket ?? '-'} | ${formatNum(day.dayReturnPct)} | ${formatNum(day.realizedVolPct)} | ${formatNum(day.comboPnl)} | ${day.totalTrades} | ${day.totalStopLossTrades} | ${day.totalTakeProfitTrades} | ${day.totalHoldExitTrades} | ${day.allStrategiesNegative ? 'yes' : 'no'} |`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function analyzeWeek(connection, symbol, weeklyRow) {
  const strategyNames = weeklyRow.comboStrategies.map((strategy) => strategy.strategyName);
  const range = getWeekRangeFromIsoWeekKey(weeklyRow.week);
  const createdAt = await findLatestTradeBatch(connection, strategyNames, symbol, range);
  if (!createdAt) {
    return {
      week: weeklyRow,
      createdAt: null,
      dayRows: [],
      classification: {
        primaryReason: 'missing-trades',
        reasonDetail: 'trades 表中没有找到对应周与策略的交易批次。',
        worstDayShare: 0,
        worstTwoShare: 0,
        crossBucketDays: 0,
        negativeDays: 0,
        positiveDays: 0,
        allNegativeLossDays: 0
      }
    };
  }

  const [trades, klines] = await Promise.all([
    loadTrades(connection, strategyNames, symbol, range, createdAt),
    loadKlines(connection, symbol, range)
  ]);

  const dailyFeatures = aggregateDailyFeatures(klines);
  const dailyTrades = aggregateDailyTrades(trades, strategyNames);
  const dayRows = buildDayRows(dailyFeatures, dailyTrades, weeklyRow);
  const classification = classifyLossWeek(weeklyRow, dayRows);

  return {
    week: weeklyRow,
    createdAt,
    dayRows,
    classification,
    totals: {
      dailyComboPnlSum: sumPnls(dayRows),
      totalTrades: dayRows.reduce((sum, row) => sum + row.totalTrades, 0)
    }
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const reportPath = path.resolve(required(args, 'report'));
  const detailLimit = Number(args.detailLimit || '8');
  const report = loadJson(reportPath);
  const symbol = String(report.symbol || 'BTCJPY').toUpperCase();
  const lossWeeks = [...report.forward.weeks]
    .filter((row) => Number(row.comboPnl) < 0)
    .sort((left, right) => left.comboPnl - right.comboPnl);

  ensureDir(REPORT_DIR);
  const connection = await connect();

  try {
    const analyses = [];
    for (const weeklyRow of lossWeeks) {
      console.log(`[loss-analysis] ${weeklyRow.week} ...`);
      analyses.push(await analyzeWeek(connection, symbol, weeklyRow));
    }

    const finalReport = {
      symbol,
      generatedAt: new Date().toISOString(),
      sourceReport: path.relative(path.resolve(__dirname, '..'), reportPath),
      detailLimit,
      summary: summarizeAnalyses(analyses),
      analyses
    };

    const prefix = `${symbol}_${path.basename(reportPath, path.extname(reportPath))}_loss_analysis`;
    const jsonPath = path.join(REPORT_DIR, `${prefix}.json`);
    const mdPath = path.join(REPORT_DIR, `${prefix}.md`);
    writeJson(jsonPath, finalReport);
    fs.writeFileSync(mdPath, renderMarkdown(finalReport), 'utf8');

    console.log(`Loss analysis JSON written: ${jsonPath}`);
    console.log(`Loss analysis MD written: ${mdPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[loss-analysis] failed: ${error.stack || error.message}`);
  process.exit(1);
});
