const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  buildRunCommand,
  resolveAllowedActions,
  resolveRunRequestAction,
  buildClearResultsPlan,
} = require('../dist/services/train-orchestration.js');

test('train orchestration resolves run actions per config type', () => {
  assert.deepEqual(resolveAllowedActions('training'), ['train', 'generate-validation', 'build-router', 'feature-causality']);
  assert.deepEqual(resolveAllowedActions('validation'), ['validate', 'cost-sensitivity', 'router-validate']);
  assert.equal(resolveRunRequestAction('training'), 'train');
  assert.equal(resolveRunRequestAction('training', 'generate-validation'), 'generate-validation');
  assert.equal(resolveRunRequestAction('training', 'build-router'), 'build-router');
  assert.equal(resolveRunRequestAction('training', 'feature-causality'), 'feature-causality');
  assert.equal(resolveRunRequestAction('validation'), 'validate');
  assert.equal(resolveRunRequestAction('validation', 'cost-sensitivity'), 'cost-sensitivity');
  assert.equal(resolveRunRequestAction('validation', 'router-validate'), 'router-validate');
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
      { id: 5, configType: 'policy', resultGroup: 'policy_group' },
    ]
  );

  assert.deepEqual(plan.resultGroups, ['train_group', 'validation_group', 'snapshot_group', 'router_group', 'policy_group']);
  assert.deepEqual(plan.removableConfigs.map((item) => item.id), [2, 3, 4, 5]);
});
