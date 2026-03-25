const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const { TRAIN_ARTIFACTS_TABLE } = require('@money/database');
const { saveTrainArtifact } = require('../dist/services/train-artifact-store.js');

test('train artifact store ensures schema and upserts normalized artifact payload', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('SHOW INDEX')) {
        return [[], {}];
      }
      return [[], {}];
    },
  };

  await saveTrainArtifact(db, {
    artifactKey: 'goal-tracking:train-001',
    artifactType: 'goal-tracking',
    trainId: ' train-001 ',
    configId: '12',
    configKey: ' configs/training/demo.json ',
    symbol: ' BTCJPY ',
    intervalType: ' 1min ',
    periodStartMs: '1710000000000',
    periodEndMs: 1710003600000,
    reportPath: ' reports/demo.md ',
    summaryPath: '',
    summaryMarkdown: '# summary',
    payload: { score: 0.8 },
    metadata: { version: 1 },
  });

  assert.ok(queries.some((entry) => entry.sql.includes(`INSERT INTO ${TRAIN_ARTIFACTS_TABLE}`)));
  const insertQuery = queries.find((entry) => entry.sql.includes(`INSERT INTO ${TRAIN_ARTIFACTS_TABLE}`));
  assert.deepEqual(insertQuery.params, [
    'goal-tracking:train-001',
    'goal-tracking',
    'train-001',
    12,
    'configs/training/demo.json',
    'BTCJPY',
    '1min',
    1710000000000,
    1710003600000,
    'reports/demo.md',
    null,
    '# summary',
    JSON.stringify({ score: 0.8 }),
    JSON.stringify({ version: 1 }),
  ]);
});

test('train artifact store writes nullable fields as null', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('SHOW INDEX')) {
        return [[], {}];
      }
      return [[], {}];
    },
  };

  await saveTrainArtifact(db, {
    artifactKey: 'ai-summary:train-001',
    artifactType: 'ai-summary',
    payload: null,
  });

  const insertQuery = queries.find((entry) => entry.sql.includes(`INSERT INTO ${TRAIN_ARTIFACTS_TABLE}`));
  assert.deepEqual(insertQuery.params.slice(2), [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    JSON.stringify(null),
    null,
  ]);
});
