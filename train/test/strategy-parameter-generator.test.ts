const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  generateStrategyCombinations,
  countByType
} = require('../dist/services/strategy-parameter-generator.js');

test('generateStrategyCombinations preserves schedule, restriction, and ATR-only latest mode', () => {
  const restriction = {
    enabled: true,
    utcExcludeStart: '19:30',
    utcExcludeEnd: '23:59'
  };

  const strategies = generateStrategyCombinations({
    limit: 1,
    parameters: {
      rsi: {
        period: [7],
        oversold: [32],
        overbought: [68]
      },
      macd: {
        fastPeriod: [4],
        slowPeriod: [9],
        signalPeriod: [3],
        histogramThreshold: [0]
      },
      risk: {
        maxPositions: [1],
        lotSize: [0.25],
        maxHoldMinutes: [6]
      },
      atr: {
        slMultiplier: [1.5],
        tpMultiplier: [1.0]
      },
      tradingSchedule: '* * * * 1-5',
      tradingTimeRestriction: restriction
    }
  });

  assert.equal(strategies.length, 1);
  assert.equal(strategies[0]?.type, 'rsi_macd');
  assert.equal(strategies[0]?.parameters.risk.lotSize, 0.25);
  assert.equal(strategies[0]?.parameters.atr.slMultiplier, 1.5);
  assert.equal(strategies[0]?.parameters.tradingSchedule, '* * * * 1-5');
  assert.deepEqual(strategies[0]?.parameters.tradingTimeRestriction, restriction);
});

test('generateStrategyCombinations rejects unsupported legacy strategy types', () => {
  assert.throws(
    () =>
      generateStrategyCombinations({
        types: ['rsi_only']
      }),
    /unsupported strategy types/
  );
});

test('generateStrategyCombinations skips invalid RSI and MACD ranges and respects limit', () => {
  const limited = generateStrategyCombinations({
    limit: 1,
    parameters: {
      rsi: {
        period: [14],
        oversold: [30, 50],
        overbought: [70, 75]
      },
      macd: {
        fastPeriod: [4, 10],
        slowPeriod: [9],
        signalPeriod: [3],
        histogramThreshold: [0]
      },
      risk: {
        maxPositions: [1],
        lotSize: [0.1],
        maxHoldMinutes: [30]
      },
      atr: {
        slMultiplier: [2],
        tpMultiplier: [1]
      }
    }
  });

  assert.equal(limited.length, 1);
  assert.match(limited[0]?.name ?? '', /^RSIMACD-/);
});

test('generateStrategyCombinations supports dynamic hold and countByType only returns latest type', () => {
  const strategies = generateStrategyCombinations({
    parameters: {
      rsi: {
        period: [7],
        oversold: [35],
        overbought: [65]
      },
      macd: {
        fastPeriod: [4],
        slowPeriod: [9],
        signalPeriod: [3],
        histogramThreshold: [0]
      },
      risk: {
        maxPositions: [1],
        lotSize: [0.1],
        maxHoldMinutes: [null]
      },
      atr: {
        slMultiplier: [1.5],
        tpMultiplier: [1.0]
      }
    }
  });

  assert.equal(strategies.length, 1);
  assert.equal(strategies[0]?.parameters.risk.maxHoldMinutes, null);
  assert.match(strategies[0]?.name ?? '', /-Hdynamic-/);
  assert.deepEqual(countByType(strategies), { rsi_macd: 1 });
});

test('generateStrategyCombinations requires macd and atr parameter spaces', () => {
  assert.throws(
    () =>
      generateStrategyCombinations({
        parameters: {
          macd: {
            fastPeriod: [],
            slowPeriod: [9],
            signalPeriod: [3],
            histogramThreshold: [0]
          }
        }
      }),
    /requires macd parameter space/
  );

  assert.throws(
    () =>
      generateStrategyCombinations({
        parameters: {
          atr: {
            slMultiplier: [],
            tpMultiplier: [1]
          }
        }
      }),
    /requires atr parameter space/
  );
});
