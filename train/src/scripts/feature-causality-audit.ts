#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import type * as mysql from 'mysql2/promise';
import db from '../configs/database';
import type { KlineData } from '../types';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEFAULT_OPENING_MINUTES = 60;
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '../../reports/feature-causality');

interface CliArgs {
  readonly symbol: string;
  readonly intervalType: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly openingMinutes: number;
  readonly outputDir?: string;
}

interface PeriodFeature {
  readonly key: string;
  readonly minutes: number;
  readonly returnPct: number;
  readonly realizedVolPct: number;
  readonly avgRangePct: number;
  readonly upMinuteRatio: number;
  readonly featureBucket: string;
}

interface DailyAuditRow {
  readonly day: string;
  readonly fullDay: PeriodFeature;
  readonly openingWindow: PeriodFeature;
  readonly bucketMatched: boolean;
  readonly returnDelta: number;
  readonly volDelta: number;
  readonly rangeDelta: number;
}

function parseTimeArg(value: string, label: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args = argv.slice(2);
  let symbol = '';
  let intervalType = '1min';
  let start = '';
  let end = '';
  let openingMinutes = DEFAULT_OPENING_MINUTES;
  let outputDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg.startsWith('--symbol=')) {
      symbol = arg.slice('--symbol='.length);
      continue;
    }
    if (arg === '--symbol') {
      symbol = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--intervalType=')) {
      intervalType = arg.slice('--intervalType='.length);
      continue;
    }
    if (arg === '--intervalType') {
      intervalType = args[index + 1] ?? '1min';
      index += 1;
      continue;
    }
    if (arg.startsWith('--start=')) {
      start = arg.slice('--start='.length);
      continue;
    }
    if (arg === '--start') {
      start = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--end=')) {
      end = arg.slice('--end='.length);
      continue;
    }
    if (arg === '--end') {
      end = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--openingMinutes=')) {
      openingMinutes = Number(arg.slice('--openingMinutes='.length));
      continue;
    }
    if (arg === '--openingMinutes') {
      openingMinutes = Number(args[index + 1] ?? DEFAULT_OPENING_MINUTES);
      index += 1;
      continue;
    }
    if (arg.startsWith('--outputDir=')) {
      outputDir = arg.slice('--outputDir='.length);
      continue;
    }
    if (arg === '--outputDir') {
      outputDir = args[index + 1] ?? '';
      index += 1;
    }
  }

  if (!symbol) throw new Error('missing --symbol');
  if (!start) throw new Error('missing --start');
  if (!end) throw new Error('missing --end');
  if (!Number.isFinite(openingMinutes) || openingMinutes <= 0) {
    throw new Error('openingMinutes must be > 0');
  }

  return {
    symbol: symbol.toUpperCase(),
    intervalType,
    startTimeMs: parseTimeArg(start, 'start'),
    endTimeMs: parseTimeArg(end, 'end'),
    openingMinutes,
    ...(outputDir ? { outputDir } : {})
  };
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function toJstDate(timestampMs: number): Date {
  return new Date(timestampMs + JST_OFFSET_MS);
}

