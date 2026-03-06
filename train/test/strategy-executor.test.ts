const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const { StrategyExecutor } = require('../dist/services/strategy-executor.js');

type KlineData = import('../dist/types/index.js').KlineData;
type Strategy = import('../dist/types/index.js').Strategy;

function createKlines(startIso: string, closes: readonly number[]): readonly KlineData[] {
  const startMs = Date.parse(startIso);
  return closes.map((close, index) => {
    const price = close.toFixed(2);
    return {
      id: index + 1,
      open_time: String(startMs + index * 60_000),
      open: price,
      high: price,
      low: price,
      close: price,
      volume: '1',
      symbol: 'USDJPY',
      interval_type: '1min'
    };
  });
}

function createStrategy(tradingTimeRestriction?: Strategy['parameters']['tradingTimeRestriction']): Strategy {
  return {
    id: 1,
    name: 'RSI-Test',
    type: 'rsi_only',
    parameters: {
      rsi: {
        enabled: true,
        period: 14,
        oversold: 30,
        overbought: 70
      },
      risk: {
        maxPositions: 1,
        lotSize: 0.1,
        stopLossPercent: null,
        takeProfitPercent: null,
        maxHoldMinutes: 5
      },
      tradingSchedule: '* * * * 1-5',
      tradingTimeRestriction
    }
  };
}

test('executor respects configured trading time restriction', async () => {
  const closes = [
    100, 99, 98, 97, 96, 95, 94, 93,
    92, 91, 90, 89, 88, 87, 86, 85
  ];
  const klines = createKlines('2026-03-02T19:16:00.000Z', closes);

  const unrestricted = new StrategyExecutor(createStrategy(null), klines);
  const unrestrictedResult = await unrestricted.execute();
  assert.ok(unrestrictedResult.trades.length > 0);

  const restricted = new StrategyExecutor(
    createStrategy({
      enabled: true,
      utcExcludeStart: '19:30',
      utcExcludeEnd: '23:59'
    }),
    klines
  );
  const restrictedResult = await restricted.execute();

  assert.equal(restrictedResult.trades.length, 0);
});
