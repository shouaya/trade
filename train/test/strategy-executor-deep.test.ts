const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const { StrategyExecutor } = require('../dist/services/strategy-executor.js');

function makeKline(close, minuteOffset = 0, iso = '2026-03-02T10:00:00.000Z') {
  const base = Date.parse(iso) + minuteOffset * 60_000;
  return {
    id: minuteOffset + 1,
    open_time: String(base),
    open: close.toFixed(2),
    high: (close + 0.2).toFixed(2),
    low: (close - 0.2).toFixed(2),
    close: close.toFixed(2),
    volume: '1',
    symbol: 'USDJPY',
    interval_type: '1min'
  };
}

function makeStrategy(overrides = {}) {
  return {
    id: 1,
    name: 'RSI-Test',
    type: 'rsi_only',
    parameters: {
      rsi: { enabled: true, period: 14, oversold: 30, overbought: 70 },
      risk: { maxPositions: 1, lotSize: 0.1, stopLossPercent: 0.1, takeProfitPercent: 0.2, maxHoldMinutes: 5 },
      ...overrides
    }
  };
}

function makeExecutor(strategyOverrides = {}, optionOverrides = {}) {
  const klines = Array.from({ length: 20 }, (_, index) => makeKline(100 - index * 0.2, index));
  return new StrategyExecutor(makeStrategy(strategyOverrides), klines, optionOverrides);
}

test('StrategyExecutor private signal helpers cover RSI, MA200, and MTF branches', () => {
  const executor = makeExecutor();
  executor.rsiValues = Array(20).fill(50);
  executor.rsiValues[5] = 20;
  assert.equal(executor.getSignal(5), 'long');

  executor.rsiValues[5] = 80;
  assert.equal(executor.getSignal(5), 'short');

  const maExecutor = makeExecutor({}, { enableMA200Filter: true });
  maExecutor.rsiValues = Array(20).fill(20);
  maExecutor.ma200 = Array(20).fill(90);
  maExecutor.klines[5] = makeKline(100, 5);
  assert.equal(maExecutor.getSignal(5), 'long');
  maExecutor.klines[5] = makeKline(80, 5);
  assert.equal(maExecutor.getSignal(5), 'hold');

  const mtfExecutor = makeExecutor({}, { enableMultiTimeframe: true, enableMA200Filter: true });
  mtfExecutor.rsiValues = Array(20).fill(50);
  mtfExecutor.ma200 = Array(20).fill(90);
  mtfExecutor.mtfAnalyzer = { getMultiTimeframeSignal: () => 'short' };
  mtfExecutor.klines[6] = makeKline(80, 6);
  assert.equal(mtfExecutor.getSignal(6), 'short');
  mtfExecutor.mtfAnalyzer = { getMultiTimeframeSignal: () => 'hold' };
  assert.equal(mtfExecutor.getSignal(6), 'hold');
});

test('StrategyExecutor risk and trailing helpers cover ATR, fixed percent, and pnl', () => {
  const executor = makeExecutor({ atr: { slMultiplier: 2, tpMultiplier: 4 } }, { enableATRSizing: true, enableTrailingStop: true });
  executor.atrValues = Array(20).fill(1.5);

  assert.equal(executor.calculateStopLoss(100, 'long', executor.strategy.parameters.risk, 5), 97);
  assert.equal(executor.calculateTakeProfit(100, 'short', executor.strategy.parameters.risk, 5), 94);

  const fixed = makeExecutor({}, {});
  assert.equal(fixed.calculateStopLoss(100, 'short', fixed.strategy.parameters.risk, 5), 100.1);
  assert.equal(fixed.calculateTakeProfit(100, 'long', fixed.strategy.parameters.risk, 5), 100.2);

  const longPosition = {
    direction: 'long',
    entry_price: 100,
    lot_size: 0.1,
    trailingActivated: false,
    trailingStopPrice: 99
  };
  executor.updateTrailingStop(longPosition, 100.4);
  assert.equal(longPosition.trailingActivated, true);
  assert.ok(longPosition.trailingStopPrice >= 100);

  const shortPosition = {
    direction: 'short',
    entry_price: 100,
    lot_size: 0.1,
    trailingActivated: false,
    trailingStopPrice: 101
  };
  executor.updateTrailingStop(shortPosition, 99.5);
  assert.equal(shortPosition.trailingActivated, true);

  assert.ok(Math.abs(executor.calculatePnL({ direction: 'long', entry_price: 100, lot_size: 0.1 }, 100.1) - 10) < 1e-6);
  assert.ok(Math.abs(executor.calculatePnL({ direction: 'short', entry_price: 100, lot_size: 0.1 }, 99.9) - 10) < 1e-6);
});

