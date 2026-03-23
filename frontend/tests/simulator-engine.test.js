/* eslint-env node */

import assert from 'node:assert/strict';

import { klinesAPI } from '../src/api/api.js';
import { loadKlineData } from '../src/services/playbackService.js';
import {
  calculateTradeOutcome,
  createManualTrade,
  evaluateTradeOnKline,
} from '../src/services/simulatorEngine.js';

function createKline({
  openTime,
  open = 150,
  high = 150.2,
  low = 149.8,
  close = 150,
  bidClose = close - 0.005,
  askClose = close + 0.005,
  bidHigh = high - 0.005,
  bidLow = low - 0.005,
  askHigh = high + 0.005,
  askLow = low + 0.005,
} = {}) {
  return {
    openTime: String(openTime),
    open: String(open),
    high: String(high),
    low: String(low),
    close: String(close),
    bidClose: String(bidClose),
    askClose: String(askClose),
    bidHigh: String(bidHigh),
    bidLow: String(bidLow),
    askHigh: String(askHigh),
    askLow: String(askLow),
  };
}

async function testManualTradeStartsNextBar() {
  const klines = [
    createKline({ openTime: Date.UTC(2026, 2, 23, 0, 0, 0), close: 150.0 }),
    createKline({
      openTime: Date.UTC(2026, 2, 23, 0, 1, 0),
      high: 150.5,
      low: 149.95,
      close: 150.3,
      bidLow: 149.95,
      askLow: 149.96,
    }),
  ];

  const trade = createManualTrade({
    symbol: 'USDJPY',
    interval: '1m',
    currentIndex: 0,
    klineData: klines,
    tradeParams: {
      direction: 'long',
      entryPrice: null,
      quantity: 1000,
      holdMinutes: 5,
      stopLoss: 149.9,
      takeProfit: 150.1,
    },
    entryIndicators: null,
  });

  assert.equal(trade.entryPrice, 150.005);
  assert.equal(trade.entryTime, Date.UTC(2026, 2, 23, 0, 1, 0));
  assert.equal(trade.activationIndex, 1);

  const sameBarResult = evaluateTradeOnKline({
    trade,
    currentIndex: 0,
    currentKline: klines[0],
    klineData: klines,
    exitIndicators: null,
  });

  assert.equal(sameBarResult, null);

  const nextBarResult = evaluateTradeOnKline({
    trade,
    currentIndex: 1,
    currentKline: klines[1],
    klineData: klines,
    exitIndicators: null,
  });

  assert.equal(nextBarResult.exitReason, 'take_profit');
  assert.equal(nextBarResult.exitPrice, 150.1);
}

async function testFxCommissionAppliedBothSides() {
  const trade = {
    direction: 'long',
    symbol: 'USDJPY',
    quantity: 1000,
    entryPrice: 150.01,
    entryTime: Date.UTC(2026, 2, 23, 0, 0, 0),
    activationIndex: 1,
    symbolSpec: {
      pipSize: 0.01,
      unitsPerLot: 1,
    },
    feeModel: {
      market: 'fx',
      basis: 'notional',
      commissionRate: 0.00002,
      chargeOnEntry: true,
      chargeOnExit: true,
      leverageMultiplier: 20,
    },
  };

  const result = calculateTradeOutcome(
    trade,
    150.21,
    Date.UTC(2026, 2, 23, 0, 5, 0),
    5,
    [],
  );

  assert.equal(result.grossPnl, 200);
  assert.equal(result.commissionFee, 6);
  assert.equal(result.pnl, 194);
  assert.equal(result.pips, 20);
}

