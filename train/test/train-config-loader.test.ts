const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { test } = require('./harness.ts');
const {
  loadTrainConfigContentByKey,
  loadConfigContentFromFileOrDb,
  loadConfigContentByRelativeRef,
} = require('../dist/services/train-config-loader.js');

test('train config loader reads config content from db by key', async () => {
  const db = {
    async query(sql, params = []) {
      const text = String(sql);
      assert.match(text, /FROM train_configs tc/);
      assert.equal(params[0], 'configs/validation/demo.json');
      return [[{
        content: JSON.stringify({
          name: 'DEMO_VALIDATION',
          trainId: 'train-demo-1',
        }),
      }], {}];
    },
  };

  const content = await loadTrainConfigContentByKey(db, 'configs/validation/demo.json');
  assert.equal(content.name, 'DEMO_VALIDATION');
  assert.equal(content.trainId, 'train-demo-1');
});

test('train config loader prefers filesystem when file exists', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'money-config-loader-'));
  const filePath = path.join(tempDir, 'sample.json');
  fs.writeFileSync(filePath, JSON.stringify({ name: 'LOCAL_SAMPLE' }), 'utf8');

  try {
    const loaded = await loadConfigContentFromFileOrDb({ query: async () => {
      throw new Error('db should not be used when file exists');
    } }, filePath);

    assert.equal(loaded.content.name, 'LOCAL_SAMPLE');
    assert.equal(loaded.absolutePath, filePath);
    assert.equal(loaded.configKey, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('train config loader resolves relative refs through db config keys', async () => {
  const db = {
    async query(_sql, params = []) {
      assert.equal(params[0], 'configs/generated/regime-routing/demo_router.policy.json');
      return [[{
        content: {
          catalogVersion: 'policy_v1',
        },
      }], {}];
    },
  };

  const content = await loadConfigContentByRelativeRef(
    db,
    'configs/generated/regime-routing/demo_router.json',
    './demo_router.policy.json'
  );

  assert.equal(content.catalogVersion, 'policy_v1');
});
