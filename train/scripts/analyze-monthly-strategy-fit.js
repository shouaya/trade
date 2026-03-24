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
const REPORT_DIR = path.resolve(__dirname, '../reports/monthly-strategy-fit');

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

function toJstMonthKey(timestampMs) {
  const date = new Date(timestampMs + JST_OFFSET_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
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
  const months = new Map();

  for (const row of klines) {
    const openTime = Number(row.open_time);
    const open = Number(row.open ?? row.bid_open ?? row.ask_open);
    const high = Number(row.high ?? row.bid_high ?? row.ask_high);
    const low = Number(row.low ?? row.bid_low ?? row.ask_low);
    const close = Number(row.close ?? row.bid_close ?? row.ask_close);
    if (![openTime, open, high, low, close].every(Number.isFinite) || open <= 0 || close <= 0) {
      continue;
    }

    const key = toJstMonthKey(openTime);
    let month = months.get(key);
    if (!month) {
      month = {
        month: key,
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
      months.set(key, month);
    }

    const logReturn = Math.log(close / open);
    const absReturnPct = Math.abs(logReturn) * 100;
    const rangePct = ((high - low) / open) * 100;

    month.count += 1;
    month.lastClose = close;
    month.sumSquaredLogReturns += logReturn * logReturn;
    month.sumAbsReturnPct += absReturnPct;
    month.sumRangePct += rangePct;
    month.maxAbsReturnPct = Math.max(month.maxAbsReturnPct, absReturnPct);
    month.maxRangePct = Math.max(month.maxRangePct, rangePct);
    if (close > open) {
      month.upMinutes += 1;
    }
  }

  return Array.from(months.values())
    .sort((left, right) => left.month.localeCompare(right.month))
    .map((month) => ({
      month: month.month,
      minutes: month.count,
      realizedVolPct: round(Math.sqrt(month.sumSquaredLogReturns) * 100, 2),
      avgAbsReturnPct: round(month.sumAbsReturnPct / month.count, 4),
      avgRangePct: round(month.sumRangePct / month.count, 4),
      maxAbsReturnPct: round(month.maxAbsReturnPct, 4),
      maxRangePct: round(month.maxRangePct, 4),
      monthReturnPct: round(((month.lastClose / month.firstOpen) - 1) * 100, 2),
      upMinuteRatio: round((month.upMinutes / month.count) * 100, 2),
      featureBucket: detectFeatureBucket({
        realizedVolPct: Math.sqrt(month.sumSquaredLogReturns) * 100,
        monthReturnPct: ((month.lastClose / month.firstOpen) - 1) * 100
      })
    }));
}

function aggregateTradeFeatures(trades, strategyMeta) {
  const monthly = new Map();

  for (const row of trades) {
    const month = toJstMonthKey(Number(row.exit_time));
    const strategyName = String(row.strategy_name);
    const pnl = Number(row.pnl);
    if (!monthly.has(month)) {
      monthly.set(month, new Map());
    }
    const byStrategy = monthly.get(month);
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

  const months = {};
  for (const [month, strategyMap] of monthly.entries()) {
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

    months[month] = {
      strategies,
      best: strategies[0],
      worst: strategies[strategies.length - 1],
      positiveCount,
      negativeCount,
      totalPnl: round(strategies.reduce((sum, entry) => sum + entry.pnl, 0), 2)
    };
  }

  return months;
}

function buildFeatureStrategyMap(monthlySummary, strategyMeta) {
  const strategyMap = new Map();

  for (const month of monthlySummary) {
    const best = month.bestStrategy;
    if (!best) continue;

    const key = best.strategyName;
    if (!strategyMap.has(key)) {
      strategyMap.set(key, {
        strategyName: key,
        shortLabel: best.shortLabel,
        parameters: strategyMeta[key].parameters,
        months: [],
        featureBuckets: new Set(),
        realizedVolPct: [],
        monthReturnPct: [],
        avgRangePct: []
      });
    }

    const entry = strategyMap.get(key);
    entry.months.push(month.month);
    entry.featureBuckets.add(month.featureBucket);
    entry.realizedVolPct.push(month.realizedVolPct);
    entry.monthReturnPct.push(month.monthReturnPct);
    entry.avgRangePct.push(month.avgRangePct);
  }

  return Array.from(strategyMap.values())
    .map((entry) => ({
      strategyName: entry.strategyName,
      shortLabel: entry.shortLabel,
      months: entry.months,
      featureBuckets: Array.from(entry.featureBuckets),
      avgRealizedVolPct: round(entry.realizedVolPct.reduce((sum, value) => sum + value, 0) / entry.realizedVolPct.length, 2),
      avgMonthReturnPct: round(entry.monthReturnPct.reduce((sum, value) => sum + value, 0) / entry.monthReturnPct.length, 2),
      avgRangePct: round(entry.avgRangePct.reduce((sum, value) => sum + value, 0) / entry.avgRangePct.length, 4),
      parameters: entry.parameters
    }))
    .sort((left, right) => right.months.length - left.months.length || left.strategyName.localeCompare(right.strategyName));
}

function createMonthlySummary(klineFeatures, monthlyTrades) {
  return klineFeatures.map((feature) => {
    const performance = monthlyTrades[feature.month] ?? null;
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
  const {
    symbol,
    year,
    createdAt,
    monthlySummary,
    featureStrategyMap
  } = context;

  const negativeMonths = monthlySummary.filter((month) => month.positiveStrategies === 0);
  const mixedMonths = monthlySummary.filter((month) => month.positiveStrategies > 0 && month.positiveStrategies < 10);
  const allPositiveMonths = monthlySummary.filter((month) => month.positiveStrategies === 10);
  const formatStrategyLabel = (strategy) => strategy ? strategy.shortLabel : '-';
  const formatStrategyPnl = (strategy) => strategy ? strategy.pnl : 0;
  const hasTrades = (month) => month.bestStrategy !== null;

  return `# ${symbol} ${year} 月度特征与策略适配报告

- 交易批次: \`${createdAt}\`
- 样本范围: \`${year}-01\` 到 \`${year}-12\`（JST 月份口径）
- 分析对象: \`2025 BTCJPY dual-year exact top10\`

## 结论摘要

- 这批策略不是“月月正”，而是依靠 \`1月 / 4月 / 9月 / 10月 / 11月\` 这些强月覆盖 \`3月 / 8月 / 12月\` 的系统性亏损。
- 负月份并不是单条策略失效，而是整组 \`top10\` 同时失效，这说明问题更像“当月市场 regime 不适配”，不是参数微调误差。
- \`11月\` 是最强顺风月，\`12月\` 是最强逆风月；两者的差别足以决定全年是否赚钱。
- 月度最优策略主要集中在两类:
  - 进攻型: \`OS30/OB72/H15/SL3.25\`
  - 防守型: \`OS28/OB72/H15/SL3.25\`
- 如果某个月特征接近 \`crash-trend\`，现有 top10 里没有稳定正收益策略，更合理的动作是降低仓位或停做，而不是强行切换到另一条同类参数。

## 月度总表

| 月份 | 特征桶 | 月收益率% | 实现波动率% | 平均振幅% | 正收益策略数 | 月度策略总PnL | 最佳策略 | 最佳PnL |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
${monthlySummary.map((month) => `| ${month.month} | ${month.featureBucket} | ${month.monthReturnPct} | ${month.realizedVolPct} | ${month.avgRangePct} | ${hasTrades(month) ? `${month.positiveStrategies}/10` : '0/0'} | ${month.totalStrategyPnl} | ${formatStrategyLabel(month.bestStrategy)} | ${formatStrategyPnl(month.bestStrategy)} |`).join('\n')}

## 为什么有些月份是负数

### 全组失效月份

${negativeMonths.map((month) => hasTrades(month)
  ? `- \`${month.month}\`: 10 条策略全部为负。
  - 市场特征: 月收益率 \`${month.monthReturnPct}%\`，实现波动率 \`${month.realizedVolPct}%\`，平均振幅 \`${month.avgRangePct}%\`
  - 最好策略也为负: \`${month.bestStrategy.shortLabel}\`，月PnL \`${month.bestStrategy.pnl}\`
  - 说明: 这是整个月的价格行为不适配这组夜间 RSI 均值回归参数，属于 regime 级别失配。`
  : `- \`${month.month}\`: 本月没有任何策略成交，当前时段过滤和信号条件一起把样本压空了。`
).join('\n')}

### 混合月份

${mixedMonths.map((month) => `- \`${month.month}\`: 有 \`${month.positiveStrategies}/10\` 条策略为正。
  - 市场特征: 月收益率 \`${month.monthReturnPct}%\`，实现波动率 \`${month.realizedVolPct}%\`
  - 最佳策略: \`${month.bestStrategy.shortLabel}\`，月PnL \`${month.bestStrategy.pnl}\`
  - 最差策略: \`${month.worstStrategy.shortLabel}\`，月PnL \`${month.worstStrategy.pnl}\`
  - 说明: 这类月份不是完全不能做，而是参数敏感度高，\`OS\` 和 \`ATR SL\` 的选择会直接决定盈亏。`).join('\n')}

## 每月最适合的策略

${monthlySummary.map((month) => `- \`${month.month}\`
  - 最佳策略: \`${formatStrategyLabel(month.bestStrategy)}\`
  - 当月PnL: \`${formatStrategyPnl(month.bestStrategy)}\`
  - 月特征: \`return=${month.monthReturnPct}%\`, \`realizedVol=${month.realizedVolPct}%\`, \`avgRange=${month.avgRangePct}%\`, \`upMinuteRatio=${month.upMinuteRatio}%\`
  - 解释: ${!hasTrades(month) ? '本月没有触发交易，说明该月夜间窗口内缺少这类 RSI 机会。' : month.bestStrategy.pnl <= 0 ? '现有 top10 在这个月份没有真正有效的正收益解，更像是应当减仓/停做的月份。' : '在当前 top10 候选里，这是对该月特征最适配的参数。'}
`).join('\n')}

## 特征对应策略列表

${featureStrategyMap.map((entry) => `- \`${entry.shortLabel}\`
  - 覆盖月份: \`${entry.months.join(', ')}\`
  - 典型特征: \`bucket=${entry.featureBuckets.join('/')}\`, \`avgRealizedVol=${entry.avgRealizedVolPct}%\`, \`avgMonthReturn=${entry.avgMonthReturnPct}%\`, \`avgRange=${entry.avgRangePct}%\`
  - 参数: \`OS${entry.parameters.rsi.oversold}/OB${entry.parameters.rsi.overbought}/H${entry.parameters.risk.maxHoldMinutes}/SL${entry.parameters.atr.slMultiplier}/TP${entry.parameters.atr.tpMultiplier}\`
`).join('\n')}

## 直接可用的月度策略规则

- \`strong-trend\` 且月收益明显为正:
  - 优先 \`OS30/OB72/H15/SL3.25\`
  - 代表月份: \`2024-01, 2024-04, 2024-10, 2024-11\`
- \`range-mid-vol\` 或轻趋势月份:
  - 优先 \`OS28/OB72/H15/SL3.25\`
  - 代表月份: \`2024-06, 2024-07\`
- \`mixed-trend\` 但仍能赚钱的月份:
  - 优先 \`OS29/OB72/H15/SL3.5\`
  - 代表月份: \`2024-05\`
- \`crash-trend\` 或全组失效月份:
  - 现有 top10 不建议强做
  - 代表月份: \`2024-03, 2024-08, 2024-12\`
  - 更合理动作: \`减仓 / 停做 / 切换独立的趋势型或防守型策略簇\`
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
  const strategyMeta = Object.fromEntries(
    strategies.map((strategy) => [strategy.strategyName, strategy])
  );

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

    const klineFeatures = aggregateKlineFeatures(klines);
    const monthlyTrades = aggregateTradeFeatures(trades, strategyMeta);
    const monthlySummary = createMonthlySummary(klineFeatures, monthlyTrades)
      .filter((month) => month.month.startsWith(`${year}-`));
    const featureStrategyMap = buildFeatureStrategyMap(monthlySummary, strategyMeta);

    const report = {
      symbol,
      year,
      createdAt,
      snapshot: path.relative(path.resolve(__dirname, '..'), snapshotPath),
      monthlySummary,
      featureStrategyMap
    };

    ensureDir(REPORT_DIR);
    const prefix = `${symbol}_${year}_monthly_strategy_fit`;
    const jsonPath = path.join(REPORT_DIR, `${prefix}.json`);
    const mdPath = path.join(REPORT_DIR, `${prefix}.md`);

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    fs.writeFileSync(mdPath, renderMarkdown(report), 'utf8');

    console.log(`Monthly fit JSON written: ${jsonPath}`);
    console.log(`Monthly fit report written: ${mdPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
