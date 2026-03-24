#!/usr/bin/env node
/**
 * Generic volatility analyzer for JPY-quoted symbols.
 *
 * Usage:
 *   node train/scripts/analyze-volatility.js --symbol ETHJPY
 *   node train/scripts/analyze-volatility.js --symbol BTCJPY
 *   node train/scripts/analyze-volatility.js --symbol SOLJPY
 */

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

const DEFAULT_SYMBOL = 'ETHJPY';
const INTERVAL = '1min';
const YEARS = [2024, 2025, 2026];
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const FETCH_LIMIT = 50000;
const REPORT_DIR = path.resolve(__dirname, '../reports/volatility');

function parseArgs(argv) {
  const result = { symbol: DEFAULT_SYMBOL };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--symbol' && argv[index + 1]) {
      result.symbol = String(argv[index + 1]).trim().toUpperCase();
      index += 1;
    }
  }

  return result;
}

function normalizeSymbolLabel(symbol) {
  if (symbol.includes('_')) {
    return symbol;
  }
  if (symbol.length > 3) {
    return `${symbol.slice(0, 3)}_${symbol.slice(3)}`;
  }
  return symbol;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toJstParts(timestampMs) {
  const date = new Date(timestampMs + JST_OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    weekday: date.getUTCDay(),
    isoDate: date.toISOString().slice(0, 10),
    isoMonth: date.toISOString().slice(0, 7)
  };
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) {
    return null;
  }
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function createAccumulator() {
  return {
    count: 0,
    sumAbsReturnPct: 0,
    sumRangePct: 0,
    maxAbsReturnPct: 0,
    maxRangePct: 0,
    absReturns: []
  };
}

function pushAccumulator(acc, absReturnPct, rangePct) {
  acc.count += 1;
  acc.sumAbsReturnPct += absReturnPct;
  acc.sumRangePct += rangePct;
  acc.maxAbsReturnPct = Math.max(acc.maxAbsReturnPct, absReturnPct);
  acc.maxRangePct = Math.max(acc.maxRangePct, rangePct);
  acc.absReturns.push(absReturnPct);
}

function finalizeAccumulator(acc) {
  if (!acc || acc.count === 0) {
    return null;
  }
  acc.absReturns.sort((a, b) => a - b);
  return {
    count: acc.count,
    avgAbsReturnPct: round(acc.sumAbsReturnPct / acc.count),
    medianAbsReturnPct: round(percentile(acc.absReturns, 0.5)),
    p90AbsReturnPct: round(percentile(acc.absReturns, 0.9)),
    p95AbsReturnPct: round(percentile(acc.absReturns, 0.95)),
    p99AbsReturnPct: round(percentile(acc.absReturns, 0.99)),
    avgRangePct: round(acc.sumRangePct / acc.count),
    maxAbsReturnPct: round(acc.maxAbsReturnPct),
    maxRangePct: round(acc.maxRangePct)
  };
}

function createDayAccumulator() {
  return {
    count: 0,
    sumSquaredLogReturns: 0,
    sumAbsReturnPct: 0,
    sumRangePct: 0,
    maxAbsReturnPct: 0
  };
}

function finalizeDayEntries(dayMap) {
  return Array.from(dayMap.entries())
    .map(([date, acc]) => ({
      date,
      minutes: acc.count,
      realizedVolPct: round(Math.sqrt(acc.sumSquaredLogReturns) * 100),
      avgAbsReturnPct: round(acc.sumAbsReturnPct / acc.count),
      avgRangePct: round(acc.sumRangePct / acc.count),
      maxAbsReturnPct: round(acc.maxAbsReturnPct)
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function summarizeDailyEntries(entries) {
  const realized = entries.map((entry) => entry.realizedVolPct).filter(Number.isFinite).sort((a, b) => a - b);
  if (!realized.length) {
    return null;
  }
  const hottest = [...entries].sort((a, b) => b.realizedVolPct - a.realizedVolPct).slice(0, 10);
  const calmest = [...entries].sort((a, b) => a.realizedVolPct - b.realizedVolPct).slice(0, 10);
  return {
    avgRealizedVolPct: round(realized.reduce((sum, value) => sum + value, 0) / realized.length),
    medianRealizedVolPct: round(percentile(realized, 0.5)),
    p90RealizedVolPct: round(percentile(realized, 0.9)),
    maxRealizedVolPct: round(realized[realized.length - 1]),
    minRealizedVolPct: round(realized[0]),
    hottestDays: hottest,
    calmestDays: calmest
  };
}

function buildHistogram(values, binCount = 40) {
  const cleanValues = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!cleanValues.length) {
    return { bins: [], maxCount: 0 };
  }
  let maxValue = 0;
  for (const value of cleanValues) {
    if (value > maxValue) {
      maxValue = value;
    }
  }
  const upper = maxValue === 0 ? 1 : maxValue * 1.0001;
  const width = upper / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: index * width,
    end: (index + 1) * width,
    count: 0
  }));

  for (const value of cleanValues) {
    const index = Math.min(Math.floor(value / width), binCount - 1);
    bins[index].count += 1;
  }

  return {
    bins,
    maxCount: bins.reduce((max, bin) => Math.max(max, bin.count), 0)
  };
}

function svgEscape(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function createHistogramSvg(seriesMap, titleSymbol) {
  const width = 1200;
  const height = 720;
  const margin = { top: 70, right: 40, bottom: 90, left: 80 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const colors = ['#d9480f', '#1d4ed8', '#0f766e'];
  const labels = Object.keys(seriesMap);
  const histograms = labels.map((label) => ({
    label,
    color: colors[labels.indexOf(label) % colors.length],
    ...buildHistogram(seriesMap[label])
  }));
  const binCount = histograms[0]?.bins.length ?? 0;
  const maxCount = Math.max(...histograms.map((histogram) => histogram.maxCount), 1);
  const groupWidth = plotWidth / Math.max(binCount, 1);
  const barWidth = Math.max((groupWidth - 4) / Math.max(labels.length, 1), 1);
  const maxX = histograms.reduce((max, histogram) => Math.max(max, histogram.bins.at(-1)?.end ?? 0), 1);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    value: maxCount * (1 - ratio),
    y: margin.top + plotHeight * ratio
  }));

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    value: maxX * ratio,
    x: margin.left + plotWidth * ratio
  }));

  const bars = histograms.flatMap((histogram, seriesIndex) =>
    histogram.bins.map((bin, binIndex) => {
      const x = margin.left + binIndex * groupWidth + seriesIndex * barWidth + 2;
      const barHeight = maxCount === 0 ? 0 : (bin.count / maxCount) * plotHeight;
      const y = margin.top + plotHeight - barHeight;
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" fill="${histogram.color}" opacity="0.75" />`;
    })
  );

  const legend = histograms
    .map((histogram, index) => {
      const x = margin.left + index * 180;
      return `<g transform="translate(${x}, 28)">
  <rect width="16" height="16" fill="${histogram.color}" opacity="0.75" rx="3" />
  <text x="24" y="13" font-size="16" fill="#1f2937">${svgEscape(histogram.label)}</text>
</g>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fffdf8" />
  <text x="${margin.left}" y="24" font-size="28" font-weight="700" fill="#111827">${svgEscape(titleSymbol)} 1-minute Absolute Return Distribution</text>
  <text x="${margin.left}" y="50" font-size="16" fill="#4b5563">Histogram by year, measured as |log return| × 100 (%)</text>
  ${legend}
  <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" stroke="#374151" stroke-width="2" />
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="#374151" stroke-width="2" />
  ${ticks
    .map(
      (tick) => `<g>
  <line x1="${margin.left}" y1="${tick.y.toFixed(2)}" x2="${margin.left + plotWidth}" y2="${tick.y.toFixed(2)}" stroke="#e5e7eb" />
  <text x="${margin.left - 12}" y="${(tick.y + 5).toFixed(2)}" text-anchor="end" font-size="13" fill="#6b7280">${Math.round(tick.value)}</text>
</g>`
    )
    .join('\n')}
  ${xTicks
    .map(
      (tick) => `<g>
  <line x1="${tick.x.toFixed(2)}" y1="${margin.top + plotHeight}" x2="${tick.x.toFixed(2)}" y2="${margin.top + plotHeight + 6}" stroke="#374151" />
  <text x="${tick.x.toFixed(2)}" y="${margin.top + plotHeight + 28}" text-anchor="middle" font-size="13" fill="#6b7280">${tick.value.toFixed(2)}%</text>
</g>`
    )
    .join('\n')}
  ${bars.join('\n')}
  <text x="${margin.left + plotWidth / 2}" y="${height - 24}" text-anchor="middle" font-size="16" fill="#374151">Absolute 1-minute log return (%)</text>
  <text x="24" y="${margin.top + plotHeight / 2}" transform="rotate(-90 24 ${margin.top + plotHeight / 2})" text-anchor="middle" font-size="16" fill="#374151">Count</text>
</svg>`;
}

function createMonthlyBarSvg(monthlyRows, titleSymbol) {
  const width = 1400;
  const height = 720;
  const margin = { top: 70, right: 40, bottom: 140, left: 90 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...monthlyRows.map((row) => row.avgAbsReturnPct), 0.01);
  const barWidth = plotWidth / Math.max(monthlyRows.length, 1) - 3;

  const bars = monthlyRows.map((row, index) => {
    const x = margin.left + index * (barWidth + 3);
    const barHeight = (row.avgAbsReturnPct / maxValue) * plotHeight;
    const y = margin.top + plotHeight - barHeight;
    const highlight = row.rankMax ? '#b91c1c' : row.rankMin ? '#1d4ed8' : '#f59e0b';
    return `<g>
  <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(barWidth, 1).toFixed(2)}" height="${barHeight.toFixed(2)}" fill="${highlight}" opacity="0.82" rx="2" />
  <text x="${(x + barWidth / 2).toFixed(2)}" y="${height - 72}" transform="rotate(60 ${(x + barWidth / 2).toFixed(2)} ${height - 72})" text-anchor="start" font-size="12" fill="#4b5563">${row.month}</text>
</g>`;
  });

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    value: maxValue * (1 - ratio),
    y: margin.top + plotHeight * ratio
  }));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fffdf8" />
  <text x="${margin.left}" y="24" font-size="28" font-weight="700" fill="#111827">${svgEscape(titleSymbol)} Monthly Volatility Regime</text>
  <text x="${margin.left}" y="50" font-size="16" fill="#4b5563">Average absolute 1-minute return by month. Red = hottest month, blue = calmest month.</text>
  <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" stroke="#374151" stroke-width="2" />
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="#374151" stroke-width="2" />
  ${yTicks
    .map(
      (tick) => `<g>
  <line x1="${margin.left}" y1="${tick.y.toFixed(2)}" x2="${margin.left + plotWidth}" y2="${tick.y.toFixed(2)}" stroke="#e5e7eb" />
  <text x="${margin.left - 12}" y="${(tick.y + 5).toFixed(2)}" text-anchor="end" font-size="13" fill="#6b7280">${tick.value.toFixed(3)}%</text>
</g>`
    )
    .join('\n')}
  ${bars.join('\n')}
  <text x="${margin.left + plotWidth / 2}" y="${height - 24}" text-anchor="middle" font-size="16" fill="#374151">Month (JST)</text>
  <text x="28" y="${margin.top + plotHeight / 2}" transform="rotate(-90 28 ${margin.top + plotHeight / 2})" text-anchor="middle" font-size="16" fill="#374151">Avg absolute 1-minute return (%)</text>
