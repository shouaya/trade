import * as fs from 'fs';
import * as path from 'path';
import type { KlineData } from '../types';

type GoldenFixture = {
  readonly id: string;
  readonly source: {
    readonly database: string;
    readonly table: string;
    readonly symbol: string;
    readonly interval: string;
    readonly startTime: number;
    readonly endTime: number;
  };
  readonly klines: readonly Record<string, string>[];
};

export interface RealMarketWindowFixture {
  readonly id: string;
  readonly symbol: string;
  readonly intervalType: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly sourceDatabase: string;
  readonly sourceTable: string;
  readonly klines: readonly KlineData[];
}

const FIXTURE_DIR = path.resolve(__dirname, '../../../simulator/test/golden/fixtures');
const BTC_WINDOW_FIXTURES = ['btc_multi_settlement_long.json'] as const;

function toKlineData(symbol: string, rows: readonly Record<string, string>[]): readonly KlineData[] {
  return rows.map((row, index) => ({
    id: index + 1,
    open_time: String(row['open_time'] ?? row['openTime']),
    open: String(row['open'] ?? row['close']),
    high: String(row['high']),
    low: String(row['low']),
    close: String(row['close']),
    bid_open: row['bid_open'] ?? row['bidClose'] ?? row['bid_close'] ?? row['open'] ?? row['close'] ?? null,
    bid_high: row['bid_high'] ?? row['bidHigh'] ?? null,
    bid_low: row['bid_low'] ?? row['bidLow'] ?? null,
    bid_close: row['bid_close'] ?? row['bidClose'] ?? null,
    ask_open: row['ask_open'] ?? row['askClose'] ?? row['ask_close'] ?? row['open'] ?? row['close'] ?? null,
    ask_high: row['ask_high'] ?? row['askHigh'] ?? null,
    ask_low: row['ask_low'] ?? row['askLow'] ?? null,
    ask_close: row['ask_close'] ?? row['askClose'] ?? null,
    volume: row['volume'] ?? '0',
    symbol,
    interval_type: '1min'
  }));
}

export function loadRealMarketWindowFixtures(): readonly RealMarketWindowFixture[] {
  return BTC_WINDOW_FIXTURES.map((filename) => {
    const absolutePath = path.join(FIXTURE_DIR, filename);
    const fixture = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as GoldenFixture;

    return {
      id: fixture.id,
      symbol: fixture.source.symbol,
      intervalType: fixture.source.interval,
      startTimeMs: Number(fixture.source.startTime),
      endTimeMs: Number(fixture.source.endTime),
      sourceDatabase: fixture.source.database,
      sourceTable: fixture.source.table,
      klines: toKlineData(fixture.source.symbol, fixture.klines)
    };
  });
}
