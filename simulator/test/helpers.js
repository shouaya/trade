const assert = require('node:assert/strict');

const simulator = require('../dist/index.js');

function createKline({
  openTime,
  open_time,
  close,
  high = close,
  low = close,
  bidClose,
  askClose,
  bidHigh,
  bidLow,
  askHigh,
  askLow,
  bid_close,
  ask_close,
  bid_high,
  bid_low,
  ask_high,
  ask_low,
} = {}) {
  return {
    openTime: openTime === undefined ? undefined : String(openTime),
    open_time: open_time === undefined ? undefined : String(open_time),
    close: String(close ?? 100),
    high: String(high),
    low: String(low),
    bidClose: bidClose === undefined ? undefined : String(bidClose),
    askClose: askClose === undefined ? undefined : String(askClose),
    bidHigh: bidHigh === undefined ? undefined : String(bidHigh),
    bidLow: bidLow === undefined ? undefined : String(bidLow),
    askHigh: askHigh === undefined ? undefined : String(askHigh),
    askLow: askLow === undefined ? undefined : String(askLow),
    bid_close: bid_close === undefined ? undefined : String(bid_close),
    ask_close: ask_close === undefined ? undefined : String(ask_close),
    bid_high: bid_high === undefined ? undefined : String(bid_high),
    bid_low: bid_low === undefined ? undefined : String(bid_low),
    ask_high: ask_high === undefined ? undefined : String(ask_high),
    ask_low: ask_low === undefined ? undefined : String(ask_low),
  };
}

function createFxSpec() {
  return simulator.resolveSymbolSpecFromSymbol('USDJPY');
}

function createCoinSpec() {
  return simulator.resolveSymbolSpecFromSymbol('BTCJPY');
}

function approxEqual(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${expected}, got ${actual}`);
}

function assertTradeOutcomeMatches(actual, expected) {
  approxEqual(actual.grossPnl, expected.grossPnl);
  approxEqual(actual.commissionFee, expected.commissionFee);
  approxEqual(actual.netPnl, expected.netPnl);
  approxEqual(actual.pips, expected.pips);
  approxEqual(actual.percent, expected.percent);
}

function runCases(cases) {
  for (const testCase of cases) {
    testCase.run();
  }
}

module.exports = {
  assert,
  simulator,
  createKline,
  createFxSpec,
  createCoinSpec,
  approxEqual,
  assertTradeOutcomeMatches,
  runCases,
};
