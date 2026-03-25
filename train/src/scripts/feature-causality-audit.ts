#!/usr/bin/env node

import type * as mysql from 'mysql2/promise';
import db from '../configs/database';
import { saveTrainArtifact } from '../services/train-artifact-store';
import type { KlineData } from '../types';
import {
  buildPeriodFeatures,
  detectDailyFeatureBucket,
  getJstDayKey,
  round,
  type PeriodFeature
} from '../services/rolling-features';

const DEFAULT_OPENING_MINUTES = 60;

interface CliArgs {
  readonly trainId?: string;
  readonly symbol: string;
  readonly intervalType: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly openingMinutes: number;
  readonly outputDir?: string;
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
  let trainId: string | undefined;

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
      continue;
    }
    if (arg.startsWith('--trainId=')) {
      trainId = arg.slice('--trainId='.length);
      continue;
    }
    if (arg === '--trainId') {
      trainId = args[index + 1] ?? '';
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
    ...(trainId ? { trainId } : {}),
    symbol: symbol.toUpperCase(),
    intervalType,
    startTimeMs: parseTimeArg(start, 'start'),
    endTimeMs: parseTimeArg(end, 'end'),
    openingMinutes,
    ...(outputDir ? { outputDir } : {})
  };
}

function computeFeature(key: string, klines: readonly KlineData[], openingMinutes: number): PeriodFeature | null {
  return buildPeriodFeatures(klines, () => key, detectDailyFeatureBucket, {
    openingWindowCount: Math.min(openingMinutes, klines.length)
  })[0] ?? null;
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
    const fullDay = computeFeature(day, dayRows, openingMinutes);
    const openingWindow = computeFeature(day, dayRows.slice(0, openingMinutes), openingMinutes);
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const klines = await loadKlines(args);
  const rows = buildDailyAuditRows(klines, args.openingMinutes);

  const payload = {
    generatedAt: new Date().toISOString(),
    trainId: args.trainId ?? null,
    symbol: args.symbol,
    intervalType: args.intervalType,
    startTimeMs: args.startTimeMs,
    endTimeMs: args.endTimeMs,
    openingMinutes: args.openingMinutes,
    rows
  };

  await saveTrainArtifact(db, {
    artifactKey: `feature-causality:${args.symbol}:${args.intervalType}:${args.startTimeMs}:${args.endTimeMs}:${args.openingMinutes}`,
    artifactType: 'feature-causality',
    trainId: args.trainId ?? null,
    symbol: args.symbol,
    intervalType: args.intervalType,
    periodStartMs: args.startTimeMs,
    periodEndMs: args.endTimeMs,
    payload,
    metadata: {
      openingMinutes: args.openingMinutes
    }
  });

  console.log(`Feature causality artifact saved: feature-causality:${args.symbol}:${args.intervalType}:${args.startTimeMs}:${args.endTimeMs}:${args.openingMinutes}`);
  console.log('Structured output is stored in DB; keep files only for AI summary markdown.');
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
