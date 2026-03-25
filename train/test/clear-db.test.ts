const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  buildClearPlan,
  clearDatabase,
} = require('../dist/scripts/clear-db.js');

test('clear db plan preserves klines by default and ignores unknown tables', () => {
  const plan = buildClearPlan([
    'klines',
    'train_configs',
    'train_artifacts',
    'feature_memories',
    'custom_manual_table',
  ], {
    includeKlines: false,
    dryRun: false,
  });

  assert.deepEqual(plan.preservedTables, ['klines']);
  assert.deepEqual(plan.targetTables, [
    'feature_memories',
    'train_artifacts',
    'train_configs',
  ]);
  assert.deepEqual(plan.unknownTables, ['custom_manual_table']);
});

test('clear db execution truncates only known target tables and can include klines explicitly', async () => {
  const queries = [];
  const db = {
    async query(sql) {
      const text = String(sql);
      queries.push(text);

      if (text === 'SHOW TABLES') {
        return [[
          { Tables_in_trading: 'klines' },
          { Tables_in_trading: 'train_configs' },
          { Tables_in_trading: 'train_artifacts' },
          { Tables_in_trading: 'custom_manual_table' },
        ], {}];
      }

      if (text.startsWith('SELECT COUNT(*) AS row_count FROM ')) {
        return [[{ row_count: 5 }], {}];
      }

      if (text === 'SET FOREIGN_KEY_CHECKS = 0' || text === 'SET FOREIGN_KEY_CHECKS = 1') {
        return [[], {}];
      }

      if (text.startsWith('TRUNCATE TABLE ')) {
        return [[], {}];
      }

      throw new Error(`Unexpected SQL in clear-db test: ${text}`);
    },
  };

  await clearDatabase(db, {
    includeKlines: true,
    dryRun: false,
  });

  assert.ok(queries.includes('TRUNCATE TABLE `klines`'));
  assert.ok(queries.includes('TRUNCATE TABLE `train_configs`'));
  assert.ok(queries.includes('TRUNCATE TABLE `train_artifacts`'));
  assert.ok(!queries.includes('TRUNCATE TABLE `custom_manual_table`'));
});
