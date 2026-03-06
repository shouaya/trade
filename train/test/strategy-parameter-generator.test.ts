const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  generateStrategyCombinations,
  countByType
} = require('../dist/services/strategy-parameter-generator.js');

test('generateStrategyCombinations preserves schedule, restriction, and lot size overrides', () => {
  const restriction = {
    enabled: true,
    utcExcludeStart: '19:30',
    utcExcludeEnd: '23:59'
  } as const;

  const strategies = generateStrategyCombinations({
    limit: 1,
    parameters: {
      rsi: {
        period: [14],
        oversold: [30],
        overbought: [70]
      },
      risk: {
        maxPositions: [1],
        lotSize: [0.25],
        stopLossPercent: [0.1],
        takeProfitPercent: [0.2],
        maxHoldMinutes: [30]
      },
      tradingSchedule: '* * * * 1-5',
      tradingTimeRestriction: restriction
    }
  });

  assert.equal(strategies.length, 1);
  assert.equal(strategies[0]?.parameters.risk.lotSize, 0.25);
  assert.equal(strategies[0]?.parameters.tradingSchedule, '* * * * 1-5');
  assert.deepEqual(strategies[0]?.parameters.tradingTimeRestriction, restriction);
});

test('generateStrategyCombinations rejects unsupported legacy strategy types', () => {
  assert.throws(
    () =>
      generateStrategyCombinations({
        types: ['macd_only' as never]
      }),
    /unsupported strategy types/
  );
});

test('generateStrategyCombinations covers non-ATR mode, default type, and no-limit path', () => {
  const strategies = generateStrategyCombinations({
    parameters: {
      rsi: {
        period: [14],
        oversold: [30],
        overbought: [70, 75]
      },
      risk: {
        maxPositions: [1],
        lotSize: [0.1],
        stopLossPercent: [null, 0.1],
        takeProfitPercent: [0.2],
        maxHoldMinutes: [30]
      },
      tradingTimeRestriction: null
    }
  });

  assert.equal(strategies.length, 4);
  assert.equal(strategies[0]?.type, 'rsi_only');
  assert.equal('tradingSchedule' in (strategies[0]?.parameters ?? {}), false);
  assert.equal(strategies[0]?.parameters.tradingTimeRestriction, null);
  assert.deepEqual(countByType(strategies), { rsi_only: 4 });
});

test('generateStrategyCombinations respects limit and skips invalid RSI ranges', () => {
  const limited = generateStrategyCombinations({
    types: ['rsi_only'],
    limit: 1,
    parameters: {
      rsi: {
        period: [14],
        oversold: [30, 50],
        overbought: [70, 75]
      },
      risk: {
        maxPositions: [1],
        lotSize: [0.1],
        stopLossPercent: [0.1],
        takeProfitPercent: [0.2],
        maxHoldMinutes: [30]
      }
    }
  });

  assert.equal(limited.length, 1);
  assert.match(limited[0]?.name ?? '', /^RSI-P14-/);
});

test('generateStrategyCombinations covers ATR mode without limit', () => {
  const strategies = generateStrategyCombinations({
    types: ['rsi_only'],
    parameters: {
      rsi: {
        period: [14],
        oversold: [30],
        overbought: [70]
      },
      risk: {
        maxPositions: [1],
        lotSize: [0.2],
        stopLossPercent: [0.1],
        takeProfitPercent: [0.2],
        maxHoldMinutes: [15]
      },
      atr: {
        slMultiplier: [2, 3],
        tpMultiplier: [4]
      },
      tradingSchedule: 'WEEKDAYS'
    }
  });

  assert.equal(strategies.length, 2);
  assert.match(strategies[0]?.name ?? '', /ATRSL2-ATRTP4/);
  assert.equal(strategies[0]?.parameters.risk.stopLossPercent, null);
  assert.equal(strategies[0]?.parameters.risk.takeProfitPercent, null);
  assert.equal(strategies[0]?.parameters.risk.lotSize, 0.2);
  assert.deepEqual(strategies.map(strategy => strategy.parameters.atr?.slMultiplier), [2, 3]);
});

test('generateStrategyCombinations supports dynamic hold with null maxHoldMinutes', () => {
  const strategies = generateStrategyCombinations({
    types: ['rsi_only'],
    parameters: {
      rsi: {
        period: [14],
        oversold: [30],
        overbought: [70]
      },
      risk: {
        maxPositions: [1],
        lotSize: [0.1],
        stopLossPercent: [0.1],
        takeProfitPercent: [0.2],
        maxHoldMinutes: [null]
      }
    }
  });

  assert.equal(strategies.length, 1);
  assert.equal(strategies[0]?.parameters.risk.maxHoldMinutes, null);
  assert.match(strategies[0]?.name ?? '', /-Hdynamic-/);
});
