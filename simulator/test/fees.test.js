const {
  assert,
  simulator,
  createKline,
  createFxSpec,
  createCoinSpec,
  approxEqual,
} = require('./helpers.js');

function testCommissionFeeScenarios() {
  const fxSpec = createFxSpec();
  const fxPosition = {
    direction: 'long',
    entryPrice: 150,
    lotSize: 0.1,
    entryTime: Date.UTC(2026, 2, 22, 0, 0, 0),
    entryIndex: 0,
  };

  const fxFee = simulator.calculateCommissionFee({
    position: fxPosition,
    exitPrice: 151,
    exitTime: Date.UTC(2026, 2, 22, 1, 0, 0),
    exitIndex: 0,
    feeModel: simulator.resolveGmoSimulatorFeeModel('USDJPY'),
    symbolSpec: fxSpec,
    klines: [],
  });
  approxEqual(fxFee, 60.2);

  const leveragePosition = {
    direction: 'long',
    entryPrice: 1000000,
    lotSize: 0.01,
    entryTime: Date.UTC(2026, 2, 22, 20, 50, 0),
    entryIndex: 0,
  };
  const leverageFee = simulator.calculateCommissionFee({
    position: leveragePosition,
    exitPrice: 1001000,
    exitTime: Date.UTC(2026, 2, 22, 21, 10, 0),
    exitIndex: 2,
    activationIndex: 1,
    feeModel: simulator.resolveGmoSimulatorFeeModel('BTCJPY'),
    symbolSpec: createCoinSpec(),
    klines: [
      createKline({ openTime: Date.UTC(2026, 2, 22, 20, 55, 0), close: 999000 }),
      createKline({ openTime: Date.UTC(2026, 2, 22, 21, 0, 0), close: 1000200 }),
      createKline({ openTime: Date.UTC(2026, 2, 22, 21, 10, 0), close: 1001000 }),
    ],
  });
  approxEqual(leverageFee, 4.0008);

  const noDailyFee = simulator.calculateCommissionFee({
    position: leveragePosition,
    exitPrice: 1001000,
    exitTime: Date.UTC(2026, 2, 22, 21, 10, 0),
    exitIndex: 1,
    feeModel: {
      ...simulator.resolveGmoSimulatorFeeModel('BTCJPY'),
      dailyLeverageRate: 0,
    },
    symbolSpec: createCoinSpec(),
    klines: [],
  });
  approxEqual(noDailyFee, 0);

  const fallbackMarkFee = simulator.calculateCommissionFee({
    position: leveragePosition,
    exitPrice: 1005000,
    exitTime: Date.UTC(2026, 2, 22, 21, 10, 0),
    exitIndex: 0,
    feeModel: simulator.resolveGmoSimulatorFeeModel('BTCJPY'),
    symbolSpec: createCoinSpec(),
    klines: [createKline({ openTime: Date.UTC(2026, 2, 22, 20, 55, 0), close: 999000 })],
  });
  approxEqual(fallbackMarkFee, 4.02);

  assert.throws(
    () =>
      simulator.calculateCommissionFee({
        position: leveragePosition,
        exitPrice: 1001000,
        exitTime: Date.UTC(2026, 2, 22, 21, 10, 0),
        exitIndex: 1,
        feeModel: {
          ...simulator.resolveGmoSimulatorFeeModel('BTCJPY'),
          settlementHourJst: undefined,
        },
        symbolSpec: createCoinSpec(),
        klines: [],
      }),
    /settlementHourJst is required/
  );
}

