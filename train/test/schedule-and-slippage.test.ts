const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  TradingSchedule,
  createTradingSchedule,
  isTradingAllowed
} = require('../dist/services/trading-schedule.js');
const { SlippageModel } = require('../dist/services/slippage-model.js');

function makeKline(overrides = {}) {
  return {
    id: 1,
    open_time: String(Date.parse('2026-03-02T12:00:00.000Z')),
    open: '100.00',
    high: '100.20',
    low: '99.80',
    close: '100.00',
    volume: '1',
    symbol: 'USDJPY',
    interval_type: '1min',
    ...overrides
  };
}

test('TradingSchedule handles presets, expressions, descriptions, and next allowed time', () => {
  const weekdays = new TradingSchedule('WEEKDAYS');
  assert.equal(weekdays.isAllowed(new Date('2026-03-02T12:30:00.000Z')), true);
  assert.equal(weekdays.isAllowed(new Date('2026-03-01T12:30:00.000Z')), false);
  assert.match(weekdays.getDescription(), /周一到周五全天/);

  const custom = new TradingSchedule('*/15 9-10 * 3 1,2');
  assert.equal(custom.isAllowed(new Date('2026-03-02T09:15:00.000Z')), true);
  assert.equal(custom.isAllowed(new Date('2026-03-02T09:14:00.000Z')), false);
  assert.match(custom.getDescription(), /周一、周二/);

  const nextAllowed = custom.getNextAllowedTime(new Date('2026-03-02T09:14:00.000Z'), 5);
  assert.equal(nextAllowed?.toISOString(), '2026-03-02T09:15:00.000Z');

  assert.equal(createTradingSchedule('ALWAYS').isAllowed(new Date('2026-03-01T00:00:00.000Z')), true);
  assert.equal(isTradingAllowed('US_HOURS', new Date('2026-03-02T13:00:00.000Z')), true);
  assert.throws(() => new TradingSchedule('* * * *'), /Invalid schedule format/);
});

test('SlippageModel handles tokyo hours, volatility, directions, and breakdown', () => {
  const model = new SlippageModel({
    normalSlippage: 0.5,
    tokyoSlippage: 10,
    highVolatilitySlippage: 7,
    volatilityThreshold: 0.002,
    exitMultiplier: 1.5
  });

  const tokyoKline = makeKline({ open_time: String(Date.parse('2026-03-02T20:00:00.000Z')) });
  assert.equal(model.isTokyoHighSlippageHour(tokyoKline), true);
  assert.equal(model.calculateTotalCost(tokyoKline, 'long', true), 10);
  assert.equal(model.calculateTotalCost(tokyoKline, 'long', false), 15);

  const volatileKline = makeKline({ high: '101.00', low: '99.00' });
  assert.equal(model.isTokyoHighSlippageHour(volatileKline), false);
  assert.ok(model.calculateVolatility(volatileKline) > 0.002);
  assert.equal(model.calculateTotalCost(volatileKline, 'short', true), 7);

  const normalKline = makeKline();
  const longEntry = model.getExecutionPrice(normalKline, 'long', true);
  const longExit = model.getExecutionPrice(normalKline, 'long', false);
  const shortEntry = model.getExecutionPrice(normalKline, 'short', true);
  const shortExit = model.getExecutionPrice(normalKline, 'short', false);

  assert.ok(longEntry > 100);
  assert.ok(longExit < 100);
  assert.ok(shortEntry < 100);
  assert.ok(shortExit > 100);

  const breakdown = model.getCostBreakdown(volatileKline, 'short', false);
  assert.equal(breakdown.isHighVolatility, true);
  assert.equal(breakdown.exitMultiplier, 1.5);
  assert.match(breakdown.totalCostPercent, /%/);
});

test('SlippageModel uses bid/ask close when available', () => {
  const model = new SlippageModel({
    normalSlippage: 0,
    tokyoSlippage: 0,
    highVolatilitySlippage: 0,
    volatilityThreshold: 1
  });

  const dualPriceKline = makeKline({
    close: '150.005',
    bid_close: '150.000',
    ask_close: '150.010'
  });

  assert.equal(model.getExecutionPrice(dualPriceKline, 'long', true), 150.01);
  assert.equal(model.getExecutionPrice(dualPriceKline, 'long', false), 150.0);
  assert.equal(model.getExecutionPrice(dualPriceKline, 'short', true), 150.0);
  assert.equal(model.getExecutionPrice(dualPriceKline, 'short', false), 150.01);
});
