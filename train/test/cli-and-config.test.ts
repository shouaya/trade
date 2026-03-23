const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { test } = require('./harness.ts');
const { parseTrainCliArgs } = require('../dist/scripts/_common.js');
const { extractConfigArg, loadNamedConfig } = require('../dist/scripts/_config.js');

test('parseTrainCliArgs parses named flags and positional fallbacks', () => {
  const parsed = parseTrainCliArgs([
    'node',
    'script.js',
    '--limit=25',
    '--types=rsi_macd,foo',
    '--topN',
    '3',
    '--retainDays=7'
  ]);

  assert.equal(parsed.limit, 25);
  assert.deepEqual(parsed.types, ['rsi_macd', 'foo']);
  assert.equal(parsed.topN, 3);
  assert.equal(parsed.retainDays, 7);

  const positional = parseTrainCliArgs(['node', 'script.js', '9', 'rsi_macd,bar']);
  assert.equal(positional.limit, 9);
  assert.deepEqual(positional.types, ['rsi_macd', 'bar']);
});

test('extractConfigArg returns config override and passthrough args', () => {
  const parsed = extractConfigArg(
    ['node', 'script.js', '--config', 'custom_name', '--limit', '10'],
    'default_name'
  );

  assert.equal(parsed.configName, 'custom_name');
  assert.deepEqual(parsed.passthroughArgv, ['node', 'script.js', '--limit', '10']);
});

test('loadNamedConfig loads json and rejects unsafe or invalid configs', () => {
  const trainingDir = path.join(process.cwd(), 'configs', 'training');
  fs.mkdirSync(trainingDir, { recursive: true });

  const validConfigPath = path.join(trainingDir, 'tmp_valid_config.json');
  fs.writeFileSync(validConfigPath, JSON.stringify({
    name: 'TMP_VALID_CONFIG',
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
          settlementHourJst: 6
        }
      }
    }
  }, null, 2), 'utf8');

  const loaded = loadNamedConfig('training', 'tmp_valid_config');
  assert.equal(loaded.name, 'TMP_VALID_CONFIG');
  assert.equal(loaded.executor.options.feeModel.venueCode, 'GMOCOIN');
  assert.equal(loaded.executor.options.feeModel.market, 'exchange-leverage');
  assert.equal(loaded.executor.options.feeModel.commissionRate, 0);
  assert.equal(loaded.executor.options.feeModel.dailyLeverageRate, 0.0004);

  assert.throws(() => loadNamedConfig('training', '../evil'), /invalid config name/);

  const invalidConfigPath = path.join(trainingDir, 'tmp_invalid_config.json');
  fs.writeFileSync(invalidConfigPath, '{invalid-json', 'utf8');
  try {
    assert.throws(() => loadNamedConfig('training', 'tmp_invalid_config'), /invalid json config/);
  } finally {
    fs.unlinkSync(validConfigPath);
    fs.unlinkSync(invalidConfigPath);
  }

  assert.throws(() => loadNamedConfig('training', 'missing_config'), /config not found/);
});