function getJstDayKey(timestampMs: number): string {
  const date = toJstDate(timestampMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function detectDailyFeatureBucket(returnPct: number, realizedVolPct: number): string {
  if (returnPct <= -2.5 && realizedVolPct >= 2.5) return 'crash-trend';
  if (returnPct >= 2.5 && realizedVolPct >= 2.5) return 'strong-trend';
  if (Math.abs(returnPct) <= 0.8 && realizedVolPct < 2.2) return 'range-low-vol';
  if (Math.abs(returnPct) <= 1.5) return 'range-mid-vol';
  return 'mixed-trend';
}

function correlation(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;

  let numerator = 0;
  let xVar = 0;
  let yVar = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const x = xs[index] ?? 0;
    const y = ys[index] ?? 0;
    numerator += (x - xMean) * (y - yMean);
    xVar += (x - xMean) ** 2;
    yVar += (y - yMean) ** 2;
  }

  if (xVar === 0 || yVar === 0) return 0;
  return round(numerator / Math.sqrt(xVar * yVar), 4);
}

function computeFeature(key: string, klines: readonly KlineData[]): PeriodFeature | null {
  if (!klines.length) return null;

  const firstOpen = Number(klines[0]?.open);
  const lastClose = Number(klines[klines.length - 1]?.close);
  if (!Number.isFinite(firstOpen) || !Number.isFinite(lastClose) || firstOpen <= 0 || lastClose <= 0) {
    return null;
  }

  let sumSquaredLogReturns = 0;
  let sumRangePct = 0;
  let upMinutes = 0;

  for (const row of klines) {
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || open <= 0 || close <= 0) {
      continue;
    }

    const logReturn = Math.log(close / open);
    sumSquaredLogReturns += logReturn * logReturn;
    sumRangePct += ((high - low) / open) * 100;
    if (close > open) {
      upMinutes += 1;
    }
  }

  const realizedVolPct = Math.sqrt(sumSquaredLogReturns) * 100;
  const returnPct = ((lastClose / firstOpen) - 1) * 100;
  return {
    key,
    minutes: klines.length,
    returnPct: round(returnPct, 4),
    realizedVolPct: round(realizedVolPct, 4),
    avgRangePct: round(sumRangePct / klines.length, 4),
    upMinuteRatio: round((upMinutes / klines.length) * 100, 2),
    featureBucket: detectDailyFeatureBucket(returnPct, realizedVolPct)
  };
}

