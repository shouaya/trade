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
const REPORT_DIR = path.resolve(__dirname, '../reports/daily-strategy-fit');

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

function getJstDayKey(timestampMs) {
  const date = toJstDate(timestampMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
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

function detectDailyFeatureBucket(feature) {
  if (feature.dayReturnPct <= -2.5 && feature.realizedVolPct >= 2.5) {
    return 'crash-trend';
  }
  if (feature.dayReturnPct >= 2.5 && feature.realizedVolPct >= 2.5) {
    return 'strong-trend';
  }
  if (Math.abs(feature.dayReturnPct) <= 0.8 && feature.realizedVolPct < 2.2) {
    return 'range-low-vol';
  }
  if (Math.abs(feature.dayReturnPct) <= 1.5) {
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
  const days = new Map();

  for (const row of klines) {
    const openTime = Number(row.open_time);
    const open = Number(row.open ?? row.bid_open ?? row.ask_open);
    const high = Number(row.high ?? row.bid_high ?? row.ask_high);
    const low = Number(row.low ?? row.bid_low ?? row.ask_low);
    const close = Number(row.close ?? row.bid_close ?? row.ask_close);
    if (![openTime, open, high, low, close].every(Number.isFinite) || open <= 0 || close <= 0) {
      continue;
    }

    const key = getJstDayKey(openTime);
    let day = days.get(key);
    if (!day) {
      day = {
        day: key,
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
      days.set(key, day);
    }

    const logReturn = Math.log(close / open);
    const absReturnPct = Math.abs(logReturn) * 100;
    const rangePct = ((high - low) / open) * 100;

    day.count += 1;
    day.lastClose = close;
    day.sumSquaredLogReturns += logReturn * logReturn;
    day.sumAbsReturnPct += absReturnPct;
    day.sumRangePct += rangePct;
    day.maxAbsReturnPct = Math.max(day.maxAbsReturnPct, absReturnPct);
    day.maxRangePct = Math.max(day.maxRangePct, rangePct);
    if (close > open) {
      day.upMinutes += 1;
    }
  }

  return Array.from(days.values())
    .sort((left, right) => left.day.localeCompare(right.day))
    .map((day) => ({
      day: day.day,
      minutes: day.count,
      realizedVolPct: round(Math.sqrt(day.sumSquaredLogReturns) * 100, 2),
      avgAbsReturnPct: round(day.sumAbsReturnPct / day.count, 4),
      avgRangePct: round(day.sumRangePct / day.count, 4),
      maxAbsReturnPct: round(day.maxAbsReturnPct, 4),
      maxRangePct: round(day.maxRangePct, 4),
      dayReturnPct: round(((day.lastClose / day.firstOpen) - 1) * 100, 2),
      upMinuteRatio: round((day.upMinutes / day.count) * 100, 2),
      featureBucket: detectDailyFeatureBucket({
        realizedVolPct: Math.sqrt(day.sumSquaredLogReturns) * 100,
        dayReturnPct: ((day.lastClose / day.firstOpen) - 1) * 100
      })
    }));
}

function aggregateTradeFeatures(trades, strategyMeta) {
  const daily = new Map();

  for (const row of trades) {
    const day = getJstDayKey(Number(row.exit_time));
    const strategyName = String(row.strategy_name);
    const pnl = Number(row.pnl);
    if (!daily.has(day)) {
      daily.set(day, new Map());
    }
    const byStrategy = daily.get(day);
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

  const days = {};
  for (const [day, strategyMap] of daily.entries()) {
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

    days[day] = {
      strategies,
      best: strategies[0],
      worst: strategies[strategies.length - 1],
      positiveCount,
      negativeCount,
      totalPnl: round(strategies.reduce((sum, entry) => sum + entry.pnl, 0), 2)
    };
  }

  return days;
}

function buildFeatureStrategyMap(dailySummary, strategyMeta) {
  const strategyMap = new Map();

  for (const day of dailySummary) {
    const best = day.bestStrategy;
    if (!best) continue;

    const key = best.strategyName;
    if (!strategyMap.has(key)) {
      strategyMap.set(key, {
        strategyName: key,
        shortLabel: best.shortLabel,
        parameters: strategyMeta[key].parameters,
        days: [],
        featureBuckets: new Set(),
        realizedVolPct: [],
        dayReturnPct: [],
        avgRangePct: []
      });
    }

    const entry = strategyMap.get(key);
    entry.days.push(day.day);
    entry.featureBuckets.add(day.featureBucket);
    entry.realizedVolPct.push(day.realizedVolPct);
    entry.dayReturnPct.push(day.dayReturnPct);
    entry.avgRangePct.push(day.avgRangePct);
  }

  return Array.from(strategyMap.values())
    .map((entry) => ({
      strategyName: entry.strategyName,
      shortLabel: entry.shortLabel,
      days: entry.days,
      featureBuckets: Array.from(entry.featureBuckets),
      avgRealizedVolPct: round(entry.realizedVolPct.reduce((sum, value) => sum + value, 0) / entry.realizedVolPct.length, 2),
      avgDayReturnPct: round(entry.dayReturnPct.reduce((sum, value) => sum + value, 0) / entry.dayReturnPct.length, 2),
      avgRangePct: round(entry.avgRangePct.reduce((sum, value) => sum + value, 0) / entry.avgRangePct.length, 4),
      parameters: entry.parameters
    }))
    .sort((left, right) => right.days.length - left.days.length || left.strategyName.localeCompare(right.strategyName));
}

function createDailySummary(klineFeatures, dailyTrades) {
  return klineFeatures.map((feature) => {
    const performance = dailyTrades[feature.day] ?? null;
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
  const { symbol, year, createdAt, dailySummary, featureStrategyMap } = context;
  const negativeDays = dailySummary.filter((day) => day.positiveStrategies === 0 && day.bestStrategy);
  const mixedDays = dailySummary.filter((day) => day.positiveStrategies > 0 && day.positiveStrategies < 10);
  const formatStrategyLabel = (strategy) => strategy ? strategy.shortLabel : '-';
  const formatStrategyPnl = (strategy) => strategy ? strategy.pnl : 0;

  return `# ${symbol} ${year} 日度特征与策略适配报告

- 交易批次: \`${createdAt}\`
- 样本范围: \`${year}\` 全年（JST 日口径）
- 分析对象: \`2025 BTCJPY dual-year exact top10\`

## 结论摘要

- 日度比周度更能看到“哪些亏损周是由哪几天拖累”的结构。
- 当天出现 \`高日波动 + 大幅单边\` 时，这组夜间 RSI 均值回归策略更容易集体失配。
- 当前 top10 的日度适配核心仍集中在三类:
  - 进攻型: \`OS30/OB72/H15/SL3.25\`
  - 防守型: \`OS28/OB72/H15/SL3.25\`
  - 过渡型: \`OS29/OB72/H15/SL3.5\`

## 日度总表

| 日期 | 特征桶 | 日收益率% | 实现波动率% | 平均振幅% | 正收益策略数 | 日度策略总PnL | 最佳策略 | 最佳PnL |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
${dailySummary.map((day) => `| ${day.day} | ${day.featureBucket} | ${day.dayReturnPct} | ${day.realizedVolPct} | ${day.avgRangePct} | ${day.bestStrategy ? `${day.positiveStrategies}/10` : '0/0'} | ${day.totalStrategyPnl} | ${formatStrategyLabel(day.bestStrategy)} | ${formatStrategyPnl(day.bestStrategy)} |`).join('\n')}

## 全组失效日

${negativeDays.map((day) => `- \`${day.day}\`
  - 日收益率 \`${day.dayReturnPct}%\`，实现波动率 \`${day.realizedVolPct}%\`，平均振幅 \`${day.avgRangePct}%\`
  - 最优策略也为负: \`${day.bestStrategy.shortLabel}\`，日PnL \`${day.bestStrategy.pnl}\`
  - 说明: 这是日级别 regime 失配，更适合减仓或停做。`).join('\n')}

## 分化日

${mixedDays.map((day) => `- \`${day.day}\`
  - \`${day.positiveStrategies}/10\` 条策略为正
  - 最佳策略: \`${day.bestStrategy.shortLabel}\`，日PnL \`${day.bestStrategy.pnl}\`
  - 最差策略: \`${day.worstStrategy.shortLabel}\`，日PnL \`${day.worstStrategy.pnl}\`
`).join('\n')}

## 每日最适合的策略

${dailySummary.map((day) => `- \`${day.day}\`
  - 最佳策略: \`${formatStrategyLabel(day.bestStrategy)}\`
  - 当日PnL: \`${formatStrategyPnl(day.bestStrategy)}\`
  - 日特征: \`return=${day.dayReturnPct}%\`, \`realizedVol=${day.realizedVolPct}%\`, \`avgRange=${day.avgRangePct}%\`, \`upMinuteRatio=${day.upMinuteRatio}%\`
`).join('\n')}

## 特征对应策略列表

${featureStrategyMap.map((entry) => `- \`${entry.shortLabel}\`
  - 覆盖日: \`${entry.days.join(', ')}\`
  - 典型特征: \`bucket=${entry.featureBuckets.join('/')}\`, \`avgRealizedVol=${entry.avgRealizedVolPct}%\`, \`avgDayReturn=${entry.avgDayReturnPct}%\`, \`avgRange=${entry.avgRangePct}%\`
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

    const dailyFeatures = aggregateKlineFeatures(klines);
    const dailyTrades = aggregateTradeFeatures(trades, strategyMeta);
    const dailySummary = createDailySummary(dailyFeatures, dailyTrades)
      .filter((day) => day.day.startsWith(`${year}-`));
    const featureStrategyMap = buildFeatureStrategyMap(dailySummary, strategyMeta);

    const report = {
      symbol,
      year,
      createdAt,
      snapshot: path.relative(path.resolve(__dirname, '..'), snapshotPath),
      dailySummary,
      featureStrategyMap
    };

    ensureDir(REPORT_DIR);
    const prefix = `${symbol}_${year}_daily_strategy_fit`;
    const jsonPath = path.join(REPORT_DIR, `${prefix}.json`);
    const mdPath = path.join(REPORT_DIR, `${prefix}.md`);

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    fs.writeFileSync(mdPath, renderMarkdown(report), 'utf8');

    console.log(`Daily fit JSON written: ${jsonPath}`);
    console.log(`Daily fit report written: ${mdPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
