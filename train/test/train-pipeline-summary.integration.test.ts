const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { test } = require('./harness.ts');
const { buildTrainingPipelineSummary } = require('../dist/services/train-pipeline-summary.js');
const {
  TRAIN_ARTIFACTS_TABLE,
  ROLLING_POOL_DETAILS_TABLE,
  ROLLING_RULE_DETAILS_TABLE
} = require('@money/database');

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, text) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, text);
}

test('buildTrainingPipelineSummary assembles db-backed rolling pipeline status', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'money-summary-'));
  const trainRoot = path.join(repoRoot, 'train');

  const tables = [
    'backtest_results',
    'tasks',
    'train_run_requests',
    'train_configs',
    TRAIN_ARTIFACTS_TABLE,
    ROLLING_POOL_DETAILS_TABLE,
    ROLLING_RULE_DETAILS_TABLE,
  ];

  const db = {
    query: async (sql) => {
      const text = String(sql);

      if (text.includes("SET NAMES 'utf8mb4'")) {
        return [[], {}];
      }
      if (text.includes('SHOW TABLES')) {
        return [tables.map((name) => ({ [`Tables_in_money`]: name })), {}];
      }
      if (text.includes('FROM backtest_results')) {
        return [[
          {
            result_group: 'btcjpy_alpha_train_2024',
            mode: 'training',
            run_id: 'train-run-1',
            config_name: '2024_BTCJPY_ALPHA',
            symbol: 'BTCJPY',
            strategy_count: 128,
            best_score: 2.5,
            best_total_pnl: 12345,
            latest_at: '2026-03-25T01:00:00.000Z',
            created_at: '2026-03-25T00:00:00.000Z',
          },
          {
            result_group: 'btcjpy_alpha_validation_rolling',
            mode: 'validation',
            run_id: 'validation-run-1',
            config_name: '2024_BTCJPY_ALPHA_ROLLING_VALIDATION',
            symbol: 'BTCJPY',
            strategy_count: 10,
            best_score: 1.8,
            best_total_pnl: 3456,
            latest_at: '2026-03-25T02:00:00.000Z',
            created_at: '2026-03-25T01:30:00.000Z',
          },
        ], {}];
      }
      if (text.includes('FROM tasks')) {
        return [[
          {
            task_id: 'task-train-1',
            config_name: '2024_BTCJPY_ALPHA',
            description: 'candidate pool',
            status: 'completed',
            started_at: '2026-03-25T00:00:00.000Z',
            completed_at: '2026-03-25T01:00:00.000Z',
            created_at: '2026-03-25T00:00:00.000Z',
          },
          {
            task_id: 'task-validation-1',
            config_name: '2024_BTCJPY_ALPHA_ROLLING_VALIDATION',
            description: 'rolling validation',
            status: 'completed',
            started_at: '2026-03-25T01:10:00.000Z',
            completed_at: '2026-03-25T02:00:00.000Z',
            created_at: '2026-03-25T01:10:00.000Z',
          },
        ], {}];
      }
      if (text.includes('FROM train_run_requests')) {
        return [[
          {
            id: 13,
            request_id: 'runreq-validation',
            config_id: 2,
            config_key: 'configs/validation/2024_btcjpy_alpha_rolling_validation.json',
            config_name: '2024_BTCJPY_ALPHA_ROLLING_VALIDATION',
            config_type: 'validation',
            action: 'run-validation',
            status: 'completed',
            error_message: null,
            started_at: '2026-03-25T01:10:00.000Z',
            completed_at: '2026-03-25T02:00:00.000Z',
            created_at: '2026-03-25T01:09:00.000Z',
            updated_at: '2026-03-25T02:00:00.000Z',
          },
          {
            id: 12,
            request_id: 'runreq-generate',
            config_id: 1,
            config_key: 'configs/training/2024_btcjpy_alpha.json',
            config_name: '2024_BTCJPY_ALPHA',
            config_type: 'training',
            action: 'generate-validation',
            status: 'completed',
            error_message: null,
            started_at: '2026-03-25T01:01:00.000Z',
            completed_at: '2026-03-25T01:05:00.000Z',
            created_at: '2026-03-25T01:01:00.000Z',
            updated_at: '2026-03-25T01:05:00.000Z',
          },
          {
            id: 11,
            request_id: 'runreq-train',
            config_id: 1,
            config_key: 'configs/training/2024_btcjpy_alpha.json',
            config_name: '2024_BTCJPY_ALPHA',
            config_type: 'training',
            action: 'run-training',
            status: 'completed',
            error_message: null,
            started_at: '2026-03-25T00:00:00.000Z',
            completed_at: '2026-03-25T01:00:00.000Z',
            created_at: '2026-03-25T00:00:00.000Z',
            updated_at: '2026-03-25T01:00:00.000Z',
          },
        ], {}];
      }
      if (text.includes(`FROM ${TRAIN_ARTIFACTS_TABLE}`)) {
        return [[
          {
            id: 101,
            artifact_key: 'cost-sensitivity:2024_btcjpy_cost',
            artifact_type: 'cost-sensitivity',
            train_id: 'train-alpha-1',
            config_id: 2,
            config_key: 'configs/validation/2024_btcjpy_alpha_rolling_validation.json',
            symbol: 'BTCJPY',
            interval_type: '1min',
            period_start_ms: 1711929600000,
            period_end_ms: 1777161540000,
            report_path: null,
            summary_path: null,
            summary_markdown: null,
            payload_json: JSON.stringify({ kind: 'cost', headline: 'router beats default after cost' }),
            metadata_json: JSON.stringify({ strategyCount: 10 }),
            created_at: '2026-03-25T02:05:00.000Z',
            updated_at: '2026-03-25T02:05:00.000Z',
          },
          {
            id: 102,
            artifact_key: 'feature-causality:BTCJPY:1min:1711929600000:1777161540000:60',
            artifact_type: 'feature-causality',
            train_id: 'train-alpha-1',
            config_id: null,
            config_key: null,
            symbol: 'BTCJPY',
            interval_type: '1min',
            period_start_ms: 1711929600000,
            period_end_ms: 1777161540000,
            report_path: null,
            summary_path: null,
            summary_markdown: null,
            payload_json: JSON.stringify({ kind: 'feature', note: 'trendEfficiency matters' }),
            metadata_json: JSON.stringify({ openingMinutes: 60 }),
            created_at: '2026-03-25T02:06:00.000Z',
            updated_at: '2026-03-25T02:06:00.000Z',
          },
          {
            id: 103,
            artifact_key: 'router-validation:router_v1:1711929600000:1777161540000',
            artifact_type: 'router-validation',
            train_id: 'train-alpha-1',
            config_id: 2,
            config_key: 'configs/validation/2024_btcjpy_alpha_rolling_validation.json',
            symbol: 'BTCJPY',
            interval_type: '1min',
            period_start_ms: 1711929600000,
            period_end_ms: 1777161540000,
            report_path: null,
            summary_path: null,
            summary_markdown: null,
            payload_json: JSON.stringify({ kind: 'router-validation', headline: 'validation done' }),
            metadata_json: JSON.stringify({ routerVersion: 'router_v1' }),
            created_at: '2026-03-25T02:07:00.000Z',
            updated_at: '2026-03-25T02:07:00.000Z',
          },
          {
            id: 104,
            artifact_key: 'goal-tracking:train-alpha-1:2024_btcjpy_alpha',
            artifact_type: 'goal-tracking',
            train_id: 'train-alpha-1',
            config_id: 1,
            config_key: 'configs/training/2024_btcjpy_alpha.json',
            symbol: 'BTCJPY',
            interval_type: '1min',
            period_start_ms: null,
            period_end_ms: null,
            report_path: null,
            summary_path: null,
            summary_markdown: null,
            payload_json: JSON.stringify({ goal: 'stable-profit', score: 0.81 }),
            metadata_json: JSON.stringify({ scoringModelVersion: 'v1' }),
            created_at: '2026-03-25T02:08:00.000Z',
            updated_at: '2026-03-25T02:08:00.000Z',
          },
          {
            id: 105,
            artifact_key: 'ai-summary:train-alpha-1:pipeline',
            artifact_type: 'ai-summary',
            train_id: 'train-alpha-1',
            config_id: 1,
            config_key: 'configs/training/2024_btcjpy_alpha.json',
            symbol: 'BTCJPY',
            interval_type: '1min',
            period_start_ms: null,
            period_end_ms: null,
            report_path: null,
            summary_path: 'reports/ai-summaries/2024_btcjpy_alpha.pipeline.summary.md',
            summary_markdown: '# R5 Summary\n\nrouter edge is improving',
            payload_json: JSON.stringify({ title: 'R5 Summary', summaryKey: 'pipeline' }),
            metadata_json: JSON.stringify({ createdBy: 'manual' }),
            created_at: '2026-03-25T02:09:00.000Z',
            updated_at: '2026-03-25T02:09:00.000Z',
          },
        ], {}];
      }
      if (text.includes('FROM train_configs tc')) {
        return [[
          {
            id: 1,
            config_key: 'configs/training/2024_btcjpy_alpha.json',
            config_type: 'training',
            config_name: '2024_BTCJPY_ALPHA',
            symbol: 'BTCJPY',
            interval_type: '1min',
            result_group: 'btcjpy_alpha_train_2024',
            source_table: null,
            train_config_ref: null,
            training_year: '2024',
            updated_at: '2026-03-25T01:05:00.000Z',
            content: JSON.stringify({
              name: '2024_BTCJPY_ALPHA',
              description: 'rolling training',
              trainId: 'train-alpha-1',
              market: { symbol: 'BTCJPY', intervalType: '1min' },
              timeRange: {
                startIso: '2024-04-01T00:00:00.000Z',
                endIso: '2026-03-19T23:59:00.000Z',
              },
              database: { tableName: 'btcjpy_alpha_train_2024' },
              output: { topN: 10 },
              strategy: {
                types: ['rsi_macd'],
                parameters: {
                  risk: {
                    lotSize: [0.008],
                    maxHoldMinutes: [6, 8],
                  },
                },
              },
              validationPlan: {
                profile: 'rolling-window',
              },
              regimeRouting: {
                routerConfigPath: '../generated/regime-routing/2024_btcjpy_alpha_router.json',
              },
            }),
          },
          {
            id: 2,
            config_key: 'configs/validation/2024_btcjpy_alpha_rolling_validation.json',
            config_type: 'validation',
            config_name: '2024_BTCJPY_ALPHA_ROLLING_VALIDATION',
            symbol: 'BTCJPY',
            interval_type: '1min',
            result_group: 'btcjpy_alpha_validation_rolling',
            source_table: null,
            train_config_ref: 'configs/training/2024_btcjpy_alpha.json',
            training_year: '2024',
            updated_at: '2026-03-25T01:06:00.000Z',
            content: JSON.stringify({
              name: '2024_BTCJPY_ALPHA_ROLLING_VALIDATION',
              trainId: 'train-alpha-1',
              trainConfig: 'configs/training/2024_btcjpy_alpha.json',
              validationProfile: 'rolling-window',
              validationTarget: { label: 'rolling 2024-04 -> 2026-03' },
              market: { symbol: 'BTCJPY', intervalType: '1min' },
              timeRange: {
                startIso: '2024-04-01T00:00:00.000Z',
                endIso: '2026-03-19T23:59:00.000Z',
              },
              database: { tableName: 'btcjpy_alpha_validation_rolling' },
            }),
          },
          {
            id: 3,
            config_key: 'configs/top-strategies/2024_btcjpy_alpha.generated.json',
            config_type: 'top-strategies',
            config_name: '2024_BTCJPY_ALPHA_TOP10',
            symbol: 'BTCJPY',
            interval_type: '1min',
            result_group: null,
            source_table: 'btcjpy_alpha_train_2024',
            train_config_ref: 'configs/training/2024_btcjpy_alpha.json',
            training_year: '2024',
            updated_at: '2026-03-25T01:05:30.000Z',
            content: JSON.stringify({
              name: '2024_BTCJPY_ALPHA_TOP10',
              generatedAt: '2026-03-25T01:05:30.000Z',
              sourceRunId: 'train-run-1',
              trainConfig: 'configs/training/2024_btcjpy_alpha.json',
              sourceTable: 'btcjpy_alpha_train_2024',
              limit: 10,
              exact: true,
              rollingPlan: {
                rules: {
                  monthlyGuard: [{ id: 'month-1' }],
                },
              },
            }),
          },
          {
            id: 4,
            config_key: 'configs/generated/regime-routing/2024_btcjpy_alpha_router.json',
            config_type: 'router',
            config_name: 'router_v1',
            symbol: 'BTCJPY',
            interval_type: '1min',
            result_group: null,
            source_table: null,
            train_config_ref: null,
            training_year: '2024',
            updated_at: '2026-03-25T01:07:00.000Z',
            content: JSON.stringify({ routerVersion: 'router_v1' }),
          },
          {
            id: 5,
            config_key: 'configs/generated/regime-routing/2024_btcjpy_alpha_router.policy.json',
            config_type: 'policy',
            config_name: 'policy_v1',
            symbol: 'BTCJPY',
            interval_type: '1min',
            result_group: null,
            source_table: null,
            train_config_ref: null,
            training_year: '2024',
            updated_at: '2026-03-25T01:07:00.000Z',
            content: JSON.stringify({ catalogVersion: 'policy_v1' }),
          },
        ], {}];
      }
      if (text.includes(`FROM ${ROLLING_POOL_DETAILS_TABLE}`)) {
        return [[
          {
            config_id: 3,
            month_key: '2025-01',
            feature_bucket: 'range-mid-vol',
            selected_strategy_name: 'alpha',
            action_type: 'trade',
            risk_cap: 1,
            top_strategies_json: JSON.stringify([{ strategyName: 'alpha', rank: 1 }]),
          },
        ], {}];
      }
      if (text.includes(`FROM ${ROLLING_RULE_DETAILS_TABLE}`)) {
        return [[
          {
            config_id: 3,
            layer_key: 'daily_router',
            rule_id: 'daily-1',
            priority_no: 1,
            feature_bucket: 'range-mid-vol',
            strategy_key: 'rank1',
            strategy_name: 'alpha',
            action_type: 'reduce',
            risk_cap: null,
            risk_multiplier: 0.5,
            rationale: 'test rule',
            rule_json: JSON.stringify({ when: { featureBucket: ['range-mid-vol'] } }),
          },
        ], {}];
      }

      throw new Error(`Unexpected SQL: ${text}`);
    },
  };

  try {
    const summary = await buildTrainingPipelineSummary({ db, repoRoot, trainRoot });
    const pipeline = summary.data[0];

    assert.equal(summary.meta.dbConnected, true);
    assert.equal(summary.meta.trainingConfigCount, 1);
    assert.equal(pipeline.name, '2024_BTCJPY_ALPHA');
    assert.equal(pipeline.trainingRun.runId, 'train-run-1');
    assert.equal(pipeline.topStrategySnapshot.path, 'configs/top-strategies/2024_btcjpy_alpha.generated.json');
    assert.equal(pipeline.topStrategySnapshot.rollingPlan.monthlyPools.length, 1);
    assert.equal(pipeline.topStrategySnapshot.rollingPlan.normalizedRules.length, 1);
    assert.equal(pipeline.validationConfigs.length, 1);
    assert.equal(pipeline.validationConfigs[0].latestRun.runId, 'validation-run-1');
    assert.equal(pipeline.router.routerPath, 'configs/generated/regime-routing/2024_btcjpy_alpha_router.json');
    assert.equal(pipeline.router.policyPath, 'configs/generated/regime-routing/2024_btcjpy_alpha_router.policy.json');
    assert.equal(pipeline.reports.costSensitivity.path, 'train_artifacts:cost-sensitivity:2024_btcjpy_cost');
    assert.equal(pipeline.reports.aiSummary.path, 'reports/ai-summaries/2024_btcjpy_alpha.pipeline.summary.md');
    assert.match(pipeline.reports.aiSummary.preview, /router edge is improving/);
    assert.match(pipeline.reports.goalTracking.preview, /stable-profit/);
    assert.equal(pipeline.steps.every((step) => step.status === 'done'), true);
    assert.equal(pipeline.nextAction.key, 'review');
    assert.equal(pipeline.finalConfigState.status, 'done');
    assert.equal(pipeline.finalConfigState.canExport, true);
    assert.equal(pipeline.suggestedStageKey, 'stage-9-iteration');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('buildTrainingPipelineSummary surfaces running training state before artifacts exist', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'money-summary-running-'));
  const trainRoot = path.join(repoRoot, 'train');
  mkdirp(trainRoot);

  const db = {
    query: async (sql) => {
      const text = String(sql);

      if (text.includes("SET NAMES 'utf8mb4'")) {
        return [[], {}];
      }
      if (text.includes('SHOW TABLES')) {
        return [[
          { Tables_in_money: 'train_run_requests' },
          { Tables_in_money: 'train_configs' },
        ], {}];
      }
      if (text.includes('FROM train_run_requests')) {
        return [[
          {
            id: 21,
            request_id: 'runreq-training-live',
            config_id: 1,
            config_key: 'configs/training/2025_btcjpy_beta.json',
            config_name: '2025_BTCJPY_BETA',
            config_type: 'training',
            action: 'run-training',
            status: 'running',
            error_message: null,
            started_at: '2026-03-25T03:00:00.000Z',
            completed_at: null,
            created_at: '2026-03-25T03:00:00.000Z',
            updated_at: '2026-03-25T03:05:00.000Z',
          },
        ], {}];
      }
      if (text.includes('FROM train_configs tc')) {
        return [[
          {
            id: 1,
            config_key: 'configs/training/2025_btcjpy_beta.json',
            config_type: 'training',
            config_name: '2025_BTCJPY_BETA',
            symbol: 'BTCJPY',
            interval_type: '1min',
            result_group: 'btcjpy_beta_train_2025',
            source_table: null,
            train_config_ref: null,
            training_year: '2025',
            updated_at: '2026-03-25T03:00:00.000Z',
            content: JSON.stringify({
              name: '2025_BTCJPY_BETA',
              market: { symbol: 'BTCJPY', intervalType: '1min' },
              timeRange: {
                startIso: '2025-01-01T00:00:00.000Z',
                endIso: '2025-12-31T23:59:00.000Z',
              },
              database: { tableName: 'btcjpy_beta_train_2025' },
              strategy: {
                types: ['rsi_only'],
                parameters: {
                  risk: {
                    lotSize: [0.01],
                    maxHoldMinutes: [5, 7],
                  },
                },
              },
              validationPlan: {
                profile: 'rolling-window',
              },
            }),
          },
        ], {}];
      }

      return [[], {}];
    },
  };

  try {
    const summary = await buildTrainingPipelineSummary({ db, repoRoot, trainRoot });
    const pipeline = summary.data[0];

    assert.equal(summary.meta.dbConnected, true);
    assert.equal(pipeline.steps[1].status, 'running');
    assert.equal(pipeline.topStrategySnapshot, null);
    assert.equal(pipeline.validationConfigs.length, 0);
    assert.equal(pipeline.nextAction.key, 'waiting-training');
    assert.equal(pipeline.finalConfigState.status, 'todo');
    assert.equal(pipeline.suggestedStageKey, 'stage-3-candidate-pool');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
