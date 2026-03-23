const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  buildRunCommand,
  resolveAllowedActions,
  resolveRunRequestAction,
  buildClearResultsPlan,
} = require('../dist/services/train-orchestration.js');

test('train orchestration resolves run actions per config type', () => {
  assert.deepEqual(resolveAllowedActions('training'), ['train', 'generate-validation']);
  assert.deepEqual(resolveAllowedActions('validation'), ['validate']);
  assert.equal(resolveRunRequestAction('training'), 'train');
  assert.equal(resolveRunRequestAction('training', 'generate-validation'), 'generate-validation');
  assert.equal(resolveRunRequestAction('validation'), 'validate');
  assert.throws(() => resolveRunRequestAction('router', 'build'), /Only training or validation config can be queued/);
  assert.throws(() => resolveRunRequestAction('validation', 'train'), /is not allowed/);
});

test('train orchestration builds run command and clear results plan', () => {
  assert.match(buildRunCommand('training', 'configs/training/a.json') || '', /npm run train/);
  assert.match(buildRunCommand('validation', 'configs\/validation\/a.json') || '', /npm run validate/);

  const plan = buildClearResultsPlan(
    {
      configType: 'training',
      resultGroup: 'train_group',
    },
    [
      { id: 2, configType: 'validation', resultGroup: 'validation_group' },
      { id: 3, configType: 'top-strategies', resultGroup: 'snapshot_group' },
      { id: 4, configType: 'router', resultGroup: 'router_group' },
    ]
  );

  assert.deepEqual(plan.resultGroups, ['train_group', 'validation_group', 'snapshot_group', 'router_group']);
  assert.deepEqual(plan.removableConfigs.map((item) => item.id), [2, 3]);
});
