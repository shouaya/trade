const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  validateFeeModelConfig,
  enumerateJstSettlementTimes,
} = require('../dist/services/fee-model.js');

test('fee model validates exchange leverage config and enumerates JST settlement boundaries', () => {
  const config = validateFeeModelConfig({
    venueCode: 'GMOCOIN',
    market: 'exchange-leverage',
    productCode: 'BTC_JPY',
    commissionRate: 0,
    basis: 'notional',
    chargeOnEntry: true,
    chargeOnExit: false,
    leverageMultiplier: 2,
    dailyLeverageRate: 0.0004,
    liquidationFeeRate: 0.005,
    forcedCloseFeeRate: 0.005,
    settlementHourJst: 6,
  });

  assert.equal(config.productCode, 'BTC_JPY');

  const settlements = enumerateJstSettlementTimes(
    Date.parse('2026-03-24T20:30:00.000Z'),
    Date.parse('2026-03-26T00:30:00.000Z'),
    6
  );

  assert.deepEqual(settlements, [
    Date.parse('2026-03-24T21:00:00.000Z'),
    Date.parse('2026-03-25T21:00:00.000Z'),
  ]);
  assert.deepEqual(
    enumerateJstSettlementTimes(Date.parse('2026-03-24T21:00:00.000Z'), Date.parse('2026-03-24T21:00:00.000Z'), 6),
    []
  );
});

test('fee model rejects incomplete or invalid runnable fee settings', () => {
  assert.throws(
    () => validateFeeModelConfig(null),
    /feeModel is required/
  );
  assert.throws(
    () => validateFeeModelConfig({
      venueCode: 'GMOCOIN',
      market: 'exchange-leverage',
      productCode: '',
      commissionRate: 0,
      basis: 'notional',
      chargeOnEntry: true,
      chargeOnExit: true,
      leverageMultiplier: 2,
      dailyLeverageRate: 0.0004,
      liquidationFeeRate: 0.005,
      settlementHourJst: 6,
    }),
    /productCode is required/
  );
  assert.throws(
    () => validateFeeModelConfig({
      venueCode: 'GMOCOIN',
      market: 'spot',
      commissionRate: 0,
      basis: 'points',
      chargeOnEntry: true,
      chargeOnExit: true,
    }),
    /basis must be explicitly set to "notional"/
  );
  assert.throws(
    () => validateFeeModelConfig({
      venueCode: 'GMOCOIN',
      market: 'exchange-leverage',
      productCode: 'BTC_JPY',
      commissionRate: 0,
      basis: 'notional',
      chargeOnEntry: 'yes',
      chargeOnExit: true,
      leverageMultiplier: 2,
      dailyLeverageRate: 0.0004,
      liquidationFeeRate: 0.005,
      settlementHourJst: 6,
    }),
    /chargeOnEntry must be explicitly true or false/
  );
  assert.throws(
    () => validateFeeModelConfig({
      venueCode: 'GMOCOIN',
      market: 'exchange-leverage',
      productCode: 'BTC_JPY',
      commissionRate: 0,
      basis: 'notional',
      chargeOnEntry: true,
      chargeOnExit: true,
      leverageMultiplier: 0,
      dailyLeverageRate: 0.0004,
      liquidationFeeRate: 0.005,
      settlementHourJst: 24,
    }),
    /leverageMultiplier must be > 0/
  );
  assert.throws(
    () => validateFeeModelConfig({
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
      settlementHourJst: 24,
    }),
    /settlementHourJst must be an integer between 0 and 23/
  );
});
