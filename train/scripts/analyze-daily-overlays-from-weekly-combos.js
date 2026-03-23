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
const GENERATED_DIR = path.join(ROOT_DIR, 'configs', 'generated', 'daily-overlays');
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'daily-overlays');
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
  if (!Number.isFinite(value)) return 0;
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

function getJstDayKey(timestampMs) {
  const date = jstDateFromUtcMs(timestampMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function getIsoWeekKey(timestampMs) {
  const date = jstDateFromUtcMs(timestampMs);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
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

function detectDailyFeatureBucket(dayReturnPct, realizedVolPct) {
  if (dayReturnPct <= -2.5 && realizedVolPct >= 2.5) return 'crash-trend';
  if (dayReturnPct >= 2.5 && realizedVolPct >= 2.5) return 'strong-trend';
  if (Math.abs(dayReturnPct) <= 0.8 && realizedVolPct < 2.2) return 'range-low-vol';
  if (Math.abs(dayReturnPct) <= 1.5) return 'range-mid-vol';
  return 'mixed-trend';
}

function detectVolBand(realizedVolPct) {
  if (realizedVolPct >= 4) return 'extreme';
  if (realizedVolPct >= 2.8) return 'high';
  if (realizedVolPct >= 1.8) return 'mid';
  return 'low';
}

function detectRangeBand(avgRangePct) {
  if (avgRangePct >= 0.08) return 'wide';
  if (avgRangePct >= 0.04) return 'normal';
  return 'tight';
}

function detectBiasBand(dayReturnPct) {
  if (dayReturnPct >= 2.5) return 'up-strong';
  if (dayReturnPct >= 1) return 'up';
  if (dayReturnPct <= -2.5) return 'down-strong';
  if (dayReturnPct <= -1) return 'down';
  return 'flat';
}

function detectUpMinuteBand(upMinuteRatio) {
  if (upMinuteRatio >= 54) return 'bullish';
  if (upMinuteRatio <= 46) return 'bearish';
  return 'balanced';
}

function buildDailyFeatureKey(feature) {
  return [
    feature.featureBucket,
    `vol:${detectVolBand(feature.realizedVolPct)}`,
    `range:${detectRangeBand(feature.avgRangePct)}`,
    `bias:${detectBiasBand(feature.dayReturnPct)}`,
    `up:${detectUpMinuteBand(feature.upMinuteRatio)}`
  ].join('|');
}

function strategyToExplicit(strategy) {
  return {
    name: strategy.strategyName,
    type: strategy.strategyType,
    parameters: strategy.parameters
  };
}

function runTrainConfig(configPath) {
  execFileSync('node', ['dist/scripts/train.js', configPath], {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });
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

function buildDailyFeatures(klines) {
  const daily = new Map();

  for (const row of klines) {
    const openTime = Number(row.open_time);
    const open = choosePrice(row, 'open');
    const high = choosePrice(row, 'high');
    const low = choosePrice(row, 'low');
    const close = choosePrice(row, 'close');
    if (![openTime, open, high, low, close].every(Number.isFinite) || open <= 0 || close <= 0) {
      continue;
    }

    const day = getJstDayKey(openTime);
    let entry = daily.get(day);
    if (!entry) {
      entry = {
        day,
        week: getIsoWeekKey(openTime),
        count: 0,
        firstOpen: open,
        lastClose: close,
        sumSquaredLogReturns: 0,
        sumRangePct: 0,
        upMinutes: 0
      };
      daily.set(day, entry);
    }

    const logReturn = Math.log(close / open);
    const rangePct = ((high - low) / open) * 100;
    entry.count += 1;
    entry.lastClose = close;
    entry.sumSquaredLogReturns += logReturn * logReturn;
    entry.sumRangePct += rangePct;
    if (close > open) {
      entry.upMinutes += 1;
    }
  }

  return Array.from(daily.values())
    .sort((left, right) => left.day.localeCompare(right.day))
    .map((entry) => {
      const realizedVolPct = round(Math.sqrt(entry.sumSquaredLogReturns) * 100, 2);
      const dayReturnPct = round(((entry.lastClose / entry.firstOpen) - 1) * 100, 2);
      const avgRangePct = round(entry.sumRangePct / entry.count, 4);
      const upMinuteRatio = round((entry.upMinutes / entry.count) * 100, 2);
      const featureBucket = detectDailyFeatureBucket(dayReturnPct, realizedVolPct);
      return {
        day: entry.day,
        week: entry.week,
        minutes: entry.count,
        realizedVolPct,
        avgRangePct,
        dayReturnPct,
        upMinuteRatio,
        featureBucket,
        dailyFeatureKey: buildDailyFeatureKey({
          realizedVolPct,
          avgRangePct,
          dayReturnPct,
          upMinuteRatio,
          featureBucket
        })
      };
    });
}

function buildWeeklyFeatures(klines) {
  const weekly = new Map();

  for (const row of klines) {
    const openTime = Number(row.open_time);
    const open = choosePrice(row, 'open');
    const high = choosePrice(row, 'high');
    const low = choosePrice(row, 'low');
    const close = choosePrice(row, 'close');
    if (![openTime, open, high, low, close].every(Number.isFinite) || open <= 0 || close <= 0) {
      continue;
    }

    const week = getIsoWeekKey(openTime);
    let entry = weekly.get(week);
    if (!entry) {
      entry = {
        week,
        count: 0,
        firstOpen: open,
        lastClose: close,
        sumSquaredLogReturns: 0,
        sumRangePct: 0,
        upMinutes: 0
      };
      weekly.set(week, entry);
    }

    const logReturn = Math.log(close / open);
    const rangePct = ((high - low) / open) * 100;
    entry.count += 1;
    entry.lastClose = close;
    entry.sumSquaredLogReturns += logReturn * logReturn;
    entry.sumRangePct += rangePct;
    if (close > open) {
      entry.upMinutes += 1;
    }
  }

  return Array.from(weekly.values())
    .sort((left, right) => left.week.localeCompare(right.week))
    .map((entry) => {
      const realizedVolPct = round(Math.sqrt(entry.sumSquaredLogReturns) * 100, 2);
      const periodReturnPct = round(((entry.lastClose / entry.firstOpen) - 1) * 100, 2);
      const avgRangePct = round(entry.sumRangePct / entry.count, 4);
      const upMinuteRatio = round((entry.upMinutes / entry.count) * 100, 2);
      let featureBucket = 'mixed-trend';
      if (periodReturnPct <= -4 && realizedVolPct >= 5) featureBucket = 'crash-trend';
      else if (periodReturnPct >= 4 && realizedVolPct >= 5) featureBucket = 'strong-trend';
      else if (Math.abs(periodReturnPct) <= 1.5 && realizedVolPct < 4) featureBucket = 'range-low-vol';
      else if (Math.abs(periodReturnPct) <= 3.5) featureBucket = 'range-mid-vol';

      const featureKey = [
        featureBucket,
        `vol:${realizedVolPct >= 9 ? 'extreme' : realizedVolPct >= 6 ? 'high' : realizedVolPct >= 4 ? 'mid' : 'low'}`,
        `range:${avgRangePct >= 0.1 ? 'wide' : avgRangePct >= 0.06 ? 'normal' : 'tight'}`,
        `bias:${periodReturnPct >= 4 ? 'up-strong' : periodReturnPct >= 1.5 ? 'up' : periodReturnPct <= -4 ? 'down-strong' : periodReturnPct <= -1.5 ? 'down' : 'flat'}`,
        `up:${upMinuteRatio >= 54 ? 'bullish' : upMinuteRatio <= 46 ? 'bearish' : 'balanced'}`
      ].join('|');

      return {
        week: entry.week,
        realizedVolPct,
        periodReturnPct,
        avgRangePct,
        upMinuteRatio,
        featureBucket,
        featureKey
      };
    });
}

function buildStrategyPnlByDay(trades) {
  const byDay = new Map();
  for (const row of trades) {
    const day = getJstDayKey(Number(row.exit_time));
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

function distance(feature, policyEntry) {
  const centroid = policyEntry.centroid;
  const bucketPenalty = policyEntry.featureBucket === feature.featureBucket ? 0 : 3;
  return bucketPenalty
    + Math.abs((centroid.realizedVolPct ?? 0) - feature.realizedVolPct) / 3
    + Math.abs((centroid.periodReturnPct ?? 0) - feature.periodReturnPct) / 2
    + Math.abs((centroid.avgRangePct ?? 0) - feature.avgRangePct) / 0.02
    + Math.abs((centroid.upMinuteRatio ?? 0) - feature.upMinuteRatio) / 8;
}

function matchWeeklyPolicy(feature, policyMap) {
  const exact = policyMap.find((entry) => entry.featureKey === feature.featureKey && entry.selectedCombo);
  if (exact) {
    return exact;
  }
  return [...policyMap]
    .filter((entry) => entry.selectedCombo)
    .sort((left, right) => distance(feature, left) - distance(feature, right))[0] ?? null;
}

function createActionStats(action) {
  return {
    action,
    count: 0,
    totalPnl: 0,
    positiveDays: 0,
    negativeDays: 0
  };
}

function actionKey(actionStats) {
  return actionStats.action.type === 'strategy'
    ? `strategy:${actionStats.action.strategyName}`
    : actionStats.action.type;
}

function updateActionStats(stats, pnl) {
  stats.count += 1;
  stats.totalPnl += pnl;
  if (pnl > 0) stats.positiveDays += 1;
  if (pnl < 0) stats.negativeDays += 1;
}

function actionSortScore(actionStats) {
  return [
    round(actionStats.totalPnl, 2),
    actionStats.positiveDays,
    actionStats.action.type === 'combo_full' ? 4
      : actionStats.action.type === 'strategy' ? 3
      : actionStats.action.type === 'combo_half' ? 2
      : 1
  ];
}

function chooseBestAction(actionStatsList, defaultActionStats = null) {
  const sorted = [...actionStatsList].sort((left, right) => {
    const leftScore = actionSortScore(left);
    const rightScore = actionSortScore(right);
    for (let index = 0; index < leftScore.length; index += 1) {
      if (rightScore[index] !== leftScore[index]) {
        return rightScore[index] - leftScore[index];
      }
    }
    return 0;
  });

  const best = sorted[0] ?? null;
  if (!best) return null;

  if (
    defaultActionStats
    && best.action.type === 'strategy'
    && defaultActionStats.action.type === 'combo_full'
  ) {
    const improvement = best.totalPnl - defaultActionStats.totalPnl;
    if (improvement < 100 && best.positiveDays <= defaultActionStats.positiveDays) {
      return defaultActionStats;
    }
  }

  return best;
}

function shouldKeepExactOverlay(entry, weeklyDefault, thresholds) {
  if (!entry.selectedAction || !weeklyDefault) return false;
  if (entry.sampleCount < thresholds.minExactCount) return false;
  if (actionKey(entry.selectedAction) === actionKey(weeklyDefault)) return false;

  const selected = entry.selectedAction;
  const improvement = round(selected.totalPnl - weeklyDefault.totalPnl, 2);
  const defaultPositiveRate = weeklyDefault.count
    ? weeklyDefault.positiveDays / weeklyDefault.count
    : 0;

  if (selected.action.type === 'stop') {
    return (
      entry.sampleCount >= thresholds.minStopCount
      && weeklyDefault.action.type === 'combo_full'
      && weeklyDefault.totalPnl < 0
      && weeklyDefault.avgPnl <= -thresholds.minStopAvgLoss
      && improvement >= thresholds.minStopImprovement
      && weeklyDefault.negativeDays > weeklyDefault.positiveDays
      && defaultPositiveRate <= thresholds.maxStopPositiveRate
    );
  }

  if (selected.action.type === 'strategy') {
    return (
      improvement >= thresholds.minStrategyImprovement
      && selected.winRatePct + 0.01 >= weeklyDefault.winRatePct
      && selected.positiveDays >= weeklyDefault.positiveDays
      && (
        selected.avgPnl >= weeklyDefault.avgPnl
        || improvement >= thresholds.minStrategyImprovement * 2
      )
    );
  }

  if (selected.action.type === 'combo_half') {
    return (
      improvement >= thresholds.minHalfImprovement
      && weeklyDefault.totalPnl < 0
      && weeklyDefault.negativeDays > weeklyDefault.positiveDays
    );
  }

  return improvement >= thresholds.minStrategyImprovement;
}

function chooseEligibleExactAction(statsList, entryMeta, weeklyDefault, thresholds) {
  const eligible = statsList.filter((candidate) => shouldKeepExactOverlay({
    ...entryMeta,
    selectedAction: candidate
  }, weeklyDefault, thresholds));

  if (!eligible.length) return null;

  return [...eligible].sort((left, right) => {
    const leftScore = actionSortScore(left);
    const rightScore = actionSortScore(right);
    for (let index = 0; index < leftScore.length; index += 1) {
      if (rightScore[index] !== leftScore[index]) {
        return rightScore[index] - leftScore[index];
      }
    }
    return 0;
  })[0];
}

function buildTrainingDayRows(dailyFeatures, weeklyFeatures, policyMap, strategyPnlByDay) {
  const weeklyMap = new Map(weeklyFeatures.map((entry) => [entry.week, entry]));

  return dailyFeatures.map((day) => {
    const weeklyFeature = weeklyMap.get(day.week) ?? null;
    const matchedPolicy = weeklyFeature ? matchWeeklyPolicy(weeklyFeature, policyMap) : null;
    const comboStrategies = matchedPolicy?.selectedCombo?.strategies ?? [];
    const strategyMap = strategyPnlByDay.get(day.day) ?? new Map();
    const comboStrategyPnls = comboStrategies.map((strategy) => ({
      strategyName: strategy.strategyName,
      shortLabel: strategy.shortLabel,
      pnl: round(strategyMap.get(strategy.strategyName) ?? 0, 2)
    }));
    const comboPnl = comboStrategyPnls.length
      ? round(comboStrategyPnls.reduce((sum, item) => sum + item.pnl, 0) / comboStrategyPnls.length, 2)
      : 0;

    return {
      ...day,
      weeklyFeatureKey: matchedPolicy?.featureKey ?? null,
      matchedWeeklyFeatureKey: matchedPolicy?.featureKey ?? null,
      weeklyComboLabel: matchedPolicy?.selectedCombo?.comboLabel ?? null,
      comboStrategies: comboStrategyPnls,
      comboPnl,
      positiveStrategies: comboStrategyPnls.filter((item) => item.pnl > 0).length,
      negativeStrategies: comboStrategyPnls.filter((item) => item.pnl < 0).length
    };
  }).filter((row) => row.weeklyFeatureKey && row.comboStrategies.length);
}

function buildOverlayPolicy(trainingDayRows, thresholds) {
  const weeklyGroupMap = new Map();
  const exactGroupMap = new Map();

  for (const day of trainingDayRows) {
    const weeklyKey = day.weeklyFeatureKey;
    const exactKey = `${weeklyKey}__${day.dailyFeatureKey}`;

    if (!weeklyGroupMap.has(weeklyKey)) {
      weeklyGroupMap.set(weeklyKey, {
        weeklyFeatureKey: weeklyKey,
        comboLabel: day.weeklyComboLabel,
        actionStats: new Map()
      });
    }
    if (!exactGroupMap.has(exactKey)) {
      exactGroupMap.set(exactKey, {
        overlayKey: exactKey,
        weeklyFeatureKey: weeklyKey,
        dailyFeatureKey: day.dailyFeatureKey,
        comboLabel: day.weeklyComboLabel,
        actionStats: new Map()
      });
    }

    const candidateActions = [
      { type: 'combo_full' },
      { type: 'combo_half' },
      { type: 'stop' }
    ];
    for (const strategy of day.comboStrategies) {
      candidateActions.push({
        type: 'strategy',
        strategyName: strategy.strategyName,
        shortLabel: strategy.shortLabel
      });
    }

    for (const group of [weeklyGroupMap.get(weeklyKey), exactGroupMap.get(exactKey)]) {
      for (const action of candidateActions) {
        const actionKey = action.type === 'strategy' ? `strategy:${action.strategyName}` : action.type;
        if (!group.actionStats.has(actionKey)) {
          group.actionStats.set(actionKey, createActionStats(action));
        }

        let pnl = 0;
        if (action.type === 'combo_full') pnl = day.comboPnl;
        else if (action.type === 'combo_half') pnl = round(day.comboPnl * 0.5, 2);
        else if (action.type === 'stop') pnl = 0;
        else pnl = day.comboStrategies.find((item) => item.strategyName === action.strategyName)?.pnl ?? 0;

        updateActionStats(group.actionStats.get(actionKey), pnl);
      }
    }
  }

  const weeklyDefaults = Array.from(weeklyGroupMap.values())
    .map((group) => {
      const statsList = Array.from(group.actionStats.values())
        .map((item) => ({
          ...item,
          totalPnl: round(item.totalPnl, 2),
          avgPnl: round(item.totalPnl / item.count, 2),
          winRatePct: round((item.positiveDays / item.count) * 100, 2)
        }));
      const comboFull = statsList.find((item) => item.action.type === 'combo_full') ?? null;
      if (!comboFull) {
        throw new Error(`weekly default combo_full missing: ${group.weeklyFeatureKey}`);
      }
      return {
        weeklyFeatureKey: group.weeklyFeatureKey,
        comboLabel: group.comboLabel,
        candidateActions: statsList,
        selectedAction: comboFull
      };
    })
    .sort((left, right) => (right.selectedAction?.totalPnl ?? 0) - (left.selectedAction?.totalPnl ?? 0));

  const weeklyDefaultMap = new Map(weeklyDefaults.map((entry) => [entry.weeklyFeatureKey, entry]));

  const exactOverlays = Array.from(exactGroupMap.values())
    .map((group) => {
      const statsList = Array.from(group.actionStats.values())
        .map((item) => ({
          ...item,
          totalPnl: round(item.totalPnl, 2),
          avgPnl: round(item.totalPnl / item.count, 2),
          winRatePct: round((item.positiveDays / item.count) * 100, 2)
        }));
      const weeklyDefault = weeklyDefaultMap.get(group.weeklyFeatureKey)?.selectedAction ?? null;
      const entryMeta = {
        overlayKey: group.overlayKey,
        weeklyFeatureKey: group.weeklyFeatureKey,
        dailyFeatureKey: group.dailyFeatureKey,
        comboLabel: group.comboLabel,
        sampleCount: statsList[0]?.count ?? 0,
        candidateActions: statsList
      };
      const selected = chooseEligibleExactAction(statsList, entryMeta, weeklyDefault, thresholds);
      return {
        ...entryMeta,
        selectedAction: selected
      };
    })
    .filter((entry) => entry.selectedAction)
    .sort((left, right) => (right.selectedAction?.totalPnl ?? 0) - (left.selectedAction?.totalPnl ?? 0));

  return {
    weeklyDefaults,
    exactOverlays
  };
}

function applyAction(day, action) {
  if (!action) {
    return {
      actionType: 'combo_full',
      routedPnl: day.comboPnl,
      selectedStrategyName: null,
      selectedStrategyLabel: null,
      riskMultiplier: 1
    };
  }

  if (action.action.type === 'stop') {
    return {
      actionType: 'stop',
      routedPnl: 0,
      selectedStrategyName: null,
      selectedStrategyLabel: null,
      riskMultiplier: 0
    };
  }

  if (action.action.type === 'combo_half') {
    return {
      actionType: 'combo_half',
      routedPnl: round(day.comboPnl * 0.5, 2),
      selectedStrategyName: null,
      selectedStrategyLabel: null,
      riskMultiplier: 0.5
    };
  }

  if (action.action.type === 'strategy') {
    const selected = day.comboStrategies.find((item) => item.strategyName === action.action.strategyName) ?? null;
    return {
      actionType: 'strategy',
      routedPnl: round(selected?.pnl ?? 0, 2),
      selectedStrategyName: selected?.strategyName ?? action.action.strategyName,
      selectedStrategyLabel: selected?.shortLabel ?? action.action.shortLabel ?? null,
      riskMultiplier: 1
    };
  }

  return {
    actionType: 'combo_full',
    routedPnl: day.comboPnl,
    selectedStrategyName: null,
    selectedStrategyLabel: null,
    riskMultiplier: 1
  };
}

function summarizePnls(values) {
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const value of values) {
    cumulative += value;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }

  return {
    totalPnl: round(values.reduce((sum, value) => sum + value, 0), 2),
    positiveDays: values.filter((value) => value > 0).length,
    negativeDays: values.filter((value) => value < 0).length,
    tradedDays: values.filter((value) => value !== 0).length,
    maxDrawdown: round(maxDrawdown, 2)
  };
}

function buildValidationRows(validationDayRows, overlayPolicy) {
  const exactMap = new Map(overlayPolicy.exactOverlays.map((entry) => [entry.overlayKey, entry.selectedAction]));

  return validationDayRows.map((day) => {
    const overlayKey = `${day.weeklyFeatureKey}__${day.dailyFeatureKey}`;
    const exactAction = exactMap.get(overlayKey) ?? null;
    const applied = applyAction(day, exactAction);

    return {
      day: day.day,
      week: day.week,
      weeklyFeatureKey: day.weeklyFeatureKey,
      dailyFeatureKey: day.dailyFeatureKey,
      comboLabel: day.weeklyComboLabel,
      baselineComboPnl: day.comboPnl,
      overlayActionType: applied.actionType,
      overlaySource: exactAction ? 'exact' : 'combo_full',
      selectedStrategyName: applied.selectedStrategyName,
      selectedStrategyLabel: applied.selectedStrategyLabel,
      effectiveRiskMultiplier: applied.riskMultiplier,
      routedPnl: applied.routedPnl,
      positiveStrategies: day.positiveStrategies,
      negativeStrategies: day.negativeStrategies
    };
  });
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# ${report.symbol} Weekly Main + Daily Overlay`);
  lines.push('');
  lines.push(`- Weekly pipeline: \`${report.weeklyPipeline}\``);
  lines.push(`- Training period: \`${report.training.startMonth}\` -> \`${report.training.endMonth}\``);
  lines.push(`- Validation period: \`${report.validation.startMonth}\` -> \`${report.validation.endMonth}\``);
  lines.push(`- Strategy pool size: \`${report.strategyPoolSize}\``);
  lines.push(`- Weekly feature keys: \`${report.weeklyPolicyKeys}\``);
  lines.push(`- Daily exact overlays: \`${report.overlayPolicy.exactOverlays.length}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Weekly combo baseline PnL: \`${report.validation.summary.baseline.totalPnl}\``);
  lines.push(`- Daily overlay routed PnL: \`${report.validation.summary.overlay.totalPnl}\``);
  lines.push(`- Delta: \`${round(report.validation.summary.overlay.totalPnl - report.validation.summary.baseline.totalPnl, 2)}\``);
  lines.push(`- Baseline max drawdown: \`${report.validation.summary.baseline.maxDrawdown}\``);
  lines.push(`- Overlay max drawdown: \`${report.validation.summary.overlay.maxDrawdown}\``);
  lines.push('');
  lines.push('## Weekly Default Actions');
  lines.push('');
  lines.push('| Weekly Feature Key | Selected Action | Total PnL | Avg PnL | Win Rate % |');
  lines.push('| --- | --- | ---: | ---: | ---: |');
  for (const entry of report.overlayPolicy.weeklyDefaults) {
    const action = entry.selectedAction;
    const actionLabel = action.action.type === 'strategy'
      ? `strategy:${action.action.shortLabel}`
      : action.action.type;
    lines.push(`| ${entry.weeklyFeatureKey} | ${actionLabel} | ${action.totalPnl} | ${action.avgPnl} | ${action.winRatePct} |`);
  }
  lines.push('');
  lines.push('## Exact Daily Overlays');
  lines.push('');
  lines.push('| Overlay Key | Samples | Selected Action | Total PnL | Avg PnL | Win Rate % |');
  lines.push('| --- | ---: | --- | ---: | ---: | ---: |');
  for (const entry of report.overlayPolicy.exactOverlays.slice(0, 60)) {
    const action = entry.selectedAction;
    const actionLabel = action.action.type === 'strategy'
      ? `strategy:${action.action.shortLabel}`
      : action.action.type;
    lines.push(`| ${entry.overlayKey} | ${entry.sampleCount} | ${actionLabel} | ${action.totalPnl} | ${action.avgPnl} | ${action.winRatePct} |`);
  }
  lines.push('');
  lines.push('## 2026 Daily Validation');
  lines.push('');
  lines.push('| Day | Week | Weekly Feature Key | Daily Feature Key | Baseline Combo PnL | Overlay Action | Source | Routed PnL |');
  lines.push('| --- | --- | --- | --- | ---: | --- | --- | ---: |');
  for (const row of report.validation.days) {
    const actionLabel = row.overlayActionType === 'strategy'
      ? `strategy:${row.selectedStrategyLabel ?? row.selectedStrategyName ?? '-'}`
      : row.overlayActionType;
    lines.push(`| ${row.day} | ${row.week} | ${row.weeklyFeatureKey} | ${row.dailyFeatureKey} | ${row.baselineComboPnl} | ${actionLabel} | ${row.overlaySource} | ${row.routedPnl} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const weeklyPipelinePath = path.resolve(required(args, 'weeklyPipeline'));
  const thresholds = {
    minExactCount: Number(args.minExactCount || '3'),
    minStrategyImprovement: Number(args.minStrategyImprovement || '150'),
    minHalfImprovement: Number(args.minHalfImprovement || '250'),
    minStopCount: Number(args.minStopCount || '4'),
    minStopImprovement: Number(args.minStopImprovement || '500'),
    minStopAvgLoss: Number(args.minStopAvgLoss || '100'),
    maxStopPositiveRate: Number(args.maxStopPositiveRate || '0.25')
  };
  const weeklyPipeline = loadJson(weeklyPipelinePath);
  const symbol = String(weeklyPipeline.symbol).toUpperCase();
  const templatePath = path.resolve(ROOT_DIR, weeklyPipeline.templateConfig);
  const template = loadJson(templatePath);
  const strategyPoolPath = path.resolve(ROOT_DIR, weeklyPipeline.generated.strategyPoolSnapshot);
  const strategyPool = loadJson(strategyPoolPath);
  const explicitStrategies = strategyPool.strategies.map((strategy) => ({
    strategyName: strategy.strategyName,
    strategyType: strategy.strategyType,
    shortLabel: strategy.shortLabel,
    parameters: strategy.parameters
  }));

  const trainingStartMonth = args.trainStartMonth || weeklyPipeline.training.startMonth;
  const trainingEndMonth = args.trainEndMonth || weeklyPipeline.training.endMonth;
  const validationStartMonth = args.validateStartMonth || weeklyPipeline.validation.startMonth;
  const validationEndMonth = args.validateEndMonth || weeklyPipeline.validation.endMonth;

  ensureDir(GENERATED_DIR);
  ensureDir(REPORT_DIR);

  const connection = await connect();
  try {
    const trainingRange = buildTimeRange(
      startOfUtcMonth(parseMonth(trainingStartMonth)),
      endOfUtcMonth(parseMonth(trainingEndMonth))
    );
    const validationRange = buildTimeRange(
      startOfUtcMonth(parseMonth(validationStartMonth)),
      endOfUtcMonth(parseMonth(validationEndMonth))
    );

    const trainingResultGroup = `${symbol.toLowerCase()}_daily_overlay_train_${trainingStartMonth.replace('-', '_')}_${trainingEndMonth.replace('-', '_')}`;
    const trainingConfig = buildValidationConfig(
      template,
      `${symbol}_DAILY_OVERLAY_TRAIN_${trainingStartMonth.replace('-', '_')}_${trainingEndMonth.replace('-', '_')}`,
      `${symbol} daily overlay train pool`,
      trainingRange,
      trainingResultGroup,
      explicitStrategies
    );
    const trainingConfigPath = path.join(GENERATED_DIR, `${symbol.toLowerCase()}_${trainingStartMonth.replace('-', '_')}_${trainingEndMonth.replace('-', '_')}_overlay_train_pool.json`);
    writeJson(trainingConfigPath, trainingConfig);

    console.log(`\n[daily-overlay] validating training pool ${trainingStartMonth} -> ${trainingEndMonth} ...`);
    runTrainConfig(path.relative(ROOT_DIR, trainingConfigPath));

    const strategyNames = explicitStrategies.map((strategy) => strategy.strategyName);
    const trainingTradeBatch = await findTradeBatch(connection, strategyNames, symbol, trainingRange);
    const [trainingTrades, trainingKlines] = await Promise.all([
      loadTrades(connection, strategyNames, symbol, trainingRange, trainingTradeBatch),
      loadKlines(connection, symbol, trainingRange)
    ]);

    const trainingDayRows = buildTrainingDayRows(
      buildDailyFeatures(trainingKlines),
      buildWeeklyFeatures(trainingKlines),
      weeklyPipeline.policyMap,
      buildStrategyPnlByDay(trainingTrades)
    );
    const overlayPolicy = buildOverlayPolicy(trainingDayRows, thresholds);

    const validationResultGroup = `${symbol.toLowerCase()}_daily_overlay_validate_${validationStartMonth.replace('-', '_')}_${validationEndMonth.replace('-', '_')}`;
    const validationConfig = buildValidationConfig(
      template,
      `${symbol}_DAILY_OVERLAY_VALIDATE_${validationStartMonth.replace('-', '_')}_${validationEndMonth.replace('-', '_')}`,
      `${symbol} daily overlay validation pool`,
      validationRange,
      validationResultGroup,
      explicitStrategies
    );
    const validationConfigPath = path.join(GENERATED_DIR, `${symbol.toLowerCase()}_${validationStartMonth.replace('-', '_')}_${validationEndMonth.replace('-', '_')}_overlay_validate_pool.json`);
    writeJson(validationConfigPath, validationConfig);

    console.log(`\n[daily-overlay] validating 2026 pool ${validationStartMonth} -> ${validationEndMonth} ...`);
    runTrainConfig(path.relative(ROOT_DIR, validationConfigPath));

    const validationTradeBatch = await findTradeBatch(connection, strategyNames, symbol, validationRange);
    const [validationTrades, validationKlines] = await Promise.all([
      loadTrades(connection, strategyNames, symbol, validationRange, validationTradeBatch),
      loadKlines(connection, symbol, validationRange)
    ]);

    const validationDayRows = buildTrainingDayRows(
      buildDailyFeatures(validationKlines),
      buildWeeklyFeatures(validationKlines),
      weeklyPipeline.policyMap,
      buildStrategyPnlByDay(validationTrades)
    );
    const validationRows = buildValidationRows(validationDayRows, overlayPolicy);
    const baselineSummary = summarizePnls(validationRows.map((row) => row.baselineComboPnl));
    const overlaySummary = summarizePnls(validationRows.map((row) => row.routedPnl));

    const report = {
      symbol,
      generatedAt: new Date().toISOString(),
      weeklyPipeline: path.relative(ROOT_DIR, weeklyPipelinePath),
      strategyPoolSize: explicitStrategies.length,
      weeklyPolicyKeys: weeklyPipeline.policyMap.length,
      training: {
        startMonth: trainingStartMonth,
        endMonth: trainingEndMonth,
        tradeBatch: trainingTradeBatch,
        generatedValidationConfig: path.relative(ROOT_DIR, trainingConfigPath),
        days: trainingDayRows.length
      },
      overlayThresholds: thresholds,
      overlayPolicy,
      validation: {
        startMonth: validationStartMonth,
        endMonth: validationEndMonth,
        tradeBatch: validationTradeBatch,
        generatedValidationConfig: path.relative(ROOT_DIR, validationConfigPath),
        days: validationRows,
        summary: {
          baseline: baselineSummary,
          overlay: overlaySummary
        }
      }
    };

    const prefix = `${symbol}_${trainingStartMonth.replace('-', '_')}_${trainingEndMonth.replace('-', '_')}_daily_overlay_on_weekly_combo`;
    const jsonPath = path.join(REPORT_DIR, `${prefix}.json`);
    const mdPath = path.join(REPORT_DIR, `${prefix}.md`);
    writeJson(jsonPath, report);
    fs.writeFileSync(mdPath, buildMarkdown(report), 'utf8');

    console.log(`\n[daily-overlay] JSON written: ${jsonPath}`);
    console.log(`[daily-overlay] MD written: ${mdPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[daily-overlay] failed: ${error.stack || error.message}`);
  process.exit(1);
});
