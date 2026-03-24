#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { createMysqlConnectionWithFallback, loadEnvFiles } = require('@money/database');

loadEnvFiles(dotenv, [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../backend/.env'),
  path.resolve(__dirname, '../../.env')
]);

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const REPORT_DIR = path.resolve(__dirname, '../reports/weekly-strategy-fit');

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

function toJstDate(timestampMs) {
  return new Date(timestampMs + JST_OFFSET_MS);
}

function getIsoWeekKey(timestampMs) {
  const date = toJstDate(timestampMs);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function strategyShortLabel(parameters) {
  return `OS${parameters.rsi.oversold}/OB${parameters.rsi.overbought}/H${parameters.risk.maxHoldMinutes}/SL${parameters.atr.slMultiplier}/TP${parameters.atr.tpMultiplier}`;
}

function getYearRange(year) {
  const startTimeMs = Date.UTC(year, 0, 1, 0, 0, 0, 0);
  const endTimeMs = Date.UTC(year, 11, 31, 23, 59, 0, 0);
  return { startTimeMs, endTimeMs };
}

function detectWeeklyFeatureBucket(feature) {
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

async function connect() {
  return createMysqlConnectionWithFallback(mysql, {
    defaults: {
      host: '127.0.0.1'
    }
  });
}

async function findTradeBatch(connection, strategyNames, symbol, range) {
  const placeholders = strategyNames.map(() => '?').join(', ');
  const [rows] = await connection.query(
    `SELECT DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i:%s') AS created_at
     FROM trades
     WHERE strategy_name IN (${placeholders})
       AND symbol = ?
       AND exit_time BETWEEN ? AND ?`,
    [...strategyNames, symbol, range.startTimeMs, range.endTimeMs]
  );
  const createdAt = rows[0]?.created_at;
  if (!createdAt) {
    throw new Error('could not detect trade batch from trades table');
  }
  return String(createdAt);
}

async function loadTrades(connection, strategyNames, symbol, range, createdAt) {
  const placeholders = strategyNames.map(() => '?').join(', ');
  const [rows] = await connection.query(
    `SELECT strategy_name, exit_time, pnl
     FROM trades
     WHERE created_at = ?
       AND strategy_name IN (${placeholders})
       AND symbol = ?
       AND exit_time BETWEEN ? AND ?
     ORDER BY exit_time ASC, strategy_name ASC`,
    [createdAt, ...strategyNames, symbol, range.startTimeMs, range.endTimeMs]
  );
  return rows;
}

async function loadKlines(connection, symbol, range) {
  const [rows] = await connection.query(
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
  return rows;
}

function aggregateKlineFeatures(klines) {
  const weeks = new Map();

  for (const row of klines) {
    const openTime = Number(row.open_time);
    const open = Number(row.open ?? row.bid_open ?? row.ask_open);
    const high = Number(row.high ?? row.bid_high ?? row.ask_high);
    const low = Number(row.low ?? row.bid_low ?? row.ask_low);
    const close = Number(row.close ?? row.bid_close ?? row.ask_close);
    if (![openTime, open, high, low, close].every(Number.isFinite) || open <= 0 || close <= 0) {
      continue;
    }

    const key = getIsoWeekKey(openTime);
    let week = weeks.get(key);
    if (!week) {
      week = {
        week: key,
        count: 0,
        firstOpen: open,
        lastClose: close,
        sumSquaredLogReturns: 0,
        sumAbsReturnPct: 0,
        sumRangePct: 0,
        maxAbsReturnPct: 0,
        maxRangePct: 0,
        upMinutes: 0
      };
      weeks.set(key, week);
    }

    const logReturn = Math.log(close / open);
    const absReturnPct = Math.abs(logReturn) * 100;
    const rangePct = ((high - low) / open) * 100;

    week.count += 1;
    week.lastClose = close;
    week.sumSquaredLogReturns += logReturn * logReturn;
    week.sumAbsReturnPct += absReturnPct;
    week.sumRangePct += rangePct;
    week.maxAbsReturnPct = Math.max(week.maxAbsReturnPct, absReturnPct);
    week.maxRangePct = Math.max(week.maxRangePct, rangePct);
    if (close > open) {
      week.upMinutes += 1;
    }
  }

  return Array.from(weeks.values())
    .sort((left, right) => left.week.localeCompare(right.week))
    .map((week) => ({
      week: week.week,
      minutes: week.count,
      realizedVolPct: round(Math.sqrt(week.sumSquaredLogReturns) * 100, 2),
      avgAbsReturnPct: round(week.sumAbsReturnPct / week.count, 4),
      avgRangePct: round(week.sumRangePct / week.count, 4),
      maxAbsReturnPct: round(week.maxAbsReturnPct, 4),
      maxRangePct: round(week.maxRangePct, 4),
      periodReturnPct: round(((week.lastClose / week.firstOpen) - 1) * 100, 2),
      upMinuteRatio: round((week.upMinutes / week.count) * 100, 2),
      featureBucket: detectWeeklyFeatureBucket({
        realizedVolPct: Math.sqrt(week.sumSquaredLogReturns) * 100,
        periodReturnPct: ((week.lastClose / week.firstOpen) - 1) * 100
      })
    }));
}

function aggregateTradeFeatures(trades, strategyMeta) {
  const weekly = new Map();

  for (const row of trades) {
    const week = getIsoWeekKey(Number(row.exit_time));
    const strategyName = String(row.strategy_name);
    const pnl = Number(row.pnl);
    if (!weekly.has(week)) {
      weekly.set(week, new Map());
    }
    const byStrategy = weekly.get(week);
    let entry = byStrategy.get(strategyName);
    if (!entry) {
      entry = {
        strategyName,
        shortLabel: strategyShortLabel(strategyMeta[strategyName].parameters),
        pnl: 0,
        trades: 0,
        wins: 0
      };
      byStrategy.set(strategyName, entry);
    }
    entry.pnl += pnl;
    entry.trades += 1;
    if (pnl > 0) {
      entry.wins += 1;
    }
  }

  const weeks = {};
  for (const [week, strategyMap] of weekly.entries()) {
    const strategies = Array.from(strategyMap.values())
      .map((entry) => ({
        strategyName: entry.strategyName,
        shortLabel: entry.shortLabel,
        pnl: round(entry.pnl, 2),
        trades: entry.trades,
        winRate: round((entry.wins / entry.trades) * 100, 2)
      }))
      .sort((left, right) => right.pnl - left.pnl || left.strategyName.localeCompare(right.strategyName));

    const positiveCount = strategies.filter((entry) => entry.pnl > 0).length;
    const negativeCount = strategies.length - positiveCount;

    weeks[week] = {
      strategies,
      best: strategies[0],
      worst: strategies[strategies.length - 1],
      positiveCount,
      negativeCount,
      totalPnl: round(strategies.reduce((sum, entry) => sum + entry.pnl, 0), 2)
    };
  }

  return weeks;
}

function buildFeatureStrategyMap(weeklySummary, strategyMeta) {
  const strategyMap = new Map();

  for (const week of weeklySummary) {
    const best = week.bestStrategy;
    if (!best) continue;

    const key = best.strategyName;
    if (!strategyMap.has(key)) {
      strategyMap.set(key, {
        strategyName: key,
        shortLabel: best.shortLabel,
        parameters: strategyMeta[key].parameters,
        weeks: [],
        featureBuckets: new Set(),
        realizedVolPct: [],
        periodReturnPct: [],
        avgRangePct: []
      });
    }

    const entry = strategyMap.get(key);
    entry.weeks.push(week.week);
    entry.featureBuckets.add(week.featureBucket);
    entry.realizedVolPct.push(week.realizedVolPct);
    entry.periodReturnPct.push(week.periodReturnPct);
    entry.avgRangePct.push(week.avgRangePct);
  }

  return Array.from(strategyMap.values())
    .map((entry) => ({
      strategyName: entry.strategyName,
      shortLabel: entry.shortLabel,
      weeks: entry.weeks,
      featureBuckets: Array.from(entry.featureBuckets),
      avgRealizedVolPct: round(entry.realizedVolPct.reduce((sum, value) => sum + value, 0) / entry.realizedVolPct.length, 2),
      avgPeriodReturnPct: round(entry.periodReturnPct.reduce((sum, value) => sum + value, 0) / entry.periodReturnPct.length, 2),
      avgRangePct: round(entry.avgRangePct.reduce((sum, value) => sum + value, 0) / entry.avgRangePct.length, 4),
      parameters: entry.parameters
    }))
    .sort((left, right) => right.weeks.length - left.weeks.length || left.strategyName.localeCompare(right.strategyName));
}

function createWeeklySummary(klineFeatures, weeklyTrades) {
  return klineFeatures.map((feature) => {
    const performance = weeklyTrades[feature.week] ?? null;
    return {
      ...feature,
      positiveStrategies: performance?.positiveCount ?? 0,
      negativeStrategies: performance?.negativeCount ?? 0,
      totalStrategyPnl: performance?.totalPnl ?? 0,
      bestStrategy: performance?.best ?? null,
      worstStrategy: performance?.worst ?? null
    };
  });
}

function renderMarkdown(context) {
  const { symbol, year, createdAt, weeklySummary, featureStrategyMap } = context;
  const negativeWeeks = weeklySummary.filter((week) => week.positiveStrategies === 0 && week.bestStrategy);
  const mixedWeeks = weeklySummary.filter((week) => week.positiveStrategies > 0 && week.positiveStrategies < 10);
  const formatStrategyLabel = (strategy) => strategy ? strategy.shortLabel : '-';
  const formatStrategyPnl = (strategy) => strategy ? strategy.pnl : 0;

  return `# ${symbol} ${year} 周度特征与策略适配报告

- 交易批次: \`${createdAt}\`
- 样本范围: \`${year}\` 全年（JST ISO 周口径）
- 分析对象: \`2025 BTCJPY dual-year exact top10\`

## 结论摘要

- 周度比月度更能看到 regime 切换，很多亏损不是整月持续失效，而是少数几周的连续失配造成的。
- 这批策略的周度适配主要集中在三类:
  - 进攻型: \`OS30/OB72/H15/SL3.25\`
  - 防守型: \`OS28/OB72/H15/SL3.25\`
  - 过渡型: \`OS29/OB72/H15/SL3.5\`
- 当周出现 \`高波动 + 大幅单边\` 时，现有 top10 常常会集体恶化，这时更合理的是降仓或停做。

## 周度总表

| 周 | 特征桶 | 周收益率% | 实现波动率% | 平均振幅% | 正收益策略数 | 周度策略总PnL | 最佳策略 | 最佳PnL |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
${weeklySummary.map((week) => `| ${week.week} | ${week.featureBucket} | ${week.periodReturnPct} | ${week.realizedVolPct} | ${week.avgRangePct} | ${week.bestStrategy ? `${week.positiveStrategies}/10` : '0/0'} | ${week.totalStrategyPnl} | ${formatStrategyLabel(week.bestStrategy)} | ${formatStrategyPnl(week.bestStrategy)} |`).join('\n')}

## 全组失效周

${negativeWeeks.map((week) => `- \`${week.week}\`
  - 周收益率 \`${week.periodReturnPct}%\`，实现波动率 \`${week.realizedVolPct}%\`，平均振幅 \`${week.avgRangePct}%\`
  - 最优策略也为负: \`${week.bestStrategy.shortLabel}\`，周PnL \`${week.bestStrategy.pnl}\`
  - 说明: 这是典型的周级别 regime 失配，应优先考虑停做或切趋势型簇。`).join('\n')}

## 分化周

${mixedWeeks.map((week) => `- \`${week.week}\`
  - \`${week.positiveStrategies}/10\` 条策略为正
  - 最佳策略: \`${week.bestStrategy.shortLabel}\`，周PnL \`${week.bestStrategy.pnl}\`
  - 最差策略: \`${week.worstStrategy.shortLabel}\`，周PnL \`${week.worstStrategy.pnl}\`
  - 说明: 这类周适合按特征切换更细的参数。`).join('\n')}

## 每周最适合的策略

${weeklySummary.map((week) => `- \`${week.week}\`
  - 最佳策略: \`${formatStrategyLabel(week.bestStrategy)}\`
  - 当周PnL: \`${formatStrategyPnl(week.bestStrategy)}\`
  - 周特征: \`return=${week.periodReturnPct}%\`, \`realizedVol=${week.realizedVolPct}%\`, \`avgRange=${week.avgRangePct}%\`, \`upMinuteRatio=${week.upMinuteRatio}%\`
`).join('\n')}

## 特征对应策略列表

${featureStrategyMap.map((entry) => `- \`${entry.shortLabel}\`
  - 覆盖周: \`${entry.weeks.join(', ')}\`
  - 典型特征: \`bucket=${entry.featureBuckets.join('/')}\`, \`avgRealizedVol=${entry.avgRealizedVolPct}%\`, \`avgWeekReturn=${entry.avgPeriodReturnPct}%\`, \`avgRange=${entry.avgRangePct}%\`
`).join('\n')}
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const symbol = required(args, 'symbol').toUpperCase();
  const year = Number(required(args, 'year'));
  const snapshotPath = path.resolve(required(args, 'snapshot'));
  const range = getYearRange(year);
  const snapshot = loadJson(snapshotPath);
  const strategies = snapshot.strategies ?? [];
  const strategyNames = strategies.map((strategy) => strategy.strategyName);
  const strategyMeta = Object.fromEntries(strategies.map((strategy) => [strategy.strategyName, strategy]));

  if (!strategyNames.length) {
    throw new Error('snapshot has no strategies');
  }

  const connection = await connect();
  try {
    const createdAt = args.tradeCreatedAt || await findTradeBatch(connection, strategyNames, symbol, range);
    const [trades, klines] = await Promise.all([
      loadTrades(connection, strategyNames, symbol, range, createdAt),
      loadKlines(connection, symbol, range)
    ]);

    const weeklyFeatures = aggregateKlineFeatures(klines);
    const weeklyTrades = aggregateTradeFeatures(trades, strategyMeta);
    const weeklySummary = createWeeklySummary(weeklyFeatures, weeklyTrades)
      .filter((week) => week.week.startsWith(String(year)));
    const featureStrategyMap = buildFeatureStrategyMap(weeklySummary, strategyMeta);

    const report = {
      symbol,
      year,
      createdAt,
      snapshot: path.relative(path.resolve(__dirname, '..'), snapshotPath),
      weeklySummary,
      featureStrategyMap
    };

    ensureDir(REPORT_DIR);
    const prefix = `${symbol}_${year}_weekly_strategy_fit`;
    const jsonPath = path.join(REPORT_DIR, `${prefix}.json`);
    const mdPath = path.join(REPORT_DIR, `${prefix}.md`);

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    fs.writeFileSync(mdPath, renderMarkdown(report), 'utf8');

    console.log(`Weekly fit JSON written: ${jsonPath}`);
    console.log(`Weekly fit report written: ${mdPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