async function loadKlines(args: CliArgs): Promise<readonly KlineData[]> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT
       id,
       open_time,
       CAST((bid_open + ask_open) / 2 AS CHAR) AS open,
       CAST((bid_high + ask_high) / 2 AS CHAR) AS high,
       CAST((bid_low + ask_low) / 2 AS CHAR) AS low,
       CAST((bid_close + ask_close) / 2 AS CHAR) AS close,
       CAST(volume AS CHAR) AS volume,
       symbol,
       interval_type
     FROM klines
     WHERE symbol = ?
       AND interval_type = ?
       AND open_time >= ?
       AND open_time <= ?
     ORDER BY open_time ASC`,
    [args.symbol, args.intervalType, args.startTimeMs, args.endTimeMs]
  );

  if (!rows.length) {
    throw new Error('no klines found for requested symbol/range');
  }

  return rows as KlineData[];
}

function buildDailyAuditRows(klines: readonly KlineData[], openingMinutes: number): readonly DailyAuditRow[] {
  const byDay = new Map<string, KlineData[]>();
  for (const row of klines) {
    const dayKey = getJstDayKey(Number(row.open_time));
    const bucket = byDay.get(dayKey) ?? [];
    bucket.push(row);
    byDay.set(dayKey, bucket);
  }

  const rows: DailyAuditRow[] = [];
  for (const [day, dayRows] of [...byDay.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    if (dayRows.length < openingMinutes) continue;
    const fullDay = computeFeature(day, dayRows);
    const openingWindow = computeFeature(day, dayRows.slice(0, openingMinutes));
    if (!fullDay || !openingWindow) continue;

    rows.push({
      day,
      fullDay,
      openingWindow,
      bucketMatched: fullDay.featureBucket === openingWindow.featureBucket,
      returnDelta: round(fullDay.returnPct - openingWindow.returnPct, 4),
      volDelta: round(fullDay.realizedVolPct - openingWindow.realizedVolPct, 4),
      rangeDelta: round(fullDay.avgRangePct - openingWindow.avgRangePct, 4)
    });
  }

  return rows;
}

function buildMarkdown(args: CliArgs, rows: readonly DailyAuditRow[]): string {
  const bucketMatchRate = rows.length
    ? round((rows.filter((row) => row.bucketMatched).length / rows.length) * 100, 2)
    : 0;
  const signMatchRate = rows.length
    ? round((rows.filter((row) => Math.sign(row.fullDay.returnPct) === Math.sign(row.openingWindow.returnPct)).length / rows.length) * 100, 2)
    : 0;
  const returnCorrelation = correlation(
    rows.map((row) => row.openingWindow.returnPct),
    rows.map((row) => row.fullDay.returnPct)
  );
  const volCorrelation = correlation(
    rows.map((row) => row.openingWindow.realizedVolPct),
    rows.map((row) => row.fullDay.realizedVolPct)
  );
  const rangeCorrelation = correlation(
    rows.map((row) => row.openingWindow.avgRangePct),
    rows.map((row) => row.fullDay.avgRangePct)
  );
  const largestGaps = [...rows]
    .sort((left, right) => (Math.abs(right.volDelta) + Math.abs(right.returnDelta)) - (Math.abs(left.volDelta) + Math.abs(left.returnDelta)))
    .slice(0, 10);

  const lines: string[] = [];
  lines.push(`# ${args.symbol} Feature Causality Audit`);
  lines.push('');
  lines.push(`- Symbol: \`${args.symbol}\``);
  lines.push(`- Interval: \`${args.intervalType}\``);
  lines.push(`- Period: \`${new Date(args.startTimeMs).toISOString()}\` -> \`${new Date(args.endTimeMs).toISOString()}\``);
  lines.push(`- Opening window minutes: \`${args.openingMinutes}\``);
  lines.push(`- Days audited: \`${rows.length}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Opening bucket match rate: \`${bucketMatchRate}%\``);
  lines.push(`- Opening/full-day return sign match rate: \`${signMatchRate}%\``);
  lines.push(`- Opening/full-day return correlation: \`${returnCorrelation}\``);
  lines.push(`- Opening/full-day vol correlation: \`${volCorrelation}\``);
  lines.push(`- Opening/full-day range correlation: \`${rangeCorrelation}\``);
  lines.push('');
  lines.push('## Interpretation');
  lines.push('');
  lines.push('- If bucket match and correlations are low, the current full-day research features are poor proxies for decision-time features.');
  lines.push('- If opening-window features roughly preserve sign and volatility ranking, they are better candidates for causal router inputs.');
  lines.push('- Large divergence days deserve manual review before turning research buckets into executable rules.');
  lines.push('');
  lines.push('## Largest Divergence Days');
  lines.push('');
  lines.push('| Day | Opening Bucket | Full Bucket | Opening Return % | Full Return % | Opening Vol % | Full Vol % |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: |');
  for (const row of largestGaps) {
    lines.push(`| ${row.day} | ${row.openingWindow.featureBucket} | ${row.fullDay.featureBucket} | ${row.openingWindow.returnPct} | ${row.fullDay.returnPct} | ${row.openingWindow.realizedVolPct} | ${row.fullDay.realizedVolPct} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const klines = await loadKlines(args);
  const rows = buildDailyAuditRows(klines, args.openingMinutes);

  const outputDir = args.outputDir ? path.resolve(args.outputDir) : DEFAULT_OUTPUT_DIR;
  ensureDir(outputDir);
  const baseName = `${args.symbol}_${new Date(args.startTimeMs).toISOString().slice(0, 10)}_to_${new Date(args.endTimeMs).toISOString().slice(0, 10)}_${args.openingMinutes}m`;
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const mdPath = path.join(outputDir, `${baseName}.md`);

  const payload = {
    generatedAt: new Date().toISOString(),
    symbol: args.symbol,
    intervalType: args.intervalType,
    startTimeMs: args.startTimeMs,
    endTimeMs: args.endTimeMs,
    openingMinutes: args.openingMinutes,
    rows
  };

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdPath, buildMarkdown(args, rows), 'utf8');

  console.log(`Feature causality JSON written: ${jsonPath}`);
  console.log(`Feature causality report written: ${mdPath}`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