test('StrategyExecutor exit checks cover all exit reasons and stats paths', () => {
  const executor = makeExecutor({}, { enableTrailingStop: true, enableRSIReversion: true });
  const reasons = [];
  executor.closePosition = (_kline, _price, reason) => {
    reasons.push(reason);
    executor.positions.shift();
  };

  const basePosition = {
    direction: 'long',
    entry_time: Date.parse('2026-03-02T10:00:00.000Z'),
    entry_price: 100,
    entry_index: 0,
    entry_rsi: 20,
    lot_size: 0.1,
    stop_loss: 99,
    take_profit: 101,
    hold_minutes: 5,
    strategy_name: 'x',
    symbol: 'USDJPY',
    trailingActivated: true,
    trailingStopPrice: 99.8
  };

  executor.rsiValues = Array(20).fill(60);
  executor.positions = [{ ...basePosition }];
  executor.checkExitConditions(1, makeKline(99.7, 1));

  executor.positions = [{ ...basePosition, trailingActivated: false, trailingStopPrice: null }];
  executor.checkExitConditions(1, makeKline(98.9, 1));

  executor.positions = [{ ...basePosition, trailingActivated: false, trailingStopPrice: null }];
  executor.checkExitConditions(1, makeKline(101.1, 1));

  executor.positions = [{ ...basePosition, trailingActivated: false, trailingStopPrice: null, stop_loss: null, take_profit: null }];
  executor.checkExitConditions(1, makeKline(100.5, 1));

  executor.rsiValues = Array(20).fill(40);
  executor.positions = [{ ...basePosition, direction: 'short', trailingActivated: false, trailingStopPrice: null, stop_loss: null, take_profit: null }];
  executor.checkExitConditions(1, makeKline(99.5, 1));

  executor.rsiValues = Array(20).fill(10);
  executor.positions = [{ ...basePosition, trailingActivated: false, trailingStopPrice: null, stop_loss: null, take_profit: null }];
  executor.checkExitConditions(6, makeKline(99.5, 6));

  executor.positions = [{ ...basePosition, trailingActivated: false, trailingStopPrice: null, stop_loss: null, take_profit: null, hold_minutes: null }];
  executor.checkExitConditions(1, makeKline(99.5, 1, '2026-03-03T00:01:00.000Z'));

  executor.positions = [{
    ...basePosition,
    entry_time: Date.parse('2026-03-06T19:58:00.000Z'),
    trailingActivated: false,
    trailingStopPrice: null,
    stop_loss: null,
    take_profit: null,
    hold_minutes: null
  }];
  executor.checkExitConditions(1, makeKline(99.5, 1, '2026-03-06T20:01:00.000Z'));

  assert.deepEqual(reasons, [
    'trailing_stop',
    'stop_loss',
    'take_profit',
    'rsi_revert',
    'rsi_revert',
    'hold_time_reached',
    'no_overnight',
    'no_weekend'
  ]);

  const statsExecutor = makeExecutor();
  assert.equal(statsExecutor.calculateStats().stats.totalTrades, 0);

  statsExecutor.closedTrades = [
    { pnl: 10 },
    { pnl: -5 },
    { pnl: 15 }
  ];
  const stats = statsExecutor.calculateStats().stats;
  assert.equal(stats.totalTrades, 3);
  assert.ok(stats.profitFactor > 0);
});

test('StrategyExecutor execute covers forced backtest_end close', async () => {
  const klines = Array.from({ length: 16 }, (_, index) => makeKline(100 - index, index));
  const executor = new StrategyExecutor(makeStrategy({ risk: { maxPositions: 1, lotSize: 0.1, stopLossPercent: null, takeProfitPercent: null, maxHoldMinutes: null } }), klines, {});
  executor.rsiValues = Array(16).fill(null);
  executor.rsiValues[15] = 20;
  const result = await executor.execute();
  assert.equal(result.trades[result.trades.length - 1]?.exit_reason, 'backtest_end');
});

test('StrategyExecutor uses bid/ask prices without slippage when available', () => {
  const executor = makeExecutor();
  const dualPriceKline = {
    ...makeKline(100, 0),
    bid_close: '99.99',
    ask_close: '100.01'
  };

  assert.equal(executor.getReferencePrice(dualPriceKline, 'long', true), 100.01);
  assert.equal(executor.getReferencePrice(dualPriceKline, 'long', false), 99.99);
  assert.equal(executor.getReferencePrice(dualPriceKline, 'short', true), 99.99);
  assert.equal(executor.getReferencePrice(dualPriceKline, 'short', false), 100.01);
});
