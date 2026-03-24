#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { BACKTEST_RESULTS_TABLE } = require('@money/database');
const { createMysqlConnectionWithFallback, loadEnvFiles } = require('@money/database');

loadEnvFiles(dotenv, [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../backend/.env'),
  path.resolve(__dirname, '../../.env')
]);

const ROOT_DIR = path.resolve(__dirname, '..');
const GENERATED_DIR = path.join(ROOT_DIR, 'configs', 'generated', 'weekly-feature-combos');
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'weekly-feature-combos');
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

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

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildTimeRange(startDate, endDate) {
  return {
    startTimeMs: startDate.getTime(),
    endTimeMs: endDate.getTime(),
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString()
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
  const isoWeek = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const key = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;

  const weekStartJst = new Date(utcDate);
  weekStartJst.setUTCDate(utcDate.getUTCDate() - 3);
  weekStartJst.setUTCHours(0, 0, 0, 0);
  const weekEndJst = new Date(weekStartJst.getTime() + WEEK_MS - 60 * 1000);

  return {
    key,
    isoYear,
    isoWeek,
    label: key.replace(/[^0-9A-Z]/gi, '_'),
    startUtc: new Date(utcMsFromJstDate(weekStartJst)),
    endUtc: new Date(utcMsFromJstDate(weekEndJst))
  };
}

function getIsoWeekKey(timestampMs) {
  return getIsoWeekInfoFromUtcMs(timestampMs).key;
}

function enumerateWeeksFromMonths(startMonth, endMonth) {
  const startDate = startOfUtcMonth(parseMonth(startMonth));
  const endDate = endOfUtcMonth(parseMonth(endMonth));
  const seen = new Map();

  for (let cursor = startDate.getTime(); cursor <= endDate.getTime(); cursor += DAY_MS) {
    const info = getIsoWeekInfoFromUtcMs(cursor);
    const clippedStartUtc = new Date(Math.max(info.startUtc.getTime(), startDate.getTime()));
    const clippedEndUtc = new Date(Math.min(info.endUtc.getTime(), endDate.getTime()));
    if (!seen.has(info.key)) {
      seen.set(info.key, {
        ...info,
        startUtc: clippedStartUtc,
        endUtc: clippedEndUtc
      });
    }
  }

  return Array.from(seen.values())
    .sort((left, right) => left.startUtc.getTime() - right.startUtc.getTime());
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

function detectFeatureBucket(feature) {
  if (feature.periodReturnPct <= -4 && feature.realizedVolPct >= 5) return 'crash-trend';
  if (feature.periodReturnPct >= 4 && feature.realizedVolPct >= 5) return 'strong-trend';
  if (Math.abs(feature.periodReturnPct) <= 1.5 && feature.realizedVolPct < 4) return 'range-low-vol';
  if (Math.abs(feature.periodReturnPct) <= 3.5) return 'range-mid-vol';
  return 'mixed-trend';
}

function detectVolBand(realizedVolPct) {
  if (realizedVolPct >= 9) return 'extreme';
  if (realizedVolPct >= 6) return 'high';
  if (realizedVolPct >= 4) return 'mid';
  return 'low';
}

function detectRangeBand(avgRangePct) {
  if (avgRangePct >= 0.1) return 'wide';
  if (avgRangePct >= 0.06) return 'normal';
  return 'tight';
}

function detectBiasBand(periodReturnPct) {
  if (periodReturnPct >= 4) return 'up-strong';
  if (periodReturnPct >= 1.5) return 'up';
  if (periodReturnPct <= -4) return 'down-strong';
  if (periodReturnPct <= -1.5) return 'down';
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
    `bias:${detectBiasBand(feature.periodReturnPct)}`,
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

function buildWeekTrainingConfig(template, weekInfo, resultGroup) {
  return {
    ...template,
    name: `${template.name}_${weekInfo.label}`,
    description: `${template.description} | weekly feature combo train ${weekInfo.key}`,
    timeRange: buildTimeRange(weekInfo.startUtc, weekInfo.endUtc),
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

function computePeriodFeatures(klines, weekKey) {
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
    week: weekKey,
    minutes: count,
    realizedVolPct: round(Math.sqrt(sumSquaredLogReturns) * 100, 2),
    avgAbsReturnPct: round(sumAbsReturnPct / count, 4),
    avgRangePct: round(sumRangePct / count, 4),
    maxAbsReturnPct: round(maxAbsReturnPct, 4),
    maxRangePct: round(maxRangePct, 4),
    periodReturnPct: round(((lastClose / firstOpen) - 1) * 100, 2),
    upMinuteRatio: round((upMinutes / count) * 100, 2)
  };
  const featureBucket = detectFeatureBucket(feature);

  return {
    ...feature,
    featureBucket,
    featureKey: buildFeatureKey({
      ...feature,
      featureBucket
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

function buildWeeklyCombos(candidates, comboSize, comboTopK, weights) {
  const candidateCombos = combinations(candidates, comboSize).map((comboStrategies) => {
    const sortedStrategies = [...comboStrategies].sort((left, right) => left.strategyName.localeCompare(right.strategyName));
    const avgTotalPnl = sortedStrategies.reduce((sum, strategy) => sum + strategy.totalPnl, 0) / sortedStrategies.length;
    const avgReturnPct = sortedStrategies.reduce((sum, strategy) => sum + strategy.returnPct, 0) / sortedStrategies.length;
    const avgWinRatePct = sortedStrategies.reduce((sum, strategy) => sum + strategy.winRatePct, 0) / sortedStrategies.length;
    const avgProfitFactor = sortedStrategies.reduce((sum, strategy) => sum + strategy.profitFactor, 0) / sortedStrategies.length;
    const avgSharpeRatio = sortedStrategies.reduce((sum, strategy) => sum + strategy.sharpeRatio, 0) / sortedStrategies.length;
    const worstMemberPnl = Math.min(...sortedStrategies.map((strategy) => strategy.totalPnl));
    return {
      comboKey: sortedStrategies.map((strategy) => strategy.strategyName).join(' || '),
      comboLabel: sortedStrategies.map((strategy) => strategy.shortLabel).join(' + '),
      strategies: sortedStrategies,
      avgTotalPnl: round(avgTotalPnl, 2),
      avgReturnPct: round(avgReturnPct, 4),
      avgWinRatePct: round(avgWinRatePct, 2),
      avgProfitFactor: round(avgProfitFactor, 4),
      avgSharpeRatio: round(avgSharpeRatio, 4),
      worstMemberPnl: round(worstMemberPnl, 2)
    };
  });

  return scoreCombos(candidateCombos, weights).slice(0, comboTopK);
}

function buildPolicyMap(trainingWeeks) {
  const featureMap = new Map();

  for (const week of trainingWeeks) {
    if (!week.bestCombo) continue;

    let featureEntry = featureMap.get(week.featureKey);
    if (!featureEntry) {
      featureEntry = {
        featureKey: week.featureKey,
        featureBucket: week.featureBucket,
        weeks: [],
        realizedVolPct: [],
        periodReturnPct: [],
        avgRangePct: [],
        upMinuteRatio: [],
        comboMap: new Map()
      };
      featureMap.set(week.featureKey, featureEntry);
    }

    featureEntry.weeks.push(week.week);
    featureEntry.realizedVolPct.push(week.realizedVolPct);
    featureEntry.periodReturnPct.push(week.periodReturnPct);
    featureEntry.avgRangePct.push(week.avgRangePct);
    featureEntry.upMinuteRatio.push(week.upMinuteRatio);

    let comboEntry = featureEntry.comboMap.get(week.bestCombo.comboKey);
    if (!comboEntry) {
      comboEntry = {
        comboKey: week.bestCombo.comboKey,
        comboLabel: week.bestCombo.comboLabel,
        strategies: week.bestCombo.strategies,
        weeks: [],
        totalWeightedScore: 0,
        totalAvgPnl: 0
      };
      featureEntry.comboMap.set(week.bestCombo.comboKey, comboEntry);
    }

    comboEntry.weeks.push(week.week);
    comboEntry.totalWeightedScore += week.bestCombo.weightedScore;
    comboEntry.totalAvgPnl += week.bestCombo.avgTotalPnl;
  }

  return Array.from(featureMap.values())
    .map((entry) => {
      const combos = Array.from(entry.comboMap.values())
        .map((combo) => ({
          comboKey: combo.comboKey,
          comboLabel: combo.comboLabel,
          strategies: combo.strategies,
          weeks: combo.weeks,
          weekCount: combo.weeks.length,
          totalWeightedScore: round(combo.totalWeightedScore, 4),
          avgWeightedScore: round(combo.totalWeightedScore / combo.weeks.length, 4),
          totalAvgPnl: round(combo.totalAvgPnl, 2),
          avgWeeklyPnl: round(combo.totalAvgPnl / combo.weeks.length, 2)
        }))
        .sort((left, right) => {
          if (right.weekCount !== left.weekCount) return right.weekCount - left.weekCount;
          if (right.totalAvgPnl !== left.totalAvgPnl) return right.totalAvgPnl - left.totalAvgPnl;
          if (right.avgWeightedScore !== left.avgWeightedScore) return right.avgWeightedScore - left.avgWeightedScore;
          return left.comboLabel.localeCompare(right.comboLabel);
        });

      return {
        featureKey: entry.featureKey,
        featureBucket: entry.featureBucket,
        weeks: entry.weeks.sort(),
        centroid: {
          realizedVolPct: round(entry.realizedVolPct.reduce((sum, value) => sum + value, 0) / entry.realizedVolPct.length, 2),
          periodReturnPct: round(entry.periodReturnPct.reduce((sum, value) => sum + value, 0) / entry.periodReturnPct.length, 2),
          avgRangePct: round(entry.avgRangePct.reduce((sum, value) => sum + value, 0) / entry.avgRangePct.length, 4),
          upMinuteRatio: round(entry.upMinuteRatio.reduce((sum, value) => sum + value, 0) / entry.upMinuteRatio.length, 2)
        },
        combos,
        selectedCombo: combos[0] ?? null
      };
    })
    .sort((left, right) => {
      const leftCount = left.selectedCombo?.weekCount ?? 0;
      const rightCount = right.selectedCombo?.weekCount ?? 0;
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
          uses: 0,
          totalPnlWeight: 0
        };
        strategyMap.set(strategy.strategyName, aggregate);
      }

      aggregate.featureKeys.push(entry.featureKey);
      aggregate.featureBuckets.add(entry.featureBucket);
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
      totalPnlWeight: round(entry.totalPnlWeight, 2)
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

function buildPeriodStrategyMap(trades) {
  const byWeek = new Map();
  for (const row of trades) {
    const week = getIsoWeekKey(Number(row.exit_time));
    const strategyName = String(row.strategy_name);
    const pnl = Number(row.pnl);
    let strategyMap = byWeek.get(week);
    if (!strategyMap) {
      strategyMap = new Map();
      byWeek.set(week, strategyMap);
    }
    strategyMap.set(strategyName, round((strategyMap.get(strategyName) ?? 0) + pnl, 2));
  }
  return byWeek;
}

function buildValidationRows(validationWeeks, policyMap, periodStrategyMap) {
  const policyByKey = new Map(policyMap.map((entry) => [entry.featureKey, entry]));

  function distance(feature, policyEntry) {
    const centroid = policyEntry.centroid;
    const bucketPenalty = policyEntry.featureBucket === feature.featureBucket ? 0 : 3;
    return bucketPenalty
      + Math.abs((centroid.realizedVolPct ?? 0) - feature.realizedVolPct) / 3
      + Math.abs((centroid.periodReturnPct ?? 0) - feature.periodReturnPct) / 2
      + Math.abs((centroid.avgRangePct ?? 0) - feature.avgRangePct) / 0.02
      + Math.abs((centroid.upMinuteRatio ?? 0) - feature.upMinuteRatio) / 8;
  }

  return validationWeeks.map((feature) => {
    const exact = policyByKey.get(feature.featureKey) ?? null;
    const matchedPolicy = exact ?? [...policyMap]
      .filter((entry) => entry.selectedCombo)
      .sort((left, right) => distance(feature, left) - distance(feature, right))[0] ?? null;

    const combo = matchedPolicy?.selectedCombo ?? null;
    const strategyMap = periodStrategyMap.get(feature.week) ?? new Map();
    const comboPnls = combo?.strategies.map((strategy) => strategyMap.get(strategy.strategyName) ?? 0) ?? [];
    const comboPnl = comboPnls.length
      ? round(comboPnls.reduce((sum, value) => sum + value, 0) / comboPnls.length, 2)
      : 0;
    const positiveStrategies = comboPnls.filter((value) => value > 0).length;
    const negativeStrategies = comboPnls.filter((value) => value < 0).length;

    return {
      week: feature.week,
      featureBucket: feature.featureBucket,
      featureKey: feature.featureKey,
      realizedVolPct: feature.realizedVolPct,
      periodReturnPct: feature.periodReturnPct,
      avgRangePct: feature.avgRangePct,
      upMinuteRatio: feature.upMinuteRatio,
      matchedFeatureKey: matchedPolicy?.featureKey ?? null,
      matchedWeeks: matchedPolicy?.weeks ?? [],
      matchedDistance: matchedPolicy ? round(distance(feature, matchedPolicy), 4) : null,
      comboLabel: combo?.comboLabel ?? null,
      comboStrategies: combo?.strategies.map((strategy) => ({
        strategyName: strategy.strategyName,
        shortLabel: strategy.shortLabel
      })) ?? [],
      comboPnl,
      positiveStrategies,
      negativeStrategies
    };
  });
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
    weeks: validationRows.length,
    totalPnl: round(validationRows.reduce((sum, row) => sum + row.comboPnl, 0), 2),
    positiveWeeks: validationRows.filter((row) => row.comboPnl > 0).length,
    negativeWeeks: validationRows.filter((row) => row.comboPnl < 0).length,
    maxDrawdown: round(maxDrawdown, 2),
    bestWeek: [...validationRows].sort((left, right) => right.comboPnl - left.comboPnl)[0] ?? null,
    worstWeek: [...validationRows].sort((left, right) => left.comboPnl - right.comboPnl)[0] ?? null
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# ${report.symbol} Weekly Feature Combo Pipeline`);
  lines.push('');
  lines.push(`- Template config: \`${report.templateConfig}\``);
  lines.push(`- Training months: \`${report.training.startMonth}\` -> \`${report.training.endMonth}\``);
  lines.push(`- Training weeks: \`${report.training.weeks.length}\``);
  lines.push(`- Validation months: \`${report.validation.startMonth}\` -> \`${report.validation.endMonth}\``);
  lines.push(`- Validation weeks: \`${report.validation.summary.weeks}\``);
  lines.push('');
  lines.push('## Combo Scoring');
  lines.push('');
  lines.push(`- PnL weight: \`${report.options.weights.pnl}\``);
  lines.push(`- Return weight: \`${report.options.weights.returnPct}\``);
  lines.push(`- Profit factor weight: \`${report.options.weights.profitFactor}\``);
  lines.push(`- Win rate weight: \`${report.options.weights.winRate}\``);
  lines.push(`- Robustness weight: \`${report.options.weights.robustness}\``);
  lines.push('');
  lines.push('## Weekly Training Winners');
  lines.push('');
  lines.push('| Week | Feature Key | Return % | Realized Vol % | Avg Range % | Best Combo | Avg PnL | Score |');
  lines.push('| --- | --- | ---: | ---: | ---: | --- | ---: | ---: |');
  for (const week of report.training.weeks) {
    lines.push(`| ${week.week} | ${week.featureKey} | ${week.periodReturnPct} | ${week.realizedVolPct} | ${week.avgRangePct} | ${week.bestCombo?.comboLabel ?? '-'} | ${week.bestCombo?.avgTotalPnl ?? 0} | ${week.bestCombo?.weightedScore ?? 0} |`);
  }
  lines.push('');
  lines.push('## Feature -> Combo Policy');
  lines.push('');
  for (const entry of report.policyMap) {
    const combo = entry.selectedCombo;
    if (!combo) continue;
    lines.push(`- \`${entry.featureKey}\``);
    lines.push(`  weeks: \`${entry.weeks.join(', ')}\``);
    lines.push(`  centroid: \`vol=${entry.centroid.realizedVolPct}%\`, \`ret=${entry.centroid.periodReturnPct}%\`, \`range=${entry.centroid.avgRangePct}%\`, \`up=${entry.centroid.upMinuteRatio}%\``);
    lines.push(`  combo: \`${combo.comboLabel}\``);
    lines.push(`  avgWeeklyPnl: \`${combo.avgWeeklyPnl}\`, avgScore: \`${combo.avgWeightedScore}\``);
  }
  lines.push('');
  lines.push('## Final Strategy Pool');
  lines.push('');
  for (const strategy of report.finalStrategyPool) {
    lines.push(`- \`${strategy.shortLabel}\` | uses=\`${strategy.uses}\` | featureBuckets=\`${strategy.featureBuckets.join('/')}\``);
  }
  lines.push('');
  lines.push('## 2026 Weekly Validation');
  lines.push('');
  lines.push(`- Total PnL: \`${report.validation.summary.totalPnl}\``);
  lines.push(`- Positive weeks: \`${report.validation.summary.positiveWeeks}\``);
  lines.push(`- Negative weeks: \`${report.validation.summary.negativeWeeks}\``);
  lines.push(`- Max drawdown: \`${report.validation.summary.maxDrawdown}\``);
  if (report.validation.summary.bestWeek) {
    lines.push(`- Best week: \`${report.validation.summary.bestWeek.week}\` / \`${report.validation.summary.bestWeek.comboPnl}\``);
  }
  if (report.validation.summary.worstWeek) {
    lines.push(`- Worst week: \`${report.validation.summary.worstWeek.week}\` / \`${report.validation.summary.worstWeek.comboPnl}\``);
  }
  lines.push('');
  lines.push('| Week | Feature Key | Matched Policy | Selected Combo | Combo PnL | Positive Strategies | Negative Strategies |');
  lines.push('| --- | --- | --- | --- | ---: | ---: | ---: |');
  for (const row of report.validation.weeks) {
    lines.push(`| ${row.week} | ${row.featureKey} | ${row.matchedFeatureKey ?? '-'} | ${row.comboLabel ?? '-'} | ${row.comboPnl} | ${row.positiveStrategies} | ${row.negativeStrategies} |`);
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
    const trainingWeeks = [];
    for (const weekInfo of enumerateWeeksFromMonths(trainingStartMonth, trainingEndMonth)) {
      const resultGroup = `${symbol.toLowerCase()}_weekly_feature_combo_train_${weekInfo.label.toLowerCase()}`;
      const config = buildWeekTrainingConfig(template, weekInfo, resultGroup);
      const configPath = path.join(GENERATED_DIR, `${symbol.toLowerCase()}_${weekInfo.label.toLowerCase()}_feature_combo_train.json`);
      writeJson(configPath, config);

      console.log(`\n[weekly-feature-combo] training ${weekInfo.key} ...`);
      runTrainConfig(path.relative(ROOT_DIR, configPath));

      const runId = await findLatestRunId(connection, resultGroup);
      if (!runId) {
        throw new Error(`no run_id for result_group=${resultGroup}`);
      }

      const range = buildTimeRange(weekInfo.startUtc, weekInfo.endUtc);
      const [candidates, klines] = await Promise.all([
        loadResultRows(connection, resultGroup, runId, candidateLimit),
        loadKlines(connection, symbol, range)
      ]);

      const feature = computePeriodFeatures(klines, weekInfo.key);
      if (!feature) {
        continue;
      }
      if (candidates.length < comboSize) {
        throw new Error(`week ${weekInfo.key} candidate count ${candidates.length} < comboSize ${comboSize}`);
      }

      const topCombos = buildWeeklyCombos(candidates, comboSize, comboTopK, weights);
      trainingWeeks.push({
        week: weekInfo.key,
        resultGroup,
        runId,
        ...feature,
        candidates,
        topCombos,
        bestCombo: topCombos[0] ?? null
      });
    }

    const policyMap = buildPolicyMap(trainingWeeks);
    const finalStrategyPool = buildFinalStrategyPool(policyMap);
    const validationExplicitStrategies = finalStrategyPool.map((strategy) => ({
      strategyName: strategy.strategyName,
      strategyType: strategy.strategyType,
      shortLabel: strategy.shortLabel,
      parameters: strategy.parameters
    }));

    const validationRange = buildTimeRange(
      startOfUtcMonth(parseMonth(validationStartMonth)),
      endOfUtcMonth(parseMonth(validationEndMonth))
    );
    const validationResultGroup = `${symbol.toLowerCase()}_weekly_feature_combo_validate_${validationStartMonth.replace('-', '_')}_${validationEndMonth.replace('-', '_')}`;
    const validationConfig = buildValidationConfig(
      template,
      `${symbol}_WEEKLY_FEATURE_COMBO_VALIDATION_${validationStartMonth.replace('-', '_')}_${validationEndMonth.replace('-', '_')}`,
      `${symbol} weekly feature combo validation`,
      validationRange,
      validationResultGroup,
      validationExplicitStrategies
    );
    const validationConfigPath = path.join(GENERATED_DIR, `${symbol.toLowerCase()}_${validationStartMonth.replace('-', '_')}_${validationEndMonth.replace('-', '_')}_feature_combo_validation.json`);
    writeJson(validationConfigPath, validationConfig);

    console.log(`\n[weekly-feature-combo] validating ${validationStartMonth} -> ${validationEndMonth} ...`);
    runTrainConfig(path.relative(ROOT_DIR, validationConfigPath));

    const validationStrategyNames = validationExplicitStrategies.map((strategy) => strategy.strategyName);
    const validationTradeBatch = await findTradeBatch(connection, validationStrategyNames, symbol, validationRange);
    const [validationTrades, validationKlines] = await Promise.all([
      loadTrades(connection, validationStrategyNames, symbol, validationRange, validationTradeBatch),
      loadKlines(connection, symbol, validationRange)
    ]);

    const validationWeeks = [];
    for (const weekInfo of enumerateWeeksFromMonths(validationStartMonth, validationEndMonth)) {
      const filteredKlines = validationKlines.filter((row) => getIsoWeekKey(Number(row.open_time)) === weekInfo.key);
      const feature = computePeriodFeatures(filteredKlines, weekInfo.key);
      if (feature) {
        validationWeeks.push(feature);
      }
    }

    const periodStrategyMap = buildPeriodStrategyMap(validationTrades);
    const validationRows = buildValidationRows(validationWeeks, policyMap, periodStrategyMap);
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
    const strategyPoolPath = path.join(GENERATED_DIR, `${symbol.toLowerCase()}_${trainingStartMonth.replace('-', '_')}_${trainingEndMonth.replace('-', '_')}_feature_combo_strategy_pool.json`);
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
        weeks: trainingWeeks
      },
      policyMap,
      finalStrategyPool,
      validation: {
        startMonth: validationStartMonth,
        endMonth: validationEndMonth,
        generatedValidationConfig: path.relative(ROOT_DIR, validationConfigPath),
        tradeBatch: validationTradeBatch,
        weeks: validationRows,
        summary: validationSummary
      },
      generated: {
        strategyPoolSnapshot: path.relative(ROOT_DIR, strategyPoolPath)
      }
    };

    const prefix = `${symbol}_${trainingStartMonth.replace('-', '_')}_${trainingEndMonth.replace('-', '_')}_weekly_feature_combo_pipeline`;
    const jsonPath = path.join(REPORT_DIR, `${prefix}.json`);
    const mdPath = path.join(REPORT_DIR, `${prefix}.md`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(mdPath, buildMarkdown(report), 'utf8');

    console.log(`\n[weekly-feature-combo] JSON written: ${jsonPath}`);
    console.log(`[weekly-feature-combo] MD written: ${mdPath}`);
    console.log(`[weekly-feature-combo] validation config written: ${validationConfigPath}`);
    console.log(`[weekly-feature-combo] strategy pool written: ${strategyPoolPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[weekly-feature-combo] failed: ${error.stack || error.message}`);
  process.exit(1);
});
