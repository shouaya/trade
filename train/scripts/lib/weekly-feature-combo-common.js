const { execFileSync } = require('child_process');
const path = require('path');
const mysql = require('mysql2/promise');
const {
  BACKTEST_RESULTS_TABLE,
  createMysqlConnectionWithFallback
} = require('@money/database');

const ROOT_DIR = path.resolve(__dirname, '../..');
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
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

async function loadResultRows(connection, resultGroup, runId, limit = 500) {
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

async function findLatestKlineOpenTime(connection, symbol) {
  const rows = await queryRows(
    connection,
    `SELECT MAX(open_time) AS latest_open_time
     FROM klines
     WHERE symbol = ?
       AND interval_type IN ('1m', '1min')`,
    [symbol]
  );
  const latestOpenTime = Number(rows[0]?.latest_open_time);
  return Number.isFinite(latestOpenTime) && latestOpenTime > 0 ? latestOpenTime : null;
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

function distance(feature, policyEntry) {
  const centroid = policyEntry.centroid;
  const bucketPenalty = policyEntry.featureBucket === feature.featureBucket ? 0 : 3;
  return bucketPenalty
    + Math.abs((centroid.realizedVolPct ?? 0) - feature.realizedVolPct) / 3
    + Math.abs((centroid.periodReturnPct ?? 0) - feature.periodReturnPct) / 2
    + Math.abs((centroid.avgRangePct ?? 0) - feature.avgRangePct) / 0.02
    + Math.abs((centroid.upMinuteRatio ?? 0) - feature.upMinuteRatio) / 8;
}

function matchPolicyForFeature(feature, policyMap) {
  const policyByKey = new Map(policyMap.map((entry) => [entry.featureKey, entry]));
  const exact = policyByKey.get(feature.featureKey) ?? null;
  if (exact) {
    return {
      matchedPolicy: exact,
      matchSource: 'exact',
      matchedDistance: 0
    };
  }

  const nearest = [...policyMap]
    .filter((entry) => entry.selectedCombo)
    .sort((left, right) => distance(feature, left) - distance(feature, right))[0] ?? null;
  return {
    matchedPolicy: nearest,
    matchSource: nearest ? 'nearest' : 'none',
    matchedDistance: nearest ? round(distance(feature, nearest), 4) : null
  };
}

function buildValidationRows(validationWeeks, policyMap, periodStrategyMap) {
  return validationWeeks.map((feature) => {
    const { matchedPolicy, matchSource, matchedDistance } = matchPolicyForFeature(feature, policyMap);
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
      matchedDistance,
      matchSource,
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

module.exports = {
  ROOT_DIR,
  BACKTEST_RESULTS_TABLE,
  round,
  parseMonth,
  startOfUtcMonth,
  endOfUtcMonth,
  buildTimeRange,
  getIsoWeekInfoFromUtcMs,
  getIsoWeekKey,
  enumerateWeeksFromMonths,
  shortLabel,
  strategyToExplicit,
  runTrainConfig,
  connect,
  queryRows,
  findLatestRunId,
  loadResultRows,
  loadKlines,
  findLatestKlineOpenTime,
  computePeriodFeatures,
  buildWeeklyCombos,
  buildPolicyMap,
  buildFinalStrategyPool,
  buildValidationRows,
  summarizeValidation,
  matchPolicyForFeature
};