async function testBtcDailyLeverageFeeAppliedAtJstSettlement() {
  const entryTime = Date.UTC(2026, 2, 22, 20, 50, 0);
  const settlementTime = Date.UTC(2026, 2, 22, 21, 0, 0);
  const exitTime = Date.UTC(2026, 2, 22, 21, 10, 0);

  const klines = [
    createKline({ openTime: settlementTime, close: 1000000, bidClose: 999999, askClose: 1000001 }),
    createKline({ openTime: exitTime, close: 1001000, bidClose: 1000999, askClose: 1001001 }),
  ];

  const trade = {
    direction: 'long',
    symbol: 'BTCJPY',
    quantity: 0.01,
    entryPrice: 1000000,
    entryTime,
    activationIndex: 0,
    symbolSpec: {
      pipSize: 1,
      unitsPerLot: 1,
    },
    feeModel: {
      market: 'exchange-leverage',
      basis: 'notional',
      commissionRate: 0,
      chargeOnEntry: false,
      chargeOnExit: false,
      dailyLeverageRate: 0.0004,
      settlementHourJst: 6,
      leverageMultiplier: 2,
    },
  };

  const result = calculateTradeOutcome(trade, 1001000, exitTime, 1, klines);

  assert.equal(result.grossPnl, 10);
  assert.equal(result.commissionFee, 4);
  assert.equal(result.pnl, 6);
}

async function testStopLossWinsWhenSameBarAlsoHitsTakeProfit() {
  const klines = [
    createKline({ openTime: Date.UTC(2026, 2, 23, 0, 0, 0), close: 150.0 }),
    createKline({
      openTime: Date.UTC(2026, 2, 23, 0, 1, 0),
      high: 150.4,
      low: 149.6,
      close: 150.0,
      bidHigh: 150.39,
      bidLow: 149.59,
      askHigh: 150.41,
      askLow: 149.61,
    }),
  ];

  const trade = createManualTrade({
    symbol: 'USDJPY',
    interval: '1m',
    currentIndex: 0,
    klineData: klines,
    tradeParams: {
      direction: 'long',
      entryPrice: null,
      quantity: 1000,
      holdMinutes: 10,
      stopLoss: 149.7,
      takeProfit: 150.3,
    },
    entryIndicators: null,
  });

  const result = evaluateTradeOnKline({
    trade,
    currentIndex: 1,
    currentKline: klines[1],
    klineData: klines,
    exitIndicators: null,
  });

  assert.equal(result.exitReason, 'stop_loss');
  assert.equal(result.exitPrice, 149.7);
}

async function testShortTakeProfitAndHoldTimeFallback() {
  const start = Date.UTC(2026, 2, 23, 0, 0, 0);
  const shortKlines = [
    createKline({ openTime: start, close: 150.0 }),
    createKline({
      openTime: start + 60_000,
      high: 150.1,
      low: 149.5,
      close: 149.8,
      bidHigh: 150.09,
      bidLow: 149.49,
      askHigh: 150.11,
      askLow: 149.51,
    }),
  ];

  const shortTrade = createManualTrade({
    symbol: 'USDJPY',
    interval: '1m',
    currentIndex: 0,
    klineData: shortKlines,
    tradeParams: {
      direction: 'short',
      entryPrice: null,
      quantity: 1000,
      holdMinutes: 5,
      stopLoss: 150.2,
      takeProfit: 149.6,
    },
    entryIndicators: null,
  });

  const shortResult = evaluateTradeOnKline({
    trade: shortTrade,
    currentIndex: 1,
    currentKline: shortKlines[1],
    klineData: shortKlines,
    exitIndicators: null,
  });

  assert.equal(shortResult.exitReason, 'take_profit');
  assert.equal(shortResult.exitPrice, 149.6);

  const holdKlines = [
    createKline({ openTime: start, close: 150.0, bidClose: 149.99, askClose: 150.01 }),
    createKline({ openTime: start + 60_000, close: 150.0, bidClose: 149.99, askClose: 150.01 }),
    createKline({ openTime: start + 120_000, close: 150.0, bidClose: 149.99, askClose: 150.01 }),
  ];

  const holdTrade = createManualTrade({
    symbol: 'USDJPY',
    interval: '1m',
    currentIndex: 0,
    klineData: holdKlines,
    tradeParams: {
      direction: 'long',
      entryPrice: null,
      quantity: 1000,
      holdMinutes: 1,
      stopLoss: null,
      takeProfit: null,
    },
    entryIndicators: null,
  });

  const holdResult = evaluateTradeOnKline({
    trade: holdTrade,
    currentIndex: 2,
    currentKline: holdKlines[2],
    klineData: holdKlines,
    exitIndicators: null,
  });

  assert.equal(holdResult.exitReason, 'hold_time_reached');
  assert.equal(holdResult.exitPrice, 149.99);
}

