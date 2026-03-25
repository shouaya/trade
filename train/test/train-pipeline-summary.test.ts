const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const {
  buildFinalConfigState,
  buildMethodologyStages,
  getSuggestedStageKey,
} = require('../dist/services/train-pipeline-summary.js');

test('train pipeline summary exposes final config state for running generation request', () => {
  const state = buildFinalConfigState({
    latestGenerateValidationRequest: {
      id: 42,
      requestId: 'runreq-42',
      action: 'generate-validation',
      status: 'running',
    },
  });

  assert.equal(state.status, 'running');
  assert.equal(state.canExport, false);
  assert.equal(state.requestId, 42);
  assert.match(state.detail, /runreq-42/);
});

test('train pipeline summary exposes final config state for completed rolling manifest without snapshot', () => {
  const state = buildFinalConfigState({
    latestRequest: {
      requestId: 'trainreq-42',
      status: 'completed',
    },
    latestTask: {
      taskId: 'task-42',
      status: 'completed',
    },
  });

  assert.equal(state.status, 'todo');
  assert.equal(state.canExport, false);
  assert.match(state.detail, /rolling training manifest 已完成/);
});

test('train pipeline summary builds methodology stages from core pipeline dto', () => {
  const pipeline = {
    symbol: 'BTCJPY',
    topN: 10,
    resultGroup: 'btcjpy_alpha_train_2025',
    trainingConfigPath: 'configs/training/2025_btcjpy_alpha.json',
    timeRange: {
      startIso: '2025-01-01T00:00:00.000Z',
      endIso: '2025-12-31T23:59:00.000Z',
    },
    latestRequest: {
      requestId: 'trainreq-1',
      status: 'completed',
    },
    trainingRun: {
      runId: 'training-run-1',
      strategyCount: 128,
    },
    topStrategySnapshot: {
      path: 'configs/top-strategies/alpha.json',
    },
    validationConfigs: [
      {
        targetLabel: 'rolling 2026-01-01 -> 2026-03-31',
        validationProfile: 'rolling-window',
        latestRun: null,
        latestRequest: null,
      },
    ],
    router: {
      routerPath: null,
      policyPath: null,
    },
    reports: {
      featureCausality: null,
      costSensitivity: null,
      routerValidation: null,
    },
  };

  const trainingConfig = {
    strategy: {
      types: ['rsi_macd'],
      parameters: {
        risk: {
          lotSize: [0.008],
          maxHoldMinutes: [6, 8],
        },
      },
    },
  };

  const stages = buildMethodologyStages(pipeline, trainingConfig);
  const futureValidationStage = stages.find((stage) => stage.key === 'stage-8-rolling-validation');
  const routerStage = stages.find((stage) => stage.key === 'stage-7-router');

  assert.equal(stages.length, 10);
  assert.equal(futureValidationStage.status, 'partial');
  assert.equal(routerStage.status, 'todo');
  assert.equal(getSuggestedStageKey(stages), 'stage-1-diagnosis');
});