function testTradeOutcomeScenarios() {
  const coinSpec = simulator.resolveSymbolSpecFromSymbol('ETHJPY');
  const longOutcome = simulator.calculateTradeOutcome({
    position: {
      direction: 'long',
      entryPrice: 100,
      lotSize: 2,
      entryTime: Date.UTC(2026, 2, 22, 0, 0, 0),
      entryIndex: 0,
    },
    exitPrice: 110,
    exitTime: Date.UTC(2026, 2, 22, 1, 0, 0),
    exitIndex: 1,
    feeModel: {
      venueCode: 'TEST',
      market: 'spot',
      commissionRate: 0.001,
      basis: 'notional',
      chargeOnEntry: true,
      chargeOnExit: true,
    },
    symbolSpec: coinSpec,
    klines: [],
  });

  assert.equal(longOutcome.grossPnl, 20);
  approxEqual(longOutcome.commissionFee, 0.42);
  approxEqual(longOutcome.netPnl, 19.58);
  assert.equal(longOutcome.pips, 10);
  assert.equal(longOutcome.percent, 10);

  const shortOutcome = simulator.calculateTradeOutcome({
    position: {
      direction: 'short',
      entryPrice: 150,
      lotSize: 1,
      entryTime: Date.UTC(2026, 2, 22, 0, 0, 0),
      entryIndex: 0,
    },
    exitPrice: 145,
    exitTime: Date.UTC(2026, 2, 22, 1, 0, 0),
    exitIndex: 1,
    feeModel: {
      venueCode: 'TEST',
      market: 'spot',
      commissionRate: 0,
      basis: 'notional',
      chargeOnEntry: false,
      chargeOnExit: false,
    },
    symbolSpec: coinSpec,
    klines: [],
  });
  assert.equal(shortOutcome.grossPnl, 5);
  assert.equal(shortOutcome.netPnl, 5);
  assert.equal(shortOutcome.percent, 100 / 30);

  const zeroEntryOutcome = simulator.calculateTradeOutcome({
    position: {
      direction: 'long',
      entryPrice: 0,
      lotSize: 1,
      entryTime: Date.UTC(2026, 2, 22, 0, 0, 0),
      entryIndex: 0,
    },
    exitPrice: 10,
    exitTime: Date.UTC(2026, 2, 22, 1, 0, 0),
    exitIndex: 1,
    feeModel: {
      venueCode: 'TEST',
      market: 'spot',
      commissionRate: 0,
      basis: 'notional',
      chargeOnEntry: false,
      chargeOnExit: false,
    },
    symbolSpec: coinSpec,
    klines: [],
  });
  assert.equal(zeroEntryOutcome.percent, 0);

  const leverageOutcome = simulator.calculateTradeOutcome({
    position: {
      direction: 'long',
      entryPrice: 1000000,
      lotSize: 0.01,
      entryTime: Date.UTC(2026, 2, 22, 20, 50, 0),
      entryIndex: 0,
    },
    exitPrice: 1001000,
    exitTime: Date.UTC(2026, 2, 22, 21, 10, 0),
    exitIndex: 1,
    activationIndex: 0,
    feeModel: simulator.resolveGmoSimulatorFeeModel('BTCJPY'),
    symbolSpec: createCoinSpec(),
    klines: [
      createKline({ openTime: Date.UTC(2026, 2, 22, 21, 0, 0), close: 1000000 }),
      createKline({ openTime: Date.UTC(2026, 2, 22, 21, 10, 0), close: 1001000 }),
    ],
  });
  assert.equal(leverageOutcome.grossPnl, 10);
  assert.equal(leverageOutcome.commissionFee, 4);
  assert.equal(leverageOutcome.netPnl, 6);

  const spreadOnlyLossOutcome = simulator.calculateTradeOutcome({
    position: {
      direction: 'long',
      entryPrice: 101,
      lotSize: 1,
      entryTime: Date.UTC(2026, 2, 22, 2, 0, 0),
      entryIndex: 0,
    },
    exitPrice: 99,
    exitTime: Date.UTC(2026, 2, 22, 2, 1, 0),
    exitIndex: 1,
    feeModel: {
      venueCode: 'TEST',
      market: 'spot',
      commissionRate: 0,
      basis: 'notional',
      chargeOnEntry: false,
      chargeOnExit: false,
    },
    symbolSpec: coinSpec,
    klines: [],
  });
  assert.equal(spreadOnlyLossOutcome.grossPnl, -2);
  assert.equal(spreadOnlyLossOutcome.commissionFee, 0);
  assert.equal(spreadOnlyLossOutcome.netPnl, -2);
  assert.equal(spreadOnlyLossOutcome.pips, -2);
}

module.exports = [
  { name: 'commission fee scenarios', run: testCommissionFeeScenarios },
  { name: 'trade outcome scenarios', run: testTradeOutcomeScenarios },
];