</svg>`;
}

function createHourlyBarSvg(hourlyRows, titleSymbol) {
  const width = 1200;
  const height = 720;
  const margin = { top: 70, right: 40, bottom: 90, left: 90 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...hourlyRows.map((row) => row.avgAbsReturnPct), 0.01);
  const barWidth = plotWidth / Math.max(hourlyRows.length, 1) - 8;

  const bars = hourlyRows.map((row, index) => {
    const x = margin.left + index * (barWidth + 8);
    const barHeight = (row.avgAbsReturnPct / maxValue) * plotHeight;
    const y = margin.top + plotHeight - barHeight;
    const fill = row.rankMax ? '#b91c1c' : row.rankMin ? '#1d4ed8' : '#0f766e';
    return `<g>
  <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(barWidth, 1).toFixed(2)}" height="${barHeight.toFixed(2)}" fill="${fill}" opacity="0.82" rx="3" />
  <text x="${(x + barWidth / 2).toFixed(2)}" y="${margin.top + plotHeight + 24}" text-anchor="middle" font-size="13" fill="#4b5563">${row.hour}:00</text>
</g>`;
  });

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    value: maxValue * (1 - ratio),
    y: margin.top + plotHeight * ratio
  }));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fffdf8" />
  <text x="${margin.left}" y="24" font-size="28" font-weight="700" fill="#111827">${svgEscape(titleSymbol)} Intraday Volatility (JST)</text>
  <text x="${margin.left}" y="50" font-size="16" fill="#4b5563">Average absolute 1-minute return by JST hour. Red = hottest hour, blue = calmest hour.</text>
  <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" stroke="#374151" stroke-width="2" />
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="#374151" stroke-width="2" />
  ${yTicks
    .map(
      (tick) => `<g>
  <line x1="${margin.left}" y1="${tick.y.toFixed(2)}" x2="${margin.left + plotWidth}" y2="${tick.y.toFixed(2)}" stroke="#e5e7eb" />
  <text x="${margin.left - 12}" y="${(tick.y + 5).toFixed(2)}" text-anchor="end" font-size="13" fill="#6b7280">${tick.value.toFixed(3)}%</text>
