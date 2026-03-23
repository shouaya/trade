const {
  simulator,
  createKline,
  createFxSpec,
  createCoinSpec,
  assertTradeOutcomeMatches,
} = require('./helpers.js');

function testTradingLifecycleScenarios() {
  const fxSpec = createFxSpec();
  const coinSpec = simulator.resolveSymbolSpecFromSymbol('ETHJPY');

  const scenarios = [
    {
      name: 'fx long profit with entry and exit commission',
      params: {
        position: {
          direction: 'long',
          entryPrice: 150,
          lotSize: 0.1,
          entryTime: Date.UTC(2026, 2, 23, 0, 0, 0),
          entryIndex: 0,
        },
        exitPrice: 150.5,
        exitTime: Date.UTC(2026, 2, 23, 0, 10, 0),
        exitIndex: 1,
        feeModel: simulator.resolveGmoSimulatorFeeModel('USDJPY'),
        symbolSpec: fxSpec,
        klines: [],
      },
      expected: {
        grossPnl: 5000,
        commissionFee: 60.1,
        netPnl: 4939.9,
        pips: 50,
        percent: (0.5 / 150) * 100,
      },
    },
    {
      name: 'fx short loss with entry and exit commission',
      params: {
        position: {
          direction: 'short',
          entryPrice: 150,
          lotSize: 0.1,
          entryTime: Date.UTC(2026, 2, 23, 1, 0, 0),
          entryIndex: 0,
        },
        exitPrice: 150.4,
        exitTime: Date.UTC(2026, 2, 23, 1, 15, 0),
        exitIndex: 1,
        feeModel: simulator.resolveGmoSimulatorFeeModel('USDJPY'),
        symbolSpec: fxSpec,
        klines: [],
      },
      expected: {
        grossPnl: -4000,
        commissionFee: 60.08,
        netPnl: -4060.08,
        pips: -40,
        percent: (-0.4 / 150) * 100,
      },
    },
    {
      name: 'spot long profit with entry-only commission',
      params: {
        position: {
          direction: 'long',
          entryPrice: 100,
          lotSize: 2,
          entryTime: Date.UTC(2026, 2, 23, 2, 0, 0),
          entryIndex: 0,
        },
        exitPrice: 108,
        exitTime: Date.UTC(2026, 2, 23, 2, 30, 0),
        exitIndex: 1,
        feeModel: {
          venueCode: 'TEST',
          market: 'spot',
          commissionRate: 0.001,
          basis: 'notional',
          chargeOnEntry: true,
          chargeOnExit: false,
        },
        symbolSpec: coinSpec,
        klines: [],
      },
      expected: {
        grossPnl: 16,
        commissionFee: 0.2,
        netPnl: 15.8,
        pips: 8,
        percent: 8,
      },
    },
    {
      name: 'spot short profit with exit-only commission',
      params: {
        position: {
          direction: 'short',
          entryPrice: 100,
          lotSize: 3,
          entryTime: Date.UTC(2026, 2, 23, 3, 0, 0),
          entryIndex: 0,
        },
        exitPrice: 90,
        exitTime: Date.UTC(2026, 2, 23, 3, 45, 0),
        exitIndex: 1,
        feeModel: {
          venueCode: 'TEST',
          market: 'spot',
          commissionRate: 0.002,
          basis: 'notional',
          chargeOnEntry: false,
          chargeOnExit: true,
        },
        symbolSpec: coinSpec,
        klines: [],
      },
      expected: {
        grossPnl: 30,
        commissionFee: 0.54,
        netPnl: 29.46,
        pips: 10,
        percent: 10,
      },
    },
    {
      name: 'exchange leverage crosses two settlements',
      params: {
        position: {
          direction: 'long',
          entryPrice: 1000000,
          lotSize: 0.01,
          entryTime: Date.UTC(2026, 2, 22, 20, 50, 0),
          entryIndex: 0,
        },
        exitPrice: 1002000,
        exitTime: Date.UTC(2026, 2, 23, 21, 10, 0),
        exitIndex: 2,
        activationIndex: 0,
        feeModel: simulator.resolveGmoSimulatorFeeModel('BTCJPY'),
        symbolSpec: createCoinSpec(),
        klines: [
          createKline({ openTime: Date.UTC(2026, 2, 22, 21, 0, 0), close: 1000000 }),
          createKline({ openTime: Date.UTC(2026, 2, 23, 21, 0, 0), close: 1005000 }),
          createKline({ openTime: Date.UTC(2026, 2, 23, 21, 10, 0), close: 1002000 }),
        ],
      },
      expected: {
        grossPnl: 20,
        commissionFee: 8.02,
        netPnl: 11.98,
        pips: 2000,
        percent: 0.2,
      },
    },
    {
      name: 'exchange leverage exits before settlement so no daily fee',
      params: {
        position: {
          direction: 'long',
          entryPrice: 1000000,
          lotSize: 0.01,
          entryTime: Date.UTC(2026, 2, 22, 20, 50, 0),
          entryIndex: 0,
        },
        exitPrice: 999000,
        exitTime: Date.UTC(2026, 2, 22, 20, 59, 0),
        exitIndex: 0,
        activationIndex: 0,
        feeModel: simulator.resolveGmoSimulatorFeeModel('BTCJPY'),
        symbolSpec: createCoinSpec(),
        klines: [createKline({ openTime: Date.UTC(2026, 2, 22, 20, 59, 0), close: 999000 })],
      },
      expected: {
        grossPnl: -10,
        commissionFee: 0,
        netPnl: -10,
        pips: -1000,
        percent: -0.1,
      },
    },
    {
      name: 'exchange leverage crosses four settlements and accumulates funding fees',
      params: {
        position: {
          direction: 'long',
          entryPrice: 1000000,
          lotSize: 0.01,
          entryTime: Date.UTC(2026, 2, 20, 20, 50, 0),
          entryIndex: 0,
        },
        exitPrice: 1004000,
        exitTime: Date.UTC(2026, 2, 24, 21, 10, 0),
        exitIndex: 4,
        activationIndex: 0,
        feeModel: simulator.resolveGmoSimulatorFeeModel('BTCJPY'),
        symbolSpec: createCoinSpec(),
        klines: [
          createKline({ openTime: Date.UTC(2026, 2, 20, 21, 0, 0), close: 1000000 }),
          createKline({ openTime: Date.UTC(2026, 2, 21, 21, 0, 0), close: 1001000 }),
          createKline({ openTime: Date.UTC(2026, 2, 22, 21, 0, 0), close: 1002000 }),
          createKline({ openTime: Date.UTC(2026, 2, 23, 21, 0, 0), close: 1003000 }),
          createKline({ openTime: Date.UTC(2026, 2, 24, 21, 10, 0), close: 1004000 }),
        ],
      },
      expected: {
        grossPnl: 40,
        commissionFee: 20.04,
        netPnl: 19.96,
        pips: 4000,
        percent: 0.4,
      },
    },
    {
      name: 'exchange leverage short crosses three settlements and remains profitable after funding',
      params: {
        position: {
          direction: 'short',
          entryPrice: 1000000,
          lotSize: 0.01,
          entryTime: Date.UTC(2026, 2, 20, 20, 50, 0),
          entryIndex: 0,
        },
        exitPrice: 998000,
        exitTime: Date.UTC(2026, 2, 23, 21, 10, 0),
        exitIndex: 3,
        activationIndex: 0,
        feeModel: simulator.resolveGmoSimulatorFeeModel('BTCJPY'),
        symbolSpec: createCoinSpec(),
        klines: [
          createKline({ openTime: Date.UTC(2026, 2, 20, 21, 0, 0), close: 1000000 }),
          createKline({ openTime: Date.UTC(2026, 2, 21, 21, 0, 0), close: 999500 }),
          createKline({ openTime: Date.UTC(2026, 2, 22, 21, 0, 0), close: 999000 }),
          createKline({ openTime: Date.UTC(2026, 2, 23, 21, 10, 0), close: 998000 }),
        ],
      },
      expected: {
        grossPnl: 20,
        commissionFee: 15.986,
        netPnl: 4.014,
        pips: 2000,
        percent: 0.2,
      },
    },
    {
      name: 'spot long loss includes both-side commission drag',
      params: {
        position: {
          direction: 'long',
          entryPrice: 100,
          lotSize: 5,
          entryTime: Date.UTC(2026, 2, 23, 4, 0, 0),
          entryIndex: 0,
        },
        exitPrice: 98,
        exitTime: Date.UTC(2026, 2, 23, 4, 20, 0),
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
      },
      expected: {
        grossPnl: -10,
        commissionFee: 0.99,
        netPnl: -10.99,
        pips: -2,
        percent: -2,
      },
    },
  ];

  for (const scenario of scenarios) {
    const actual = simulator.calculateTradeOutcome(scenario.params);
    assertTradeOutcomeMatches(actual, scenario.expected);
  }
}

module.exports = [
  { name: 'trading lifecycle scenarios', run: testTradingLifecycleScenarios },
];
