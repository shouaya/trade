const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  calculateRSI,
  precalculateRSI,
  getRSIAtIndex,
  generateRSISignal
} = require('../dist/services/indicators/rsi.js');
const {
  calculateATR,
  calculateDynamicSLTP,
  calculatePositionSize,
  getATRAtIndex
} = require('../dist/services/indicators/atr.js');
const {
  calculateEMA,
  calculateMACD,
  precalculateMACD,
  getMACDAtIndex,
  generateMACDSignal
} = require('../dist/services/indicators/macd.js');
const {
  initializeGrid,
  checkGridTriggers,
  generateGridSignal,
  calculateGridTakeProfit
} = require('../dist/services/indicators/grid.js');
const { MultiTimeframeAnalyzer } = require('../dist/services/multi-timeframe-analyzer.js');
const { SignalGenerator } = require('../dist/services/signal-generator.js');

function makeKlines(closes) {
  const startMs = Date.parse('2026-03-02T00:00:00.000Z');
  return closes.map((close, index) => {
    const value = Number(close);
    return {
      id: index + 1,
      open_time: String(startMs + index * 60_000),
      open: value.toFixed(2),
      high: (value + 0.3).toFixed(2),
      low: (value - 0.3).toFixed(2),
      close: value.toFixed(2),
      volume: '1',
      symbol: 'USDJPY',
      interval_type: '1min'
    };
  });
}

test('RSI helpers cover short input, lookup, and signals', () => {
  assert.deepEqual(calculateRSI([1, 2, 3], 14), [null, null, null]);

  const klines = makeKlines([1, 2, 3, 2, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4]);
  const precalc = precalculateRSI(klines, 14);
  assert.equal(precalc.length, klines.length);
  assert.equal(getRSIAtIndex(klines, 1, 14), null);
  assert.ok(getRSIAtIndex(klines, 15, 14) !== null);
  assert.equal(generateRSISignal(20, { oversold: 30, overbought: 70 }), 'BUY');
  assert.equal(generateRSISignal(80, { oversold: 30, overbought: 70 }), 'SELL');
  assert.equal(generateRSISignal(50, { oversold: 30, overbought: 70 }), null);
});

test('ATR helpers cover short input, long/short SLTP, clamps, and lookup', () => {
  const short = makeKlines([100, 101, 102]);
  assert.deepEqual(calculateATR(short, 14), [null, null, null]);

  const klines = makeKlines(Array.from({ length: 20 }, (_, i) => 100 + i * 0.2));
  const atr = calculateATR(klines, 14);
  assert.ok(atr[13] !== null);
  assert.deepEqual(calculateDynamicSLTP(1, 100, 'long', { slMultiplier: 2, tpMultiplier: 3 }), {
    stopLoss: 98,
    takeProfit: 103
  });
  assert.deepEqual(calculateDynamicSLTP(1, 100, 'short', { slMultiplier: 2, tpMultiplier: 3 }), {
    stopLoss: 102,
    takeProfit: 97
  });
  assert.equal(calculatePositionSize(0.0001, 10000, 0.01, 2), 0.5);
  assert.equal(calculatePositionSize(10000, 10000, 0.01, 2), 0.01);
  assert.equal(getATRAtIndex(klines, 5, 14), null);
  assert.ok(getATRAtIndex(klines, 15, 14) !== null);
});