</g>`
    )
    .join('\n')}
  ${bars.join('\n')}
  <text x="${margin.left + plotWidth / 2}" y="${height - 24}" text-anchor="middle" font-size="16" fill="#374151">Hour of day (JST)</text>
  <text x="28" y="${margin.top + plotHeight / 2}" transform="rotate(-90 28 ${margin.top + plotHeight / 2})" text-anchor="middle" font-size="16" fill="#374151">Avg absolute 1-minute return (%)</text>
</svg>`;
}

function formatTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((column) => column.format(row[column.key], row)).join(' | ')} |`).join('\n');
  return [header, divider, body].filter(Boolean).join('\n');
}

function defaultFormat(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return String(value);
}

function summarizeExtremes(rows, key) {
  const sorted = [...rows].sort((a, b) => b[key] - a[key]);
  return {
    max: sorted[0],
    min: sorted[sorted.length - 1]
  };
}

async function fetchRows(connection, symbol) {
  const rows = [];
  let lastOpenTime = 0;

  while (true) {
    const [batch] = await connection.query(
      `
        SELECT
          open_time,
          CAST((bid_open + ask_open) / 2 AS DOUBLE) AS mid_open,
          CAST((bid_high + ask_high) / 2 AS DOUBLE) AS mid_high,
          CAST((bid_low + ask_low) / 2 AS DOUBLE) AS mid_low,
          CAST((bid_close + ask_close) / 2 AS DOUBLE) AS mid_close
        FROM klines
        WHERE symbol = ?
          AND interval_type = ?
          AND open_time > ?
        ORDER BY open_time ASC
        LIMIT ${FETCH_LIMIT}
      `,
      [symbol, INTERVAL, lastOpenTime]
    );

    if (!batch.length) {
      break;
    }

    rows.push(...batch);
    lastOpenTime = batch[batch.length - 1].open_time;
  }

  return rows;
}

function analyzeRows(rows) {
  const yearAccumulators = new Map();
  const monthAccumulators = new Map();
  const hourAccumulators = new Map();
  const weekdayAccumulators = new Map();
  const yearHourAccumulators = new Map();
  const dayAccumulators = new Map();
  const yearDayAccumulators = new Map();
  const histogramValues = new Map(YEARS.map((year) => [String(year), []]));
  const coverage = {};

  let previousClose = null;
  let previousYear = null;

  for (const row of rows) {
    const ts = Number(row.open_time);
    const parts = toJstParts(ts);
    const midOpen = Number(row.mid_open);
    const midHigh = Number(row.mid_high);
    const midLow = Number(row.mid_low);
    const midClose = Number(row.mid_close);
    const hasValidBar = [midOpen, midHigh, midLow, midClose].every((value) => Number.isFinite(value) && value > 0);

    if (!hasValidBar) {
      previousClose = null;
      previousYear = parts.year;
      continue;
    }

    if (!YEARS.includes(parts.year)) {
      previousClose = midClose;
      previousYear = parts.year;
      continue;
    }

    if (!coverage[parts.year]) {
      coverage[parts.year] = {
        firstTimestampJst: new Date(ts + JST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 19),
        lastTimestampJst: null
      };
    }
    coverage[parts.year].lastTimestampJst = new Date(ts + JST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 19);

    const rangePct = midOpen > 0 ? ((midHigh - midLow) / midOpen) * 100 : 0;

    if (!previousClose || previousClose <= 0 || previousYear === null) {
      previousClose = midClose;
      previousYear = parts.year;
      continue;
    }

    const logReturn = Math.log(midClose / previousClose);
    const absReturnPct = Math.abs(logReturn) * 100;
    if (!Number.isFinite(logReturn) || !Number.isFinite(absReturnPct)) {
      previousClose = midClose;
      previousYear = parts.year;
      continue;
    }

    const yearKey = String(parts.year);
    const monthKey = parts.isoMonth;
    const hourKey = String(parts.hour).padStart(2, '0');
    const weekdayKey = String(parts.weekday);
    const yearHourKey = `${yearKey}-${hourKey}`;
    const dayKey = parts.isoDate;

    if (!yearAccumulators.has(yearKey)) yearAccumulators.set(yearKey, createAccumulator());
    if (!monthAccumulators.has(monthKey)) monthAccumulators.set(monthKey, createAccumulator());
    if (!hourAccumulators.has(hourKey)) hourAccumulators.set(hourKey, createAccumulator());
    if (!weekdayAccumulators.has(weekdayKey)) weekdayAccumulators.set(weekdayKey, createAccumulator());
    if (!yearHourAccumulators.has(yearHourKey)) yearHourAccumulators.set(yearHourKey, createAccumulator());
    if (!dayAccumulators.has(dayKey)) dayAccumulators.set(dayKey, createDayAccumulator());
    if (!yearDayAccumulators.has(yearKey)) yearDayAccumulators.set(yearKey, new Map());
    if (!yearDayAccumulators.get(yearKey).has(dayKey)) yearDayAccumulators.get(yearKey).set(dayKey, createDayAccumulator());

    pushAccumulator(yearAccumulators.get(yearKey), absReturnPct, rangePct);
    pushAccumulator(monthAccumulators.get(monthKey), absReturnPct, rangePct);
    pushAccumulator(hourAccumulators.get(hourKey), absReturnPct, rangePct);
    pushAccumulator(weekdayAccumulators.get(weekdayKey), absReturnPct, rangePct);
    pushAccumulator(yearHourAccumulators.get(yearHourKey), absReturnPct, rangePct);

    const dayAcc = dayAccumulators.get(dayKey);
    dayAcc.count += 1;
    dayAcc.sumSquaredLogReturns += logReturn * logReturn;
    dayAcc.sumAbsReturnPct += absReturnPct;
    dayAcc.sumRangePct += rangePct;
    dayAcc.maxAbsReturnPct = Math.max(dayAcc.maxAbsReturnPct, absReturnPct);

    const yearDayAcc = yearDayAccumulators.get(yearKey).get(dayKey);
    yearDayAcc.count += 1;
    yearDayAcc.sumSquaredLogReturns += logReturn * logReturn;
    yearDayAcc.sumAbsReturnPct += absReturnPct;
    yearDayAcc.sumRangePct += rangePct;
    yearDayAcc.maxAbsReturnPct = Math.max(yearDayAcc.maxAbsReturnPct, absReturnPct);

    histogramValues.get(yearKey).push(absReturnPct);
    previousClose = midClose;
    previousYear = parts.year;
  }

  const years = YEARS.map((year) => {
    const yearKey = String(year);
    return {
      year,
      coverage: coverage[year] ?? null,
      stats: finalizeAccumulator(yearAccumulators.get(yearKey)),
      dailySummary: summarizeDailyEntries(finalizeDayEntries(yearDayAccumulators.get(yearKey) ?? new Map()))
    };
  });

  const months = Array.from(monthAccumulators.entries())
    .map(([month, acc]) => ({
      month,
      year: Number(month.slice(0, 4)),
      ...finalizeAccumulator(acc)
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const hourly = Array.from(hourAccumulators.entries())
    .map(([hour, acc]) => ({
      hour,
      hourNumber: Number(hour),
      ...finalizeAccumulator(acc)
    }))
    .sort((a, b) => a.hourNumber - b.hourNumber);

  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdays = Array.from(weekdayAccumulators.entries())
    .map(([weekday, acc]) => ({
      weekday: weekdayNames[Number(weekday)],
      weekdayNumber: Number(weekday),
      ...finalizeAccumulator(acc)
    }))
    .sort((a, b) => a.weekdayNumber - b.weekdayNumber);

  const yearHour = Array.from(yearHourAccumulators.entries())
    .map(([key, acc]) => {
      const [year, hour] = key.split('-');
      return {
        year: Number(year),
        hour,
        hourNumber: Number(hour),
        ...finalizeAccumulator(acc)
      };
    })
    .sort((a, b) => (a.year - b.year) || (a.hourNumber - b.hourNumber));

  const daily = finalizeDayEntries(dayAccumulators);
  const dailySummary = summarizeDailyEntries(daily);

  return {
    years,
    months,
    hourly,
    weekdays,
    yearHour,
    daily,
    dailySummary,
    histograms: Object.fromEntries(Array.from(histogramValues.entries()).map(([year, values]) => [year, values]))
  };
}

function buildMarkdownReport(analysis, options) {
  const symbolLabel = normalizeSymbolLabel(options.symbol);
  const monthExtremes = summarizeExtremes(analysis.months, 'avgAbsReturnPct');
  const hourExtremes = summarizeExtremes(analysis.hourly, 'avgAbsReturnPct');
  const weekdayExtremes = summarizeExtremes(analysis.weekdays, 'avgAbsReturnPct');

  for (const row of analysis.months) {
    row.rankMax = row.month === monthExtremes.max.month;
    row.rankMin = row.month === monthExtremes.min.month;
  }
  for (const row of analysis.hourly) {
    row.rankMax = row.hour === hourExtremes.max.hour;
    row.rankMin = row.hour === hourExtremes.min.hour;
  }

  const lines = [];
  lines.push(`# ${symbolLabel} 波动率分析报告（2024-2026）`);
  lines.push('');
  lines.push('## 范围与方法');
  lines.push('');
  lines.push(`- 标的: \`${options.symbol}\``);
  lines.push(`- 周期: \`${INTERVAL}\` K 线`);
  lines.push(`- 分析年份: ${YEARS.join('、')}（其中 2026 年是截至数据最新时间的部分样本）`);
  lines.push('- 时区: JST（Asia/Tokyo）');
  lines.push('- 主指标: 每分钟绝对对数收益 `|ln(close_t / close_{t-1})| × 100`，单位为百分比');
  lines.push('- 辅助指标: 每分钟振幅 `(high - low) / open × 100`，用于交叉验证');
  lines.push('');
  lines.push('## 核心结论');
  lines.push('');
  lines.push(`- 全样本月度波动最高的月份是 **${monthExtremes.max.month}**，月均 1 分钟绝对收益为 **${monthExtremes.max.avgAbsReturnPct}%**。`);
  lines.push(`- 全样本月度波动最低的月份是 **${monthExtremes.min.month}**，月均 1 分钟绝对收益为 **${monthExtremes.min.avgAbsReturnPct}%**。`);
  lines.push(`- 全样本日内波动最高的 JST 小时是 **${hourExtremes.max.hour}:00-${String(Number(hourExtremes.max.hour) + 1).padStart(2, '0')}:00**，小时均值 **${hourExtremes.max.avgAbsReturnPct}%**。`);
  lines.push(`- 全样本日内波动最低的 JST 小时是 **${hourExtremes.min.hour}:00-${String(Number(hourExtremes.min.hour) + 1).padStart(2, '0')}:00**，小时均值 **${hourExtremes.min.avgAbsReturnPct}%**。`);
  lines.push(`- 全样本按日实现波动率计算，最剧烈的一天是 **${analysis.dailySummary.hottestDays[0].date}**，日实现波动率 **${analysis.dailySummary.hottestDays[0].realizedVolPct}%**。`);
  lines.push(`- 全样本最平静的一天是 **${analysis.dailySummary.calmestDays[0].date}**，日实现波动率 **${analysis.dailySummary.calmestDays[0].realizedVolPct}%**。`);
  lines.push(`- 星期维度上，平均波动最高的是 **${weekdayExtremes.max.weekday}**，最低的是 **${weekdayExtremes.min.weekday}**。`);
  lines.push('');
  lines.push('## 年度摘要');
  lines.push('');

  const yearRows = analysis.years.map((entry) => ({
    year: entry.year,
    coverage: entry.coverage ? `${entry.coverage.firstTimestampJst} ~ ${entry.coverage.lastTimestampJst}` : '无数据',
    avgAbsReturnPct: entry.stats?.avgAbsReturnPct ?? null,
    medianAbsReturnPct: entry.stats?.medianAbsReturnPct ?? null,
    p95AbsReturnPct: entry.stats?.p95AbsReturnPct ?? null,
    avgRangePct: entry.stats?.avgRangePct ?? null,
    avgRealizedVolPct: entry.dailySummary?.avgRealizedVolPct ?? null,
    maxRealizedVolPct: entry.dailySummary?.maxRealizedVolPct ?? null,
    minRealizedVolPct: entry.dailySummary?.minRealizedVolPct ?? null
  }));

  lines.push(
    formatTable(yearRows, [
      { key: 'year', label: 'Year', format: defaultFormat },
      { key: 'coverage', label: 'Coverage (JST)', format: defaultFormat },
      { key: 'avgAbsReturnPct', label: 'Avg Abs 1m Return %', format: defaultFormat },
      { key: 'medianAbsReturnPct', label: 'Median %', format: defaultFormat },
      { key: 'p95AbsReturnPct', label: 'P95 %', format: defaultFormat },
      { key: 'avgRangePct', label: 'Avg 1m Range %', format: defaultFormat },
      { key: 'avgRealizedVolPct', label: 'Avg Daily RV %', format: defaultFormat },
      { key: 'maxRealizedVolPct', label: 'Max Daily RV %', format: defaultFormat },
      { key: 'minRealizedVolPct', label: 'Min Daily RV %', format: defaultFormat }
    ])
  );
  lines.push('');

  for (const yearEntry of analysis.years) {
    const yearMonths = analysis.months.filter((row) => row.year === yearEntry.year);
    if (!yearMonths.length) {
      continue;
    }
    const yearMonthExtremes = summarizeExtremes(yearMonths, 'avgAbsReturnPct');
    const yearHourRows = analysis.yearHour.filter((row) => row.year === yearEntry.year);
    const yearHourExtremes = summarizeExtremes(yearHourRows, 'avgAbsReturnPct');
    lines.push(`### ${yearEntry.year}`);
    lines.push('');
    lines.push(`- 月度最热区间: **${yearMonthExtremes.max.month}**，月均 1 分钟绝对收益 **${yearMonthExtremes.max.avgAbsReturnPct}%**。`);
    lines.push(`- 月度最冷区间: **${yearMonthExtremes.min.month}**，月均 1 分钟绝对收益 **${yearMonthExtremes.min.avgAbsReturnPct}%**。`);
    lines.push(`- 日内最热时段: **${yearHourExtremes.max.hour}:00-${String(Number(yearHourExtremes.max.hour) + 1).padStart(2, '0')}:00 JST**，均值 **${yearHourExtremes.max.avgAbsReturnPct}%**。`);
    lines.push(`- 日内最冷时段: **${yearHourExtremes.min.hour}:00-${String(Number(yearHourExtremes.min.hour) + 1).padStart(2, '0')}:00 JST**，均值 **${yearHourExtremes.min.avgAbsReturnPct}%**。`);
    if (yearEntry.dailySummary) {
      lines.push(`- 日波动最高: **${yearEntry.dailySummary.hottestDays[0].date}**，实现波动率 **${yearEntry.dailySummary.hottestDays[0].realizedVolPct}%**。`);
      lines.push(`- 日波动最低: **${yearEntry.dailySummary.calmestDays[0].date}**，实现波动率 **${yearEntry.dailySummary.calmestDays[0].realizedVolPct}%**。`);
    }
    lines.push('');
  }

  lines.push('## 月度波动排名');
  lines.push('');
  lines.push(
    formatTable(analysis.months, [
      { key: 'month', label: 'Month', format: defaultFormat },
      { key: 'avgAbsReturnPct', label: 'Avg Abs 1m Return %', format: defaultFormat },
      { key: 'medianAbsReturnPct', label: 'Median %', format: defaultFormat },
      { key: 'p95AbsReturnPct', label: 'P95 %', format: defaultFormat },
      { key: 'avgRangePct', label: 'Avg 1m Range %', format: defaultFormat },
      { key: 'maxAbsReturnPct', label: 'Max 1m Shock %', format: defaultFormat }
    ])
  );
  lines.push('');

  lines.push('## 日内时段波动（JST）');
  lines.push('');
  lines.push(
    formatTable(analysis.hourly, [
      { key: 'hour', label: 'Hour', format: (value) => `${value}:00` },
      { key: 'avgAbsReturnPct', label: 'Avg Abs 1m Return %', format: defaultFormat },
      { key: 'medianAbsReturnPct', label: 'Median %', format: defaultFormat },
      { key: 'p95AbsReturnPct', label: 'P95 %', format: defaultFormat },
      { key: 'avgRangePct', label: 'Avg 1m Range %', format: defaultFormat },
      { key: 'maxAbsReturnPct', label: 'Max 1m Shock %', format: defaultFormat }
    ])
  );
  lines.push('');

  lines.push('## 星期维度（JST）');
  lines.push('');
  lines.push(
    formatTable(analysis.weekdays, [
      { key: 'weekday', label: 'Weekday', format: defaultFormat },
      { key: 'avgAbsReturnPct', label: 'Avg Abs 1m Return %', format: defaultFormat },
      { key: 'medianAbsReturnPct', label: 'Median %', format: defaultFormat },
      { key: 'p95AbsReturnPct', label: 'P95 %', format: defaultFormat },
      { key: 'avgRangePct', label: 'Avg 1m Range %', format: defaultFormat }
    ])
  );
  lines.push('');

  lines.push('## 最高波动日 Top 10');
  lines.push('');
  lines.push(
    formatTable(analysis.dailySummary.hottestDays, [
      { key: 'date', label: 'Date', format: defaultFormat },
      { key: 'realizedVolPct', label: 'Daily RV %', format: defaultFormat },
      { key: 'avgAbsReturnPct', label: 'Avg Abs 1m Return %', format: defaultFormat },
      { key: 'avgRangePct', label: 'Avg 1m Range %', format: defaultFormat },
      { key: 'maxAbsReturnPct', label: 'Max 1m Shock %', format: defaultFormat }
    ])
  );
  lines.push('');

  lines.push('## 最低波动日 Top 10');
  lines.push('');
  lines.push(
    formatTable(analysis.dailySummary.calmestDays, [
      { key: 'date', label: 'Date', format: defaultFormat },
      { key: 'realizedVolPct', label: 'Daily RV %', format: defaultFormat },
      { key: 'avgAbsReturnPct', label: 'Avg Abs 1m Return %', format: defaultFormat },
      { key: 'avgRangePct', label: 'Avg 1m Range %', format: defaultFormat },
      { key: 'maxAbsReturnPct', label: 'Max 1m Shock %', format: defaultFormat }
    ])
  );
  lines.push('');

  lines.push('## 可视化建议');
  lines.push('');
  lines.push(`- 分布图: 使用 \`${options.baseName}_volatility_distribution_2024_2026.svg\` 对比 2024、2025、2026 年的 1 分钟绝对收益分布，观察尾部变厚的年份。`);
  lines.push(`- 月度柱状图: 使用 \`${options.baseName}_monthly_volatility_2024_2026.svg\` 看哪几个月份进入高波动 regime。`);
  lines.push(`- 日内柱状图: 使用 \`${options.baseName}_intraday_volatility_jst.svg\` 看 JST 哪个时段更容易出现快速放大波动。`);
  lines.push('- 如果后续要接前端，建议再加两个图: 月度热力图（月份 × 小时）和日实现波动率时间序列图。');
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const symbolLabel = normalizeSymbolLabel(options.symbol);
  const baseName = options.symbol.toLowerCase();
  ensureDir(REPORT_DIR);

  const connection = await createMysqlConnectionWithFallback(mysql, {
    defaults: {
      host: '127.0.0.1'
    }
  });

  try {
    const rows = await fetchRows(connection, options.symbol);
    const analysis = analyzeRows(rows);
    const monthExtremes = summarizeExtremes(analysis.months, 'avgAbsReturnPct');
    const hourExtremes = summarizeExtremes(analysis.hourly, 'avgAbsReturnPct');

    for (const row of analysis.months) {
      row.rankMax = row.month === monthExtremes.max.month;
      row.rankMin = row.month === monthExtremes.min.month;
    }
    for (const row of analysis.hourly) {
      row.rankMax = row.hour === hourExtremes.max.hour;
      row.rankMin = row.hour === hourExtremes.min.hour;
    }

    const markdown = buildMarkdownReport(analysis, {
      symbol: options.symbol,
      baseName
    });
    const distributionBins = Object.fromEntries(
      Object.entries(analysis.histograms).map(([year, values]) => [year, buildHistogram(values)])
    );
    const jsonSummary = {
      years: analysis.years,
      months: analysis.months,
      hourly: analysis.hourly,
      weekdays: analysis.weekdays,
      yearHour: analysis.yearHour,
      dailySummary: analysis.dailySummary,
      hottestDays: analysis.dailySummary.hottestDays,
      calmestDays: analysis.dailySummary.calmestDays,
      distributionBins
    };
    const reportPath = path.join(REPORT_DIR, `${options.symbol}_volatility_report_2024_2026.md`);
    const jsonPath = path.join(REPORT_DIR, `${options.symbol}_volatility_summary_2024_2026.json`);
    const histogramPath = path.join(REPORT_DIR, `${baseName}_volatility_distribution_2024_2026.svg`);
    const monthlyChartPath = path.join(REPORT_DIR, `${baseName}_monthly_volatility_2024_2026.svg`);
    const hourlyChartPath = path.join(REPORT_DIR, `${baseName}_intraday_volatility_jst.svg`);

    fs.writeFileSync(reportPath, markdown, 'utf8');
    fs.writeFileSync(jsonPath, JSON.stringify(jsonSummary, null, 2), 'utf8');
    fs.writeFileSync(histogramPath, createHistogramSvg(analysis.histograms, symbolLabel), 'utf8');
    fs.writeFileSync(monthlyChartPath, createMonthlyBarSvg(analysis.months, symbolLabel), 'utf8');
    fs.writeFileSync(hourlyChartPath, createHourlyBarSvg(analysis.hourly, symbolLabel), 'utf8');

    console.log(`Report written: ${reportPath}`);
    console.log(`Summary JSON written: ${jsonPath}`);
    console.log(`Distribution chart written: ${histogramPath}`);
    console.log(`Monthly chart written: ${monthlyChartPath}`);
    console.log(`Hourly chart written: ${hourlyChartPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
