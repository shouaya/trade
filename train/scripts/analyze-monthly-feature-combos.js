#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });
dotenv.config();

const ROOT_DIR = path.resolve(__dirname, '..');
const GENERATED_DIR = path.join(ROOT_DIR, 'configs', 'generated', 'monthly-feature-combos');
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'monthly-feature-combos');
const BACKTEST_RESULTS_TABLE = 'backtest_results';
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

function buildTimeRange(startDate, endDate) {
  return {
    startTimeMs: startDate.getTime(),
    endTimeMs: endDate.getTime(),
    startIso: `${toIsoDate(startDate)}T00:00:00.000Z`,
    endIso: `${toIsoDate(endDate)}T23:59:00.000Z`
  };
}

function toJstMonthKey(timestampMs) {
  const date = new Date(timestampMs + JST_OFFSET_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function toJstDayKey(timestampMs) {
  const date = new Date(timestampMs + JST_OFFSET_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function createFeatureBucket(feature) {
  if (feature.monthReturnPct <= -8 && feature.realizedVolPct >= 9) return 'crash-trend';
  if (feature.monthReturnPct >= 8 && feature.realizedVolPct >= 9) return 'strong-trend';
  if (Math.abs(feature.monthReturnPct) <= 3 && feature.realizedVolPct < 8) return 'range-low-vol';
  if (Math.abs(feature.monthReturnPct) <= 6) return 'range-mid-vol';
  return 'mixed-trend';
}

function detectVolBand(realizedVolPct) {
  if (realizedVolPct >= 18) return 'extreme';
  if (realizedVolPct >= 12) return 'high';
  if (realizedVolPct >= 7) return 'mid';
  return 'low';
}

function detectRangeBand(avgRangePct) {
  if (avgRangePct >= 0.1) return 'wide';
  if (avgRangePct >= 0.06) return 'normal';
  return 'tight';
}

function detectBiasBand(monthReturnPct) {
  if (monthReturnPct >= 8) return 'up-strong';
  if (monthReturnPct >= 2) return 'up';
  if (monthReturnPct <= -8) return 'down-strong';
  if (monthReturnPct <= -2) return 'down';
  return 'flat';
}

function detectUpMinuteBand(upMinuteRatio) {
  if (upMinuteRatio >= 54) return 'bullish';
  if (upMinuteRatio <= 46) return 'bearish';
  return 'balanced';
}

function buildFeatureKey(feature) {
  return [
    feature.featureBucket,
    `vol:${detectVolBand(feature.realizedVolPct)}`,
    `range:${detectRangeBand(feature.avgRangePct)}`,
    `bias:${detectBiasBand(feature.monthReturnPct)}`,
    `up:${detectUpMinuteBand(feature.upMinuteRatio)}`
  ].join('|');
}

function normalizeMinMax(values) {
  const numericValues = values.filter((value) => Number.isFinite(value));
  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  return values.map((value) => {
    if (!Number.isFinite(value)) return 0;
    if (max === min) return 1;
    return (value - min) / (max - min);
  });
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

function shortLabel(parameters) {
  const rsi = parameters.rsi ?? {};
  const macd = parameters.macd ?? {};
  const risk = parameters.risk ?? {};
  const atr = parameters.atr ?? {};
  return `RP${rsi.period}/OS${rsi.oversold}/OB${rsi.overbought}/MF${macd.fastPeriod}/MS${macd.slowPeriod}/MSG${macd.signalPeriod}/H${risk.maxHoldMinutes}/SL${atr.slMultiplier}/TP${atr.tpMultiplier}`;
}

function strategyToExplicit(strategy) {
  return {
    name: strategy.strategyName,
    type: strategy.strategyType,
    parameters: strategy.parameters
  };
}

function monthLabel(month) {
  return month.replace('-', '_');
}

function buildMonthTrainingConfig(template, month, range, resultGroup) {
  const label = monthLabel(month);
  return {
    ...template,
    name: `${template.name}_${label}`,
    description: `${template.description} | monthly feature combo train ${month}`,
    timeRange: range,
    database: {
      tableName: resultGroup,
      resetTableBeforeRun: true
    },
    regimeRouting: undefined,
    output: {
      ...(template.output ?? {}),
      topN: Number(template.output?.topN ?? 10)
    }
  };
}

function buildValidationConfig(template, name, description, range, resultGroup, explicitStrategies) {
  return {
    name,
    description,
    timeRange: range,
    market: template.market,
    database: {
      tableName: resultGroup,
      resetTableBeforeRun: true
    },
    strategy: {
      explicitStrategies: explicitStrategies.map(strategyToExplicit)
    },
    executor: template.executor,
    regimeRouting: undefined,
    output: {
      topN: explicitStrategies.length,
      persistTopStrategies: false,
      persistTrades: true
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

async function findLatestRunId(connection, resultGroup) {
  const rows = await queryRows(
    connection,
    `SELECT run_id
     FROM ${BACKTEST_RESULTS_TABLE}
     WHERE result_group = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [resultGroup]
  );
  return rows[0]?.run_id ? String(rows[0].run_id) : null;
}

async function loadResultRows(connection, resultGroup, runId, limit) {
  const rows = await queryRows(
    connection,
    `SELECT
       strategy_name,
       strategy_type,
       total_trades,
       win_rate,
       total_pnl,
       return_pct,
       profit_factor,
       sharpe_ratio,
       max_drawdown,
       max_drawdown_pct,
       score,
       parameters
     FROM ${BACKTEST_RESULTS_TABLE}
     WHERE result_group = ?
       AND run_id = ?
       AND total_trades > 0
     ORDER BY total_pnl DESC, return_pct DESC, profit_factor DESC, win_rate DESC, strategy_name ASC
     LIMIT ?`,
    [resultGroup, runId, limit]
  );

  return rows.map((row) => {
    const parameters = typeof row.parameters === 'string' ? JSON.parse(row.parameters) : row.parameters;
    return {
      strategyName: String(row.strategy_name),
      strategyType: String(row.strategy_type),
      totalTrades: Number(row.total_trades),
      winRate: Number(row.win_rate),
      winRatePct: round(Number(row.win_rate) * 100, 2),
      totalPnl: round(Number(row.total_pnl), 2),
      returnPct: round(Number(row.return_pct), 4),
      profitFactor: round(Number(row.profit_factor), 4),
      sharpeRatio: round(Number(row.sharpe_ratio), 4),
      maxDrawdown: round(Number(row.max_drawdown), 2),
      maxDrawdownPct: round(Number(row.max_drawdown_pct), 4),
      legacyScore: round(Number(row.score), 4),
      parameters,
      shortLabel: shortLabel(parameters)
    };
  });
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

function computeMonthFeatures(klines, month) {
  let firstOpen = null;
  let lastClose = null;
  let count = 0;
  let sumSquaredLogReturns = 0;
  let sumAbsReturnPct = 0;
  let sumRangePct = 0;
  let maxAbsReturnPct = 0;
  let maxRangePct = 0;
  let upMinutes = 0;

  for (const row of klines) {
    const open = choosePrice(row, 'open');
    const high = choosePrice(row, 'high');
    const low = choosePrice(row, 'low');
    const close = choosePrice(row, 'close');
    if (![open, high, low, close].every(Number.isFinite) || open <= 0 || close <= 0) {
      continue;
    }

    if (firstOpen === null) {
      firstOpen = open;
    }
    lastClose = close;
    count += 1;

    const logReturn = Math.log(close / open);
    const absReturnPct = Math.abs(logReturn) * 100;
    const rangePct = ((high - low) / open) * 100;

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

  const feature = {
    month,
    minutes: count,
    realizedVolPct: round(Math.sqrt(sumSquaredLogReturns) * 100, 2),
    avgAbsReturnPct: round(sumAbsReturnPct / count, 4),
    avgRangePct: round(sumRangePct / count, 4),
    maxAbsReturnPct: round(maxAbsReturnPct, 4),
    maxRangePct: round(maxRangePct, 4),
    monthReturnPct: round(((lastClose / firstOpen) - 1) * 100, 2),
    upMinuteRatio: round((upMinutes / count) * 100, 2)
  };

  return {
    ...feature,
    featureBucket: createFeatureBucket(feature),
    featureKey: buildFeatureKey({
      ...feature,
      featureBucket: createFeatureBucket(feature)
    })
  };
}

function combinations(items, size) {
  const result = [];

  function helper(startIndex, current) {
    if (current.length === size) {
      result.push([...current]);
      return;
    }

    for (let index = startIndex; index <= items.length - (size - current.length); index += 1) {
      current.push(items[index]);
      helper(index + 1, current);
      current.pop();
    }
  }

  helper(0, []);
  return result;
}

function scoreCombos(rawCombos, weights) {
  const pnlScores = normalizeMinMax(rawCombos.map((combo) => combo.avgTotalPnl));
  const returnScores = normalizeMinMax(rawCombos.map((combo) => combo.avgReturnPct));
  const profitFactorScores = normalizeMinMax(rawCombos.map((combo) => combo.avgProfitFactor));
  const winRateScores = normalizeMinMax(rawCombos.map((combo) => combo.avgWinRatePct));
  const robustnessScores = normalizeMinMax(rawCombos.map((combo) => combo.worstMemberPnl));

  return rawCombos.map((combo, index) => ({
    ...combo,
    weightedScore: round(
      (
        pnlScores[index] * weights.pnl
        + returnScores[index] * weights.returnPct
        + profitFactorScores[index] * weights.profitFactor
        + winRateScores[index] * weights.winRate
        + robustnessScores[index] * weights.robustness
      ) * 100,
      4
    )
  }))
    .sort((left, right) => {
      if (right.weightedScore !== left.weightedScore) return right.weightedScore - left.weightedScore;
      if (right.avgTotalPnl !== left.avgTotalPnl) return right.avgTotalPnl - left.avgTotalPnl;
      if (right.worstMemberPnl !== left.worstMemberPnl) return right.worstMemberPnl - left.worstMemberPnl;
      return left.comboLabel.localeCompare(right.comboLabel);
    });
}

function buildMonthlyCombos(candidates, comboSize, comboTopK, weights) {
  const candidateCombos = combinations(candidates, comboSize).map((comboStrategies) => {
    const sortedStrategies = [...comboStrategies].sort((left, right) => left.strategyName.localeCompare(right.strategyName));
    const totalTrades = sortedStrategies.reduce((sum, strategy) => sum + strategy.totalTrades, 0);
    const avgTotalPnl = sortedStrategies.reduce((sum, strategy) => sum + strategy.totalPnl, 0) / sortedStrategies.length;
    const avgReturnPct = sortedStrategies.reduce((sum, strategy) => sum + strategy.returnPct, 0) / sortedStrategies.length;
    const avgWinRatePct = sortedStrategies.reduce((sum, strategy) => sum + strategy.winRatePct, 0) / sortedStrategies.length;
    const avgProfitFactor = sortedStrategies.reduce((sum, strategy) => sum + strategy.profitFactor, 0) / sortedStrategies.length;
    const avgSharpeRatio = sortedStrategies.reduce((sum, strategy) => sum + strategy.sharpeRatio, 0) / sortedStrategies.length;
    const worstMemberPnl = Math.min(...sortedStrategies.map((strategy) => strategy.totalPnl));
    const maxMemberPnl = Math.max(...sortedStrategies.map((strategy) => strategy.totalPnl));

    return {
      comboKey: sortedStrategies.map((strategy) => strategy.strategyName).join(' || '),
      comboLabel: sortedStrategies.map((strategy) => strategy.shortLabel).join(' + '),
      size: sortedStrategies.length,
      strategies: sortedStrategies,
      avgTotalPnl: round(avgTotalPnl, 2),
      sumTotalPnl: round(sortedStrategies.reduce((sum, strategy) => sum + strategy.totalPnl, 0), 2),
      avgReturnPct: round(avgReturnPct, 4),
      avgWinRatePct: round(avgWinRatePct, 2),
      avgProfitFactor: round(avgProfitFactor, 4),
      avgSharpeRatio: round(avgSharpeRatio, 4),
      worstMemberPnl: round(worstMemberPnl, 2),
      pnlSpread: round(maxMemberPnl - worstMemberPnl, 2),
      totalTrades
    };
  });

  return scoreCombos(candidateCombos, weights).slice(0, comboTopK);
}

function buildPolicyMap(trainingMonths) {
  const featureMap = new Map();

  for (const month of trainingMonths) {
    const combo = month.bestCombo;
    if (!combo) continue;

    let featureEntry = featureMap.get(month.featureKey);
    if (!featureEntry) {
      featureEntry = {
        featureKey: month.featureKey,
        featureBucket: month.featureBucket,
        months: [],
        realizedVolPct: [],
        monthReturnPct: [],
        avgRangePct: [],
        upMinuteRatio: [],
        comboMap: new Map()
      };
      featureMap.set(month.featureKey, featureEntry);
    }

    featureEntry.months.push(month.month);
    featureEntry.realizedVolPct.push(month.realizedVolPct);
    featureEntry.monthReturnPct.push(month.monthReturnPct);
    featureEntry.avgRangePct.push(month.avgRangePct);
    featureEntry.upMinuteRatio.push(month.upMinuteRatio);

    let comboEntry = featureEntry.comboMap.get(combo.comboKey);
    if (!comboEntry) {
      comboEntry = {
        comboKey: combo.comboKey,
        comboLabel: combo.comboLabel,
        strategies: combo.strategies,
        months: [],
        totalWeightedScore: 0,
        totalAvgPnl: 0,
        worstMemberPnl: []
      };
      featureEntry.comboMap.set(combo.comboKey, comboEntry);
    }

    comboEntry.months.push(month.month);
    comboEntry.totalWeightedScore += combo.weightedScore;
    comboEntry.totalAvgPnl += combo.avgTotalPnl;
    comboEntry.worstMemberPnl.push(combo.worstMemberPnl);
  }

  return Array.from(featureMap.values())
    .map((entry) => {
      const combos = Array.from(entry.comboMap.values())
        .map((combo) => ({
          comboKey: combo.comboKey,
          comboLabel: combo.comboLabel,
          strategies: combo.strategies,
          months: combo.months,
          monthCount: combo.months.length,
          totalWeightedScore: round(combo.totalWeightedScore, 4),
          avgWeightedScore: round(combo.totalWeightedScore / combo.months.length, 4),
          totalAvgPnl: round(combo.totalAvgPnl, 2),
          avgMonthlyPnl: round(combo.totalAvgPnl / combo.months.length, 2),
          avgWorstMemberPnl: round(combo.worstMemberPnl.reduce((sum, value) => sum + value, 0) / combo.worstMemberPnl.length, 2)
        }))
        .sort((left, right) => {
          if (right.monthCount !== left.monthCount) return right.monthCount - left.monthCount;
          if (right.totalAvgPnl !== left.totalAvgPnl) return right.totalAvgPnl - left.totalAvgPnl;
          if (right.avgWeightedScore !== left.avgWeightedScore) return right.avgWeightedScore - left.avgWeightedScore;
          return left.comboLabel.localeCompare(right.comboLabel);
        });

      const selected = combos[0] ?? null;
      return {
        featureKey: entry.featureKey,
        featureBucket: entry.featureBucket,
        months: entry.months.sort(),
        centroid: {
          realizedVolPct: round(entry.realizedVolPct.reduce((sum, value) => sum + value, 0) / entry.realizedVolPct.length, 2),
          monthReturnPct: round(entry.monthReturnPct.reduce((sum, value) => sum + value, 0) / entry.monthReturnPct.length, 2),
          avgRangePct: round(entry.avgRangePct.reduce((sum, value) => sum + value, 0) / entry.avgRangePct.length, 4),
          upMinuteRatio: round(entry.upMinuteRatio.reduce((sum, value) => sum + value, 0) / entry.upMinuteRatio.length, 2)
        },
        combos,
        selectedCombo: selected
      };
    })
    .sort((left, right) => {
      const leftCount = left.selectedCombo?.monthCount ?? 0;
      const rightCount = right.selectedCombo?.monthCount ?? 0;
      if (rightCount !== leftCount) return rightCount - leftCount;
      const leftPnl = left.selectedCombo?.totalAvgPnl ?? 0;
      const rightPnl = right.selectedCombo?.totalAvgPnl ?? 0;
      if (rightPnl !== leftPnl) return rightPnl - leftPnl;
      return left.featureKey.localeCompare(right.featureKey);
    });
}

function buildFinalStrategyPool(policyMap) {
  const strategyMap = new Map();

  for (const entry of policyMap) {
    const combo = entry.selectedCombo;
    if (!combo) continue;

    for (const strategy of combo.strategies) {
      let aggregate = strategyMap.get(strategy.strategyName);
      if (!aggregate) {
        aggregate = {
          ...strategy,
          featureKeys: [],
          featureBuckets: new Set(),
          comboLabels: [],
          uses: 0,
          totalPnlWeight: 0
        };
        strategyMap.set(strategy.strategyName, aggregate);
      }

      aggregate.featureKeys.push(entry.featureKey);
      aggregate.featureBuckets.add(entry.featureBucket);
      aggregate.comboLabels.push(combo.comboLabel);
      aggregate.uses += 1;
      aggregate.totalPnlWeight += combo.totalAvgPnl;
    }
  }

  return Array.from(strategyMap.values())
    .map((entry) => ({
      strategyName: entry.strategyName,
      strategyType: entry.strategyType,
      shortLabel: entry.shortLabel,
      parameters: entry.parameters,
      featureKeys: entry.featureKeys,
      featureBuckets: Array.from(entry.featureBuckets),
      uses: entry.uses,
      totalPnlWeight: round(entry.totalPnlWeight, 2),
      comboLabels: entry.comboLabels
    }))
    .sort((left, right) => {
      if (right.uses !== left.uses) return right.uses - left.uses;
      if (right.totalPnlWeight !== left.totalPnlWeight) return right.totalPnlWeight - left.totalPnlWeight;
      return left.strategyName.localeCompare(right.strategyName);
    });
}

async function findTradeBatch(connection, strategyNames, symbol, range) {
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

  const createdAt = rows[0]?.created_at;
  if (!createdAt) {
    throw new Error('could not detect trade batch from trades table');
  }
  return String(createdAt);
}

async function loadTrades(connection, strategyNames, symbol, range, createdAt) {
  const placeholders = strategyNames.map(() => '?').join(', ');
  return queryRows(
    connection,
    `SELECT strategy_name, exit_time, pnl
     FROM trades
     WHERE created_at = ?
       AND strategy_name IN (${placeholders})
       AND symbol = ?
       AND exit_time BETWEEN ? AND ?
     ORDER BY exit_time ASC, strategy_name ASC`,
    [createdAt, ...strategyNames, symbol, range.startTimeMs, range.endTimeMs]
  );
}

function buildDailyStrategyMap(trades) {
  const byDay = new Map();

  for (const row of trades) {
    const day = toJstDayKey(Number(row.exit_time));
    const strategyName = String(row.strategy_name);
    const pnl = Number(row.pnl);
    let strategyMap = byDay.get(day);
    if (!strategyMap) {
      strategyMap = new Map();
      byDay.set(day, strategyMap);
    }
    strategyMap.set(strategyName, round((strategyMap.get(strategyName) ?? 0) + pnl, 2));
  }

  return byDay;
}

function buildValidationMonthRows(validationFeatures, policyMap, dailyStrategyMap) {
  const policyByKey = new Map(policyMap.map((entry) => [entry.featureKey, entry]));

  function distance(feature, policyEntry) {
    const centroid = policyEntry.centroid;
    const bucketPenalty = policyEntry.featureBucket === feature.featureBucket ? 0 : 3;
    return bucketPenalty
      + Math.abs((centroid.realizedVolPct ?? 0) - feature.realizedVolPct) / 5
      + Math.abs((centroid.monthReturnPct ?? 0) - feature.monthReturnPct) / 5
      + Math.abs((centroid.avgRangePct ?? 0) - feature.avgRangePct) / 0.03
      + Math.abs((centroid.upMinuteRatio ?? 0) - feature.upMinuteRatio) / 10;
  }

  const rows = [];

  for (const feature of validationFeatures) {
    const exact = policyByKey.get(feature.featureKey) ?? null;
    const matchedPolicy = exact ?? [...policyMap]
      .filter((entry) => entry.selectedCombo)
      .sort((left, right) => distance(feature, left) - distance(feature, right))[0] ?? null;

    const selectedCombo = matchedPolicy?.selectedCombo ?? null;
    const comboStrategies = selectedCombo?.strategies ?? [];
    const monthDays = [...dailyStrategyMap.keys()].filter((day) => day.startsWith(feature.month));
    const dailyPnls = monthDays
      .sort((left, right) => left.localeCompare(right))
      .map((day) => {
        const strategyMap = dailyStrategyMap.get(day) ?? new Map();
        const pnlValues = comboStrategies.map((strategy) => strategyMap.get(strategy.strategyName) ?? 0);
        const pnl = pnlValues.length
          ? round(pnlValues.reduce((sum, value) => sum + value, 0) / pnlValues.length, 2)
          : 0;
        return {
          day,
          pnl
        };
      });

    const monthPnl = round(dailyPnls.reduce((sum, row) => sum + row.pnl, 0), 2);
    const positiveDays = dailyPnls.filter((row) => row.pnl > 0).length;
    const negativeDays = dailyPnls.filter((row) => row.pnl < 0).length;

    rows.push({
      month: feature.month,
      featureBucket: feature.featureBucket,
      featureKey: feature.featureKey,
      realizedVolPct: feature.realizedVolPct,
      monthReturnPct: feature.monthReturnPct,
      avgRangePct: feature.avgRangePct,
      upMinuteRatio: feature.upMinuteRatio,
      matchedFeatureKey: matchedPolicy?.featureKey ?? null,
      matchedMonths: matchedPolicy?.months ?? [],
      matchedDistance: matchedPolicy ? round(distance(feature, matchedPolicy), 4) : null,
      comboLabel: selectedCombo?.comboLabel ?? null,
      comboStrategies: comboStrategies.map((strategy) => ({
        strategyName: strategy.strategyName,
        shortLabel: strategy.shortLabel
      })),
      comboPnl: monthPnl,
      positiveDays,
      negativeDays,
      tradedDays: dailyPnls.filter((row) => row.pnl !== 0).length,
      dailyPnls
    });
  }

  return rows;
}

function summarizeValidation(validationRows) {
  let cumulativePnl = 0;
  let peakPnl = 0;
  let maxDrawdown = 0;

  for (const row of validationRows) {
    cumulativePnl += row.comboPnl;
    peakPnl = Math.max(peakPnl, cumulativePnl);
    maxDrawdown = Math.max(maxDrawdown, peakPnl - cumulativePnl);
  }

  return {
    months: validationRows.length,
    totalPnl: round(validationRows.reduce((sum, row) => sum + row.comboPnl, 0), 2),
    positiveMonths: validationRows.filter((row) => row.comboPnl > 0).length,
    negativeMonths: validationRows.filter((row) => row.comboPnl < 0).length,
    maxDrawdown: round(maxDrawdown, 2),
    bestMonth: [...validationRows].sort((left, right) => right.comboPnl - left.comboPnl)[0] ?? null,
    worstMonth: [...validationRows].sort((left, right) => left.comboPnl - right.comboPnl)[0] ?? null
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# ${report.symbol} Monthly Feature Combo Pipeline`);
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push(`- Symbol: \`${report.symbol}\``);
  lines.push(`- Template config: \`${report.templateConfig}\``);
  lines.push(`- Training months: \`${report.training.startMonth}\` -> \`${report.training.endMonth}\``);
  lines.push(`- Validation months: \`${report.validation.startMonth}\` -> \`${report.validation.endMonth}\``);
  lines.push(`- Candidate limit per month: \`${report.options.candidateLimit}\``);
  lines.push(`- Combo size: \`${report.options.comboSize}\``);
  lines.push(`- Combo topK stored per month: \`${report.options.comboTopK}\``);
  lines.push('');
  lines.push('## Combo Scoring');
  lines.push('');
  lines.push(`- PnL weight: \`${report.options.weights.pnl}\``);
  lines.push(`- Return weight: \`${report.options.weights.returnPct}\``);
  lines.push(`- Profit factor weight: \`${report.options.weights.profitFactor}\``);
  lines.push(`- Win rate weight: \`${report.options.weights.winRate}\``);
  lines.push(`- Robustness weight: \`${report.options.weights.robustness}\``);
  lines.push('');
  lines.push('## Monthly Training Winners');
  lines.push('');
  lines.push('| Month | Feature Key | Return % | Realized Vol % | Avg Range % | Best Combo | Avg PnL | Score |');
  lines.push('| --- | --- | ---: | ---: | ---: | --- | ---: | ---: |');
  for (const month of report.training.months) {
    lines.push(`| ${month.month} | ${month.featureKey} | ${month.monthReturnPct} | ${month.realizedVolPct} | ${month.avgRangePct} | ${month.bestCombo?.comboLabel ?? '-'} | ${month.bestCombo?.avgTotalPnl ?? 0} | ${month.bestCombo?.weightedScore ?? 0} |`);
  }
  lines.push('');
  lines.push('## Feature -> Combo Policy');
  lines.push('');
  for (const entry of report.policyMap) {
    const selected = entry.selectedCombo;
    if (!selected) continue;
    lines.push(`- \`${entry.featureKey}\``);
    lines.push(`  months: \`${entry.months.join(', ')}\``);
    lines.push(`  centroid: \`vol=${entry.centroid.realizedVolPct}%\`, \`ret=${entry.centroid.monthReturnPct}%\`, \`range=${entry.centroid.avgRangePct}%\`, \`up=${entry.centroid.upMinuteRatio}%\``);
    lines.push(`  combo: \`${selected.comboLabel}\``);
    lines.push(`  combo months: \`${selected.months.join(', ')}\``);
    lines.push(`  avgMonthlyPnl: \`${selected.avgMonthlyPnl}\`, avgScore: \`${selected.avgWeightedScore}\``);
  }
  lines.push('');
  lines.push('## Final Strategy Pool');
  lines.push('');
  for (const strategy of report.finalStrategyPool) {
    lines.push(`- \`${strategy.shortLabel}\` | uses=\`${strategy.uses}\` | featureBuckets=\`${strategy.featureBuckets.join('/')}\``);
  }
  lines.push('');
  lines.push('## 2026 Validation');
  lines.push('');
  lines.push(`- Total PnL: \`${report.validation.summary.totalPnl}\``);
  lines.push(`- Positive months: \`${report.validation.summary.positiveMonths}\``);
  lines.push(`- Negative months: \`${report.validation.summary.negativeMonths}\``);
  lines.push(`- Max drawdown: \`${report.validation.summary.maxDrawdown}\``);
  if (report.validation.summary.bestMonth) {
    lines.push(`- Best month: \`${report.validation.summary.bestMonth.month}\` / \`${report.validation.summary.bestMonth.comboPnl}\``);
  }
  if (report.validation.summary.worstMonth) {
    lines.push(`- Worst month: \`${report.validation.summary.worstMonth.month}\` / \`${report.validation.summary.worstMonth.comboPnl}\``);
  }
  lines.push('');
  lines.push('| Month | Feature Key | Matched Policy | Selected Combo | Combo PnL | Positive Days | Negative Days |');
  lines.push('| --- | --- | --- | --- | ---: | ---: | ---: |');
  for (const row of report.validation.months) {
    lines.push(`| ${row.month} | ${row.featureKey} | ${row.matchedFeatureKey ?? '-'} | ${row.comboLabel ?? '-'} | ${row.comboPnl} | ${row.positiveDays} | ${row.negativeDays} |`);
  }
  lines.push('');
  lines.push('## Generated Files');
  lines.push('');
  lines.push(`- Validation config: \`${report.validation.generatedValidationConfig}\``);
  lines.push(`- Strategy pool snapshot: \`${report.generated.strategyPoolSnapshot}\``);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const templatePath = path.resolve(required(args, 'template'));
  const symbol = required(args, 'symbol').toUpperCase();
  const trainingStartMonth = required(args, 'trainStartMonth');
  const trainingEndMonth = required(args, 'trainEndMonth');
  const validationStartMonth = args.validateStartMonth || '2026-01';
  const validationEndMonth = args.validateEndMonth || '2026-12';
  const candidateLimit = Number(args.candidateLimit || '12');
  const comboSize = Number(args.comboSize || '3');
  const comboTopK = Number(args.comboTopK || '5');
  const weights = {
    pnl: Number(args.pnlWeight || '0.60'),
    returnPct: Number(args.returnWeight || '0.20'),
    profitFactor: Number(args.profitFactorWeight || '0.10'),
    winRate: Number(args.winRateWeight || '0.05'),
    robustness: Number(args.robustnessWeight || '0.05')
  };
  const template = loadJson(templatePath);

  ensureDir(GENERATED_DIR);
  ensureDir(REPORT_DIR);

  const connection = await connect();
  try {
    const trainingMonths = [];
    for (const month of enumerateMonths(trainingStartMonth, trainingEndMonth)) {
      const monthDate = parseMonth(month);
      const range = buildTimeRange(startOfUtcMonth(monthDate), endOfUtcMonth(monthDate));
      const resultGroup = `${symbol.toLowerCase()}_monthly_feature_combo_train_${monthLabel(month)}`;
      const config = buildMonthTrainingConfig(template, month, range, resultGroup);
      const configPath = path.join(GENERATED_DIR, `${symbol.toLowerCase()}_${monthLabel(month)}_feature_combo_train.json`);

      writeJson(configPath, config);
      console.log(`\n[monthly-feature-combo] training ${month} ...`);
      runTrainConfig(path.relative(ROOT_DIR, configPath));

      const runId = await findLatestRunId(connection, resultGroup);
      if (!runId) {
        throw new Error(`no run_id for result_group=${resultGroup}`);
      }

      const [candidates, klines] = await Promise.all([
        loadResultRows(connection, resultGroup, runId, candidateLimit),
        loadKlines(connection, symbol, range)
      ]);

      const feature = computeMonthFeatures(klines, month);
      if (!feature) {
        continue;
      }
      if (candidates.length < comboSize) {
        throw new Error(`month ${month} candidate count ${candidates.length} < comboSize ${comboSize}`);
      }

      const topCombos = buildMonthlyCombos(candidates, comboSize, comboTopK, weights);
      trainingMonths.push({
        month,
        resultGroup,
        runId,
        ...feature,
        candidates,
        topCombos,
        bestCombo: topCombos[0] ?? null
      });
    }

    const policyMap = buildPolicyMap(trainingMonths);
    const finalStrategyPool = buildFinalStrategyPool(policyMap);
    const validationExplicitStrategies = finalStrategyPool.map((strategy) => ({
      strategyName: strategy.strategyName,
      strategyType: strategy.strategyType,
      shortLabel: strategy.shortLabel,
      parameters: strategy.parameters
    }));

    const validationStartDate = startOfUtcMonth(parseMonth(validationStartMonth));
    const validationEndDate = endOfUtcMonth(parseMonth(validationEndMonth));
    const validationRange = buildTimeRange(validationStartDate, validationEndDate);
    const validationResultGroup = `${symbol.toLowerCase()}_monthly_feature_combo_validate_${monthLabel(validationStartMonth)}_${monthLabel(validationEndMonth)}`;
    const validationConfig = buildValidationConfig(
      template,
      `${symbol}_MONTHLY_FEATURE_COMBO_VALIDATION_${monthLabel(validationStartMonth)}_${monthLabel(validationEndMonth)}`,
      `${symbol} monthly feature combo validation`,
      validationRange,
      validationResultGroup,
      validationExplicitStrategies
    );
    const validationConfigPath = path.join(GENERATED_DIR, `${symbol.toLowerCase()}_${monthLabel(validationStartMonth)}_${monthLabel(validationEndMonth)}_feature_combo_validation.json`);
    writeJson(validationConfigPath, validationConfig);

    console.log(`\n[monthly-feature-combo] validating ${validationStartMonth} -> ${validationEndMonth} ...`);
    runTrainConfig(path.relative(ROOT_DIR, validationConfigPath));

    const validationStrategyNames = validationExplicitStrategies.map((strategy) => strategy.strategyName);
    const validationTradeBatch = await findTradeBatch(connection, validationStrategyNames, symbol, validationRange);
    const [validationTrades, validationKlines] = await Promise.all([
      loadTrades(connection, validationStrategyNames, symbol, validationRange, validationTradeBatch),
      loadKlines(connection, symbol, validationRange)
    ]);

    const validationFeatures = [];
    for (const month of enumerateMonths(validationStartMonth, validationEndMonth)) {
      const monthFeature = computeMonthFeatures(
        validationKlines.filter((row) => toJstMonthKey(Number(row.open_time)) === month),
        month
      );
      if (monthFeature) {
        validationFeatures.push(monthFeature);
      }
    }

    const dailyStrategyMap = buildDailyStrategyMap(validationTrades);
    const validationRows = buildValidationMonthRows(validationFeatures, policyMap, dailyStrategyMap);
    const validationSummary = summarizeValidation(validationRows);

    const strategyPoolSnapshot = {
      symbol,
      generatedAt: new Date().toISOString(),
      source: {
        templateConfig: path.relative(ROOT_DIR, templatePath),
        trainingStartMonth,
        trainingEndMonth,
        comboSize,
        candidateLimit
      },
      strategies: validationExplicitStrategies
    };
    const strategyPoolPath = path.join(GENERATED_DIR, `${symbol.toLowerCase()}_${monthLabel(trainingStartMonth)}_${monthLabel(trainingEndMonth)}_feature_combo_strategy_pool.json`);
    writeJson(strategyPoolPath, strategyPoolSnapshot);

    const report = {
      symbol,
      generatedAt: new Date().toISOString(),
      templateConfig: path.relative(ROOT_DIR, templatePath),
      options: {
        candidateLimit,
        comboSize,
        comboTopK,
        weights
      },
      training: {
        startMonth: trainingStartMonth,
        endMonth: trainingEndMonth,
        months: trainingMonths
      },
      policyMap,
      finalStrategyPool,
      validation: {
        startMonth: validationStartMonth,
        endMonth: validationEndMonth,
        generatedValidationConfig: path.relative(ROOT_DIR, validationConfigPath),
        tradeBatch: validationTradeBatch,
        months: validationRows,
        summary: validationSummary
      },
      generated: {
        strategyPoolSnapshot: path.relative(ROOT_DIR, strategyPoolPath)
      }
    };

    const prefix = `${symbol}_${monthLabel(trainingStartMonth)}_${monthLabel(trainingEndMonth)}_monthly_feature_combo_pipeline`;
    const jsonPath = path.join(REPORT_DIR, `${prefix}.json`);
    const mdPath = path.join(REPORT_DIR, `${prefix}.md`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(mdPath, buildMarkdown(report), 'utf8');

    console.log(`\n[monthly-feature-combo] JSON written: ${jsonPath}`);
    console.log(`[monthly-feature-combo] MD written: ${mdPath}`);
    console.log(`[monthly-feature-combo] validation config written: ${validationConfigPath}`);
    console.log(`[monthly-feature-combo] strategy pool written: ${strategyPoolPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[monthly-feature-combo] failed: ${error.stack || error.message}`);
  process.exit(1);
});