test('MACD helpers cover EMA, indicator outputs, lookups, and crossover signals', () => {
  assert.deepEqual(calculateEMA([1, 2], 5), [null, null]);

  const prices = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
  const macd = calculateMACD(prices, 12, 26, 9);
  assert.equal(macd.macd.length, prices.length);

  const klines = makeKlines(prices);
  const precalc = precalculateMACD(klines, 12, 26, 9);
  assert.equal(precalc.signal.length, prices.length);

  assert.deepEqual(getMACDAtIndex(klines, 10, 12, 26, 9), {
    macd: null,
    signal: null,
    histogram: null
  });
  const later = getMACDAtIndex(klines, 39, 12, 26, 9);
  assert.ok('macd' in later);

  assert.equal(
    generateMACDSignal(
      { macd: 2, signal: 1, histogram: 1 },
      { macd: 0, signal: 1, histogram: -1 }
    ),
    'BUY'
  );
  assert.equal(
    generateMACDSignal(
      { macd: 0, signal: 1, histogram: -1 },
      { macd: 2, signal: 1, histogram: 1 }
    ),
    'SELL'
  );
  assert.equal(generateMACDSignal(null, null), null);
});

test('Grid helpers cover initialization, triggers, zone signals, and take profit', () => {
  const klines = makeKlines([100, 101, 102, 103, 104, 105]);
  const grid = initializeGrid(klines, { levels: 4, rangePercent: 2, profitPerGrid: 1 });
  assert.equal(grid.gridLines.length, 5);

  assert.deepEqual(checkGridTriggers(grid, null, 100), []);
  const triggers = checkGridTriggers(grid, grid.gridMin + 0.5, grid.gridMin - 0.1);
  assert.ok(triggers.some(trigger => trigger.action === 'BUY'));

  assert.equal(generateGridSignal(grid, grid.gridMin - 1, []), null);
  const buySignal = generateGridSignal(grid, grid.gridMin + grid.gridStep * 1.1, []);
  assert.equal(buySignal?.action, 'BUY');
  const sellSignal = generateGridSignal(grid, grid.gridMin + grid.gridStep * 3.5, [{ direction: 'long', gridLevel: 1 }]);
  assert.equal(sellSignal?.action, 'SELL');

  assert.ok(calculateGridTakeProfit(100, 1, 'long') > 100);
  assert.ok(calculateGridTakeProfit(100, 1, 'short') < 100);
});

test('MultiTimeframeAnalyzer and SignalGenerator cover active RSI-only behavior', () => {
  const klines = makeKlines(Array.from({ length: 40 }, (_, i) => 100 - i * 0.5));
  const analyzer = new MultiTimeframeAnalyzer(klines, 14);

  analyzer.rsi1min = Array(40).fill(20);
  analyzer.rsi5min = Array(8).fill(35);
  assert.equal(analyzer.getMultiTimeframeSignal(20, {}), 'long');

  analyzer.rsi1min = Array(40).fill(80);
  analyzer.rsi5min = Array(8).fill(70);
  assert.equal(analyzer.getMultiTimeframeSignal(20, {}), 'short');

  analyzer.rsi5min = Array(8).fill(58);
  assert.equal(analyzer.getTrendStrength(20), 'bullish');
  analyzer.rsi5min = Array(8).fill(25);
  assert.equal(analyzer.getTrendStrength(20), 'strong_bearish');

  analyzer.rsi1min = Array(40).fill(50);
  analyzer.rsi1min[25] = 40;
  analyzer.klines1min[25] = { ...analyzer.klines1min[25], close: '80.00' };
  analyzer.klines1min[24] = { ...analyzer.klines1min[24], close: '81.00' };
  const divergence = analyzer.checkDivergence(25, 5);
  assert.equal(typeof divergence.bullish, 'boolean');

  const report = analyzer.getAnalysisReport(20);
  assert.ok(['long', 'short', 'hold'].includes(report.recommendation));

  const strategy = {
    id: 1,
    name: 'RSI',
    type: 'rsi_only',
    parameters: {
      rsi: { enabled: true, period: 14, oversold: 30, overbought: 70 },
      risk: { maxPositions: 1, lotSize: 0.1, stopLossPercent: null, takeProfitPercent: null, maxHoldMinutes: 5 }
    }
  };
  const generator = new SignalGenerator(strategy, klines);
  const signals = generator.generate(klines, 20);
  assert.equal(signals.macd, null);
  assert.equal(signals.grid, null);
  assert.ok(signals.combined !== null);
});
