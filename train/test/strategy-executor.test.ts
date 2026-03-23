const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const { StrategyExecutor } = require('../dist/services/strategy-executor.js');

type KlineData = import('../dist/types/index.js').KlineData;
type Strategy = import('../dist/types/index.js').Strategy;

function createFeeModel(overrides = {}) {
  return {
    venueCode: 'GMOCOIN',
    market: 'exchange-leverage',
    productCode: 'BTC_JPY',
    commissionRate: 0,
    basis: 'notional',
    chargeOnEntry: true,
    chargeOnExit: true,
    leverageMultiplier: 2,
    dailyLeverageRate: 0.0004,
    liquidationFeeRate: 0.005,
    forcedCloseFeeRate: 0.005,
    settlementHourJst: 6,
    ...overrides
  };
}

function createKlines(startIso: string, closes: readonly number[]): readonly KlineData[] {
  const startMs = Date.parse(startIso);
  return closes.map((close, index) => {
    const price = close.toFixed(2);
    return {
      id: index + 1,
      open_time: String(startMs + index * 60_000),
      open: price,
      high: (close + 0.3).toFixed(2),
      low: (close - 0.3).toFixed(2),
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
    name: 'RSIMACD-Test',
    type: 'rsi_macd',
    parameters: {
      rsi: {
        enabled: true,
        period: 14,
        oversold: 30,
        overbought: 70
      },
      macd: {
        enabled: true,
        fastPeriod: 4,
        slowPeriod: 9,
        signalPeriod: 3,
        histogramThreshold: 0
      },
      atr: {
        slMultiplier: 1.5,
        tpMultiplier: 1
      },
      risk: {
        maxPositions: 1,
        lotSize: 0.1,
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
  const klines = createKlines('2026-03-02T19:28:00.000Z', closes);

  const unrestricted = new StrategyExecutor(createStrategy(null), klines, { feeModel: createFeeModel() });
  unrestricted['rsiValues'] = Array(klines.length).fill(50);
  unrestricted['rsiValues'][3] = 20;
  unrestricted['macdValues'] = {
    macd: Array(klines.length).fill(1),
    signal: Array(klines.length).fill(0),
    histogram: [0, 0, 0.05, 0.2, ...Array(klines.length - 4).fill(0.2)]
  };
  const unrestrictedResult = await unrestricted.execute();
  assert.ok(unrestrictedResult.trades.length > 0);

  const restricted = new StrategyExecutor(
    createStrategy({
      enabled: true,
      utcExcludeStart: '19:30',
      utcExcludeEnd: '23:59'
    }),
    klines,
    { feeModel: createFeeModel() }
  );
  restricted['rsiValues'] = Array(klines.length).fill(50);
  restricted['rsiValues'][3] = 20;
  restricted['macdValues'] = {
    macd: Array(klines.length).fill(1),
    signal: Array(klines.length).fill(0),
    histogram: [0, 0, 0.05, 0.2, ...Array(klines.length - 4).fill(0.2)]
  };
  const restrictedResult = await restricted.execute();

  assert.equal(restrictedResult.trades.length, 0);
});

test('executor uses ATR exits and produces backtest_end when still holding', async () => {
  const klines = createKlines('2026-03-02T00:00:00.000Z', Array.from({ length: 18 }, (_, i) => 100 - i * 0.2));
  const executor = new StrategyExecutor({
    ...createStrategy(null),
    parameters: {
      ...createStrategy(null).parameters,
      risk: {
        ...createStrategy(null).parameters.risk,
        maxHoldMinutes: null
      }
    }
  }, klines, { enableATRSizing: true, feeModel: createFeeModel() });

  executor['rsiValues'] = Array(klines.length).fill(50);
  executor['rsiValues'][15] = 20;
  executor['atrValues'] = Array(klines.length).fill(1000);
  executor['macdValues'] = {
    macd: Array(klines.length).fill(1),
    signal: Array(klines.length).fill(0),
    histogram: [...Array(15).fill(0), 0.2, 0.2, 0.2]
  };

  const result = await executor.execute();
  assert.equal(result.trades[result.trades.length - 1]?.exit_reason, 'backtest_end');
});

test('executor calculates linear coin pnl and commissions correctly', () => {
  const coinExecutor = new StrategyExecutor(
    createStrategy(),
    [{
      ...createKlines('2026-03-02T00:00:00.000Z', [100])[0],
      symbol: 'ETHJPY'
    }],
    {
      feeModel: {
        ...createFeeModel({ market: 'spot', productCode: 'ETH_JPY' }),
        commissionRate: 0.00002,
      }
    }
  );

  assert.ok(Math.abs(coinExecutor['calculatePnL']({ direction: 'long', entry_price: 100, lot_size: 0.1 }, 110) - 1) < 1e-6);

  const outcome = coinExecutor['calculateTradeOutcome']({
    direction: 'long',
    entry_price: 100,
    lot_size: 0.1
  }, 110);

  assert.ok(Math.abs(outcome.grossPnl - 1) < 1e-6);
  assert.ok(Math.abs(outcome.commissionFee - 0.00042) < 1e-10);
  assert.ok(Math.abs(outcome.netPnl - 0.99958) < 1e-10);
});

test('executor uses bid/ask prices without slippage when available', () => {
  const executor = new StrategyExecutor(createStrategy(), createKlines('2026-03-02T00:00:00.000Z', [100]), {
    feeModel: createFeeModel()
  });
  const dualPriceKline = {
    ...createKlines('2026-03-02T00:00:00.000Z', [100])[0],
    bid_close: '99.99',
    ask_close: '100.01'
  };

  assert.equal(executor['getReferencePrice'](dualPriceKline, 'long', true), 100.01);
  assert.equal(executor['getReferencePrice'](dualPriceKline, 'long', false), 99.99);
  assert.equal(executor['getReferencePrice'](dualPriceKline, 'short', true), 99.99);
  assert.equal(executor['getReferencePrice'](dualPriceKline, 'short', false), 100.01);
});

test('executor accepts custom slippage config overrides', () => {
  const executor = new StrategyExecutor(
    createStrategy(),
    createKlines('2026-03-02T00:00:00.000Z', [100]),
    {
      feeModel: createFeeModel(),
      enableSlippage: true,
      slippageConfig: {
        normalSlippage: 1.5,
        tokyoSlippage: 20,
        highVolatilitySlippage: 8,
        volatilityThreshold: 1,
        exitMultiplier: 1.8
      }
    }
  );

  const kline = createKlines('2026-03-02T00:00:00.000Z', [100])[0];
  assert.equal(executor['slippageModel']?.calculateTotalCost(kline, 'long', true), 1.5);
});

test('executor throws when fee model is missing', () => {
  assert.throws(
    () => new StrategyExecutor(createStrategy(), createKlines('2026-03-02T00:00:00.000Z', [100])),
    /executor\.options\.feeModel is required/
  );
});

test('executor charges daily leverage fee when crossing JST settlement', () => {
  const klines = createKlines('2026-03-02T20:58:00.000Z', [100, 100, 100, 100, 100]).map((kline) => ({
    ...kline,
    symbol: 'ETHJPY'
  }));
  const executor = new StrategyExecutor(
    createStrategy(),
    klines,
    { feeModel: createFeeModel({ commissionRate: 0 }) }
  );

  const fee = executor['calculateCommission'](
    {
      lot_size: 0.1,
      entry_price: 100,
      entry_time: Date.parse('2026-03-02T20:58:00.000Z'),
      entry_index: 0
    },
    100,
    Date.parse('2026-03-02T21:02:00.000Z'),
    4
  );

  assert.ok(Math.abs(fee - 0.004) < 1e-10);
});
