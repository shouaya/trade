const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  normalizeTrainConfigKey,
  buildTrainConfigMetadata,
} = require('../dist/services/train-config-registry.js');

test('train config registry normalizes config key and rejects invalid paths', () => {
  assert.equal(
    normalizeTrainConfigKey('\\configs\\training\\\\2026_btcjpy_alpha.json'),
    'configs/training/2026_btcjpy_alpha.json'
  );

  assert.throws(
    () => normalizeTrainConfigKey('../configs/training/2026_btcjpy_alpha.json'),
    /configKey 不能包含/
  );
});

test('train config registry builds metadata for runnable training config', () => {
  const metadata = buildTrainConfigMetadata(
    'configs/training/2026_btcjpy_alpha.json',
    {
      name: '2026_BTCJPY_ALPHA',
      timeRange: {
        startIso: '2026-01-01T00:00:00.000Z',
      },
      market: {
        symbol: 'btcjpy',
        intervalType: '1min',
      },
      database: {
        tableName: 'btcjpy_alpha_train_2026',
      },
      executor: {
        options: {
          feeModel: {
            venueCode: 'GMOCOIN',
            market: 'exchange-leverage',
            productCode: 'BTC_JPY',
            commissionRate: 0,
            basis: 'notional',
            chargeOnEntry: true,
            chargeOnExit: true,
            leverageMultiplier: 2,
            dailyLeverageRate: 0.0004,
            liquidationFeeRate: 0.005,
            forcedCloseFeeRate: 0.005,
            settlementHourJst: 6,
          },
        },
      },
    }
  );

  assert.equal(metadata.configType, 'training');
  assert.equal(metadata.symbol, 'BTCJPY');
  assert.equal(metadata.trainingYear, '2026');
  assert.equal(metadata.resultGroup, 'btcjpy_alpha_train_2026');
  assert.equal(typeof metadata.contentHash, 'string');
  assert.ok(metadata.contentHash.length > 10);
});

test('train config registry requires explicit fee model for runnable config', () => {
  assert.throws(
    () => buildTrainConfigMetadata(
      'configs/validation/2026_btcjpy_alpha_validation.json',
      {
        name: 'BTCJPY_FUTURE_VALIDATION',
      }
    ),
    /feeModel 为必填/
  );
});
