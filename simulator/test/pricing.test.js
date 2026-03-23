const {
  assert,
  simulator,
  createKline,
} = require('./helpers.js');

function testPriceHelpers() {
  const dual = createKline({
    openTime: Date.UTC(2026, 2, 23, 0, 0, 0),
    close: 150,
    high: 150.2,
    low: 149.8,
    bidClose: 149.99,
    askClose: 150.01,
    bidHigh: 150.19,
    bidLow: 149.79,
    askHigh: 150.21,
    askLow: 149.81,
  });

  assert.equal(simulator.getMidPrice(dual), 150);
  assert.equal(simulator.getReferencePrice(dual, 'long', true), 150.01);
  assert.equal(simulator.getReferencePrice(dual, 'long', false), 149.99);
  assert.equal(simulator.getReferencePrice(dual, 'short', true), 149.99);
  assert.equal(simulator.getReferencePrice(dual, 'short', false), 150.01);
  assert.equal(simulator.getTriggerPrice(dual, 'long', 'stop_loss', 150), 149.79);
  assert.equal(simulator.getTriggerPrice(dual, 'long', 'take_profit', 150), 150.19);
  assert.equal(simulator.getTriggerPrice(dual, 'short', 'stop_loss', 150), 150.21);
  assert.equal(simulator.getTriggerPrice(dual, 'short', 'take_profit', 150), 149.81);

  const fallback = createKline({
    close: 200,
    high: 205,
    low: 195,
    bidClose: null,
    askClose: null,
    bidHigh: undefined,
    bidLow: undefined,
    askHigh: undefined,
    askLow: undefined,
  });
  assert.equal(simulator.getMidPrice(fallback), 200);
  assert.equal(simulator.getReferencePrice(fallback, 'long', true), 200);
  assert.equal(simulator.getTriggerPrice(fallback, 'short', 'take_profit', 210), 195);
  assert.equal(simulator.getTriggerPrice(fallback, 'long', 'stop_loss', 210), 195);

  const snakeOnly = {
    close: '300',
    bid_close: '299.5',
    ask_close: '300.5',
    high: '305',
    low: '295',
    bid_low: null,
    ask_high: null,
  };
  assert.equal(simulator.getReferencePrice(snakeOnly, 'short', false), 300.5);
  assert.equal(simulator.getTriggerPrice(snakeOnly, 'long', 'stop_loss', 301), 295);
  assert.equal(simulator.getTriggerPrice(snakeOnly, 'short', 'stop_loss', 301), 305);
}

function testSettlementMarkPriceLookup() {
  const settlementTime = Date.UTC(2026, 2, 22, 21, 0, 0);
  const klines = [
    createKline({ openTime: Date.UTC(2026, 2, 22, 20, 59, 0), close: 999 }),
    undefined,
    createKline({ open_time: settlementTime, close: 1002, bid_close: 1001, ask_close: 1003 }),
  ];

  assert.equal(simulator.findSettlementMarkPrice(klines, 0, 2, settlementTime, 777), 1002);
  assert.equal(simulator.findSettlementMarkPrice(klines, 0, 1, settlementTime, 777), 777);
}

function testReferenceAndMarkPriceTradingCases() {
  const longEntryKline = createKline({
    close: 150,
    bidClose: 149.99,
    askClose: 150.01,
  });
  const flatExitKline = createKline({
    close: 150,
    bidClose: 149.99,
    askClose: 150.01,
  });
  const shortEntryKline = createKline({
    close: 150,
    bidClose: 149.98,
    askClose: 150.02,
  });

  assert.equal(simulator.getReferencePrice(longEntryKline, 'long', true), 150.01);
  assert.equal(simulator.getReferencePrice(flatExitKline, 'long', false), 149.99);
  assert.equal(simulator.getReferencePrice(shortEntryKline, 'short', true), 149.98);
  assert.equal(simulator.getReferencePrice(shortEntryKline, 'short', false), 150.02);

  const settlementTime = Date.UTC(2026, 2, 23, 21, 0, 0);
  const klines = [
    createKline({ openTime: Date.UTC(2026, 2, 23, 20, 59, 0), close: 999000 }),
    createKline({ openTime: Date.UTC(2026, 2, 23, 21, 1, 0), close: 1000100, bidClose: 1000000, askClose: 1000200 }),
    createKline({ openTime: Date.UTC(2026, 2, 23, 21, 2, 0), close: 1000200 }),
  ];

  assert.equal(simulator.findSettlementMarkPrice(klines, 0, 2, settlementTime, 555), 1000100);
}

function testStopLossAndTakeProfitTriggerWithReferencePriceCases() {
  const longKline = createKline({
    close: 100,
    high: 103,
    low: 97,
    bidClose: 99.8,
    askClose: 100.2,
    bidHigh: 102.6,
    bidLow: 97.4,
    askHigh: 103.2,
    askLow: 97.8,
  });

  const shortKline = createKline({
    close: 100,
    high: 104,
    low: 96,
    bidClose: 99.7,
    askClose: 100.3,
    bidHigh: 103.7,
    bidLow: 95.7,
    askHigh: 104.3,
    askLow: 96.3,
  });

  const longEntry = simulator.getReferencePrice(longKline, 'long', true);
  const longExitReference = simulator.getReferencePrice(longKline, 'long', false);
  const longStopTrigger = simulator.getTriggerPrice(longKline, 'long', 'stop_loss', longExitReference);
  const longTakeTrigger = simulator.getTriggerPrice(longKline, 'long', 'take_profit', longExitReference);

  assert.equal(longEntry, 100.2);
  assert.equal(longExitReference, 99.8);
  assert.equal(longStopTrigger, 97.4);
  assert.equal(longTakeTrigger, 102.6);
  assert.equal(longStopTrigger <= 98, true);
  assert.equal(longTakeTrigger >= 102, true);

  const shortEntry = simulator.getReferencePrice(shortKline, 'short', true);
  const shortExitReference = simulator.getReferencePrice(shortKline, 'short', false);
  const shortStopTrigger = simulator.getTriggerPrice(shortKline, 'short', 'stop_loss', shortExitReference);
  const shortTakeTrigger = simulator.getTriggerPrice(shortKline, 'short', 'take_profit', shortExitReference);

  assert.equal(shortEntry, 99.7);
  assert.equal(shortExitReference, 100.3);
  assert.equal(shortStopTrigger, 104.3);
  assert.equal(shortTakeTrigger, 96.3);
  assert.equal(shortStopTrigger >= 104, true);
  assert.equal(shortTakeTrigger <= 97, true);
}

module.exports = [
  { name: 'price helpers', run: testPriceHelpers },
  { name: 'settlement mark price lookup', run: testSettlementMarkPriceLookup },
  { name: 'reference and mark price trading cases', run: testReferenceAndMarkPriceTradingCases },
  { name: 'stop loss and take profit trigger with reference price cases', run: testStopLossAndTakeProfitTriggerWithReferencePriceCases },
];
