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
    '--types=rsi_only,foo',
    '--topN',
    '3',
    '--retainDays=7'
  ]);

  assert.equal(parsed.limit, 25);
  assert.deepEqual(parsed.types, ['rsi_only', 'foo']);
  assert.equal(parsed.topN, 3);
  assert.equal(parsed.retainDays, 7);

  const positional = parseTrainCliArgs(['node', 'script.js', '9', 'rsi_only,bar']);
  assert.equal(positional.limit, 9);
  assert.deepEqual(positional.types, ['rsi_only', 'bar']);
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
  const loaded = loadNamedConfig('training', '2024_atr');
  assert.equal(loaded.name, '2024_V3_RSI_ATR');

  assert.throws(() => loadNamedConfig('training', '../evil'), /invalid config name/);

  const invalidConfigPath = path.join(process.cwd(), 'configs', 'training', 'tmp_invalid_config.json');
  fs.writeFileSync(invalidConfigPath, '{invalid-json', 'utf8');
  try {
    assert.throws(() => loadNamedConfig('training', 'tmp_invalid_config'), /invalid json config/);
  } finally {
    fs.unlinkSync(invalidConfigPath);
  }

  assert.throws(() => loadNamedConfig('training', 'missing_config'), /config not found/);
});