async function testLargeSpreadCreatesLossWithoutPriceMove() {
  const start = Date.UTC(2026, 2, 23, 0, 0, 0);
  const klines = [
    createKline({
      openTime: start,
      close: 150.0,
      bidClose: 149.5,
      askClose: 150.5,
    }),
    createKline({
      openTime: start + 60_000,
      close: 150.0,
      bidClose: 149.5,
      askClose: 150.5,
    }),
    createKline({
      openTime: start + 120_000,
      close: 150.0,
      bidClose: 149.5,
      askClose: 150.5,
    }),
  ];

  const trade = createManualTrade({
    symbol: 'USDJPY',
    interval: '1m',
    currentIndex: 0,
    klineData: klines,
    tradeParams: {
      direction: 'long',
      entryPrice: null,
      quantity: 1000,
      holdMinutes: 1,
      stopLoss: null,
      takeProfit: null,
    },
    entryIndicators: null,
  });

  const result = evaluateTradeOnKline({
    trade,
    currentIndex: 2,
    currentKline: klines[2],
    klineData: klines,
    exitIndicators: null,
  });

  assert.equal(trade.entryPrice, 150.5);
  assert.equal(result.exitReason, 'hold_time_reached');
  assert.equal(result.exitPrice, 149.5);
  assert.equal(result.grossPnl, -1000);
  assert.ok(result.pnl < 0);
}

async function testPlaybackServiceSupportsDirectTimestampRange() {
  const originalGetKlines = klinesAPI.getKlines;

  try {
    let capturedParams = null;
    klinesAPI.getKlines = async (params) => {
      capturedParams = params;
      return {
        success: true,
        data: [createKline({ openTime: 1 })],
      };
    };

    await loadKlineData({
      symbol: 'BTCJPY',
      interval: '1m',
      start: 1000,
      end: 2000,
    });

    assert.equal(capturedParams.interval, '1min');
    assert.equal(capturedParams.start, 1000);
    assert.equal(capturedParams.end, 2000);
  } finally {
    klinesAPI.getKlines = originalGetKlines;
  }
}

async function testPlaybackServiceUsesLocalTimeForManualSelection() {
  const originalGetKlines = klinesAPI.getKlines;

  try {
    let capturedParams = null;
    klinesAPI.getKlines = async (params) => {
      capturedParams = params;
      return {
        success: true,
        data: [createKline({ openTime: 1 })],
      };
    };

    await loadKlineData({
      symbol: 'USDJPY',
      interval: '5m',
      startDate: '2026-03-23',
      startTime: '09:00',
      endDate: '2026-03-23',
      endTime: '09:05',
    });

    assert.equal(capturedParams.interval, '5min');
    assert.equal(capturedParams.start, new Date('2026-03-23T09:00:00').getTime());
    assert.equal(capturedParams.end, new Date('2026-03-23T09:05:59').getTime());
  } finally {
    klinesAPI.getKlines = originalGetKlines;
  }
}

async function run() {
  await testManualTradeStartsNextBar();
  await testFxCommissionAppliedBothSides();
  await testBtcDailyLeverageFeeAppliedAtJstSettlement();
  await testStopLossWinsWhenSameBarAlsoHitsTakeProfit();
  await testShortTakeProfitAndHoldTimeFallback();
  await testLargeSpreadCreatesLossWithoutPriceMove();
  await testPlaybackServiceSupportsDirectTimestampRange();
  await testPlaybackServiceUsesLocalTimeForManualSelection();
  console.log('simulator-engine tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
