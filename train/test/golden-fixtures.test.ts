const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { test } = require('./harness.ts');
const { StrategyExecutor } = require('../dist/services/strategy-executor.js');
const { resolveVenueFeeModel } = require('../dist/services/simulator-core.js');

type KlineData = import('../dist/types/index.js').KlineData;
type Strategy = import('../dist/types/index.js').Strategy;

type GoldenFixture = {
  readonly id: string;
  readonly scenario: {
    readonly type: 'trade_outcome';
    readonly venue: 'gmo';
    readonly symbol: string;
    readonly market: 'fx' | 'spot' | 'exchange-leverage';
    readonly direction: 'long' | 'short';
    readonly lotSize: number;
    readonly holdMinutes: number;
  };
  readonly klines: readonly Array<Record<string, string>>;
  readonly derived: {
    readonly entryPrice: number;
    readonly exitPrice: number;
  };
  readonly expected: {
    readonly grossPnl: number;
    readonly commissionFee: number;
    readonly netPnl: number;
    readonly pips: number;
    readonly percent: number;
  };
};

const FIXTURE_DIR = path.resolve(__dirname, '../../simulator/test/golden/fixtures');

function createStrategy(): Strategy {
  return {
    id: 1,
    name: 'golden-fixture-regression',
    type: 'rsi_macd',
    parameters: {
      rsi: { enabled: true, period: 14, oversold: 30, overbought: 70 },
      macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, histogramThreshold: 0 },
      atr: { slMultiplier: 1.5, tpMultiplier: 1.5 },
      risk: { maxPositions: 1, lotSize: 0.1, maxHoldMinutes: null },
      tradingSchedule: '* * * * 1-5',
      tradingTimeRestriction: null
    }
  };
}

function loadFixtures(): readonly GoldenFixture[] {
  if (!fs.existsSync(FIXTURE_DIR)) {
    return [];
  }

  return fs.readdirSync(FIXTURE_DIR)
    .filter((name: string) => name.endsWith('.json'))
    .sort()
    .map((name: string) => {
      const filepath = path.join(FIXTURE_DIR, name);
      return JSON.parse(fs.readFileSync(filepath, 'utf8')) as GoldenFixture;
    });
}

function toKlineData(symbol: string, rows: readonly Array<Record<string, string>>): readonly KlineData[] {
  return rows.map((row, index) => ({
    id: index + 1,
    open_time: String(row.open_time ?? row.openTime),
    open: String(row.close),
    high: String(row.high),
    low: String(row.low),
    close: String(row.close),
    bid_open: row.bid_open ?? row.bidClose ?? row.bid_close ?? null,
    bid_high: row.bid_high ?? row.bidHigh ?? null,
    bid_low: row.bid_low ?? row.bidLow ?? null,
    bid_close: row.bid_close ?? row.bidClose ?? null,
    ask_open: row.ask_open ?? row.askClose ?? row.ask_close ?? null,
    ask_high: row.ask_high ?? row.askHigh ?? null,
    ask_low: row.ask_low ?? row.askLow ?? null,
    ask_close: row.ask_close ?? row.askClose ?? null,
    volume: row.volume ?? '0',
    symbol,
    interval_type: '1min'
  }));
}

function approxEqual(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${expected}, got ${actual}`);
}

test('train strategy executor matches simulator golden fixtures', () => {
  const fixtures = loadFixtures().filter((fixture) => fixture.scenario.type === 'trade_outcome');
  assert.ok(fixtures.length > 0, 'expected golden fixtures to exist');

  for (const fixture of fixtures) {
    const klines = toKlineData(fixture.scenario.symbol, fixture.klines);
    const executor = new StrategyExecutor(createStrategy(), klines, {
      feeModel: resolveVenueFeeModel({
        venue: fixture.scenario.venue,
        symbol: fixture.scenario.symbol,
        market: fixture.scenario.market
      })
    });

    const entryKline = klines[0];
    const exitKline = klines[klines.length - 1];
    assert.ok(entryKline, `missing entry kline for ${fixture.id}`);
    assert.ok(exitKline, `missing exit kline for ${fixture.id}`);

    const entryReference = executor['getReferencePrice'](entryKline, fixture.scenario.direction, true);
    const exitReference = executor['getReferencePrice'](exitKline, fixture.scenario.direction, false);

    approxEqual(entryReference, fixture.derived.entryPrice);
    approxEqual(exitReference, fixture.derived.exitPrice);

    const outcome = executor['calculateTradeOutcome'](
      {
        direction: fixture.scenario.direction,
        entry_price: fixture.derived.entryPrice,
        lot_size: fixture.scenario.lotSize,
        entry_time: Number(entryKline.open_time),
        entry_index: 0
      },
      fixture.derived.exitPrice,
      Number(exitKline.open_time),
      klines.length - 1
    );

    approxEqual(outcome.grossPnl, fixture.expected.grossPnl);
    approxEqual(outcome.commissionFee, fixture.expected.commissionFee);
    approxEqual(outcome.netPnl, fixture.expected.netPnl);
    approxEqual(outcome.pips, fixture.expected.pips);
    approxEqual(outcome.percent, fixture.expected.percent);
  }
});
