const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

const router = express.Router();

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TRAIN_ROOT = process.env.TRAIN_ROOT
  ? path.resolve(process.env.TRAIN_ROOT)
  : path.join(REPO_ROOT, 'train');
const TRAINING_CONFIG_DIR = path.join(TRAIN_ROOT, 'configs', 'training');
const VALIDATION_CONFIG_DIR = path.join(TRAIN_ROOT, 'configs', 'validation');
const TOP_STRATEGY_DIR = path.join(TRAIN_ROOT, 'configs', 'top-strategies');
const ROUTER_CONFIG_DIR = path.join(TRAIN_ROOT, 'configs', 'generated', 'regime-routing');
const REPORTS_ROOT = path.join(TRAIN_ROOT, 'reports');

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function toRepoRelative(filePath) {
  return toPosix(path.relative(REPO_ROOT, filePath));
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseMaybeJson(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function listFiles(dirPath, predicate = () => true) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath, predicate));
      continue;
    }

    if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function formatIso(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function getYearFromConfig(config, fallbackName) {
  const baseYear = String(fallbackName || '').match(/^(\d{4})_/);
  if (baseYear) {
    return baseYear[1];
  }

  const startIso = config?.timeRange?.startIso;
  if (startIso) {
    return String(new Date(startIso).getUTCFullYear());
  }

  const startMs = config?.timeRange?.startTimeMs;
  if (startMs) {
    return String(new Date(Number(startMs)).getUTCFullYear());
  }

  return null;
}

function getValidationTargetLabel(validationConfig, fallbackName) {
  const yearMatch = String(fallbackName).match(/_(\d{4})_validation\.json$/i);
  if (yearMatch) {
    return yearMatch[1];
  }

  const startIso = validationConfig?.timeRange?.startIso;
  if (startIso) {
    return String(new Date(startIso).getUTCFullYear());
  }

  return 'validation';
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function deriveValidationPrefix(trainingName, symbol, topN) {
  const symbolLower = String(symbol || 'asset').toLowerCase();
  const trainingYear = getYearFromConfig({}, trainingName) || 'run';
  return `${trainingYear}_${symbolLower}_top${topN}_exact_from_${trainingYear}`;
}

function matchValidationToTraining(training, validation) {
  if (normalizeText(validation.config?.market?.symbol) !== normalizeText(training.symbol)) {
    return false;
  }

  const trainingYear = String(training.trainingYear || '');
  const fileText = normalizeText([
    validation.fileName,
    validation.config?.name,
    validation.config?.description,
    validation.config?.database?.tableName
  ].join(' '));

  if (trainingYear && (fileText.includes(`from_${trainingYear}`) || fileText.includes(`from ${trainingYear}`))) {
    return true;
  }

  const exactTrainConfig = normalizeText(`configs/training/${training.fileName}`);
  return fileText.includes(exactTrainConfig);
}

function findLatestMatch(files, matcher) {
  const matched = files
    .filter(matcher)
    .map((filePath) => {
      const stat = safeStat(filePath);
      return {
        path: filePath,
        modifiedAt: formatIso(stat?.mtime),
        mtimeMs: stat?.mtimeMs || 0
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return matched[0] || null;
}

function buildStatus(stepDone, partial = false) {
  if (stepDone) {
    return 'done';
  }
  if (partial) {
    return 'partial';
  }
  return 'todo';
}

function buildNextAction(training, validationRecords, reports, routerFiles) {
  const trainCommand = `docker compose run --rm train sh -lc "npm install && npm run build && npm run train -- configs/training/${training.fileName}"`;
  if (!training.trainingRun) {
    return {
      key: 'run-training',
      title: '先跑训练候选池',
      reason: '数据库里还没有这个 training config 的训练结果。',
      commands: [trainCommand]
    };
  }

  if (!training.topStrategySnapshot) {
    const outPrefix = deriveValidationPrefix(training.fileName, training.symbol, training.topN);
    return {
      key: 'generate-validation',
      title: '生成 Top 策略快照和 validation 配置',
      reason: '训练结果已经存在，但还没有看到导出的 Top 策略快照。',
      commands: [
        `docker compose run --rm train sh -lc "npm install && node scripts/generate-top3-validation-configs.js --trainConfig=$(pwd)/configs/training/${training.fileName} --symbol=${training.symbol} --sourceTable=${training.resultGroup} --outPrefix=${outPrefix} --strategyPrefix=${training.trainingYear || 'RUN'}-${training.symbol}-VAL- --descriptionPrefix='${training.trainingYear || 'Run'} ${training.symbol} validation' --limit=${training.topN} --exact=true"`
      ]
    };
  }

  if (validationRecords.length === 0) {
    return {
      key: 'prepare-validation',
      title: '补生成 validation 配置',
      reason: '已经有训练结果，但还没有找到匹配的 validation 配置文件。',
      commands: [
        `docker compose run --rm train sh -lc "ls configs/validation && ls configs/top-strategies"`
      ]
    };
  }

  const pendingValidation = validationRecords.find((item) => !item.latestRun);
  if (pendingValidation) {
    return {
      key: 'run-validation',
      title: `跑验证 ${pendingValidation.targetLabel}`,
      reason: 'validation config 已存在，但该验证期还没有落库结果。',
      commands: [
        `docker compose run --rm train sh -lc "npm install && npm run build && npm run validate -- ${pendingValidation.path}"`
      ]
    };
  }

  const latestValidation = validationRecords
    .filter((item) => item.latestRun)
    .sort((left, right) => new Date(right.latestRun.latestAt || 0).getTime() - new Date(left.latestRun.latestAt || 0).getTime())[0];

  if (!reports.costSensitivity.path && latestValidation) {
    return {
      key: 'cost-sensitivity',
      title: '补跑成本敏感度报告',
      reason: '验证已经有结果，但还没有看到成本敏感度报告。',
      commands: [
        `docker compose run --rm train sh -lc "npm install && npm run build && npm run report:cost-sensitivity -- --config ${latestValidation.path}"`
      ]
    };
  }

  if (!reports.featureCausality.path) {
    const startDate = String(latestValidation?.timeRange?.startIso || training.timeRange?.startIso || '').slice(0, 10);
    const endDate = String(latestValidation?.timeRange?.endIso || training.timeRange?.endIso || '').slice(0, 10);
    return {
      key: 'feature-causality',
      title: '补跑因果特征审计',
      reason: '还没有看到这个交易对对应的 feature causality 报告。',
      commands: [
        `docker compose run --rm train sh -lc "npm install && npm run build && npm run audit:causal-features -- --symbol ${training.symbol} --start ${startDate} --end ${endDate} --openingMinutes 60"`
      ]
    };
  }

  if (!routerFiles.routerPath) {
    return {
      key: 'build-router',
      title: '补 router / policy catalog',
      reason: '训练和验证已经跑通，但还没有找到可用的 router 配置文件。',
      commands: [
        '参考 train/PLAYBOOK.md 阶段 8 生成 router 和 policy catalog'
      ]
    };
  }

  if (!reports.routerValidation.path && latestValidation) {
    return {
      key: 'router-validate',
      title: '跑 router 验证',
      reason: 'router 已存在，但还没有看到 regime routing 验证报告。',
      commands: [
        `docker compose run --rm train sh -lc "npm install && npm run build && node dist/scripts/router-validate.js --validation ${latestValidation.path} --router ${routerFiles.routerPath}"`
      ]
    };
  }

  return {
    key: 'review',
    title: '进入结果复盘',
    reason: '主流程产物已经齐全，可以开始看报告和策略差异。',
    commands: [
      '先看 train/reports/regime-routing-results/ 与 train/reports/cost-sensitivity/ 的最新报告'
    ]
  };
}

async function getExistingTables() {
  const [rows] = await db.query('SHOW TABLES');
  const tables = new Set();

  for (const row of rows) {
    for (const value of Object.values(row)) {
      tables.add(String(value));
    }
  }

  return tables;
}

async function loadDbSummary() {
  const result = {
    connected: false,
    warning: null,
    runMap: new Map(),
    taskMap: new Map(),
    configRegistry: {
      training: [],
      validation: [],
      topStrategies: [],
      router: []
    }
  };

  try {
    await db.query("SET NAMES 'utf8mb4'");
    const tables = await getExistingTables();
    result.connected = true;

    if (tables.has('backtest_results')) {
      const [rows] = await db.query(`
        SELECT
          result_group,
          mode,
          run_id,
          config_name,
          symbol,
          COUNT(*) AS strategy_count,
          MAX(score) AS best_score,
          MAX(total_pnl) AS best_total_pnl,
          MAX(updated_at) AS latest_at,
          MAX(created_at) AS created_at
        FROM backtest_results
        GROUP BY result_group, mode, run_id, config_name, symbol
        ORDER BY latest_at DESC
      `);

      for (const row of rows) {
        const resultGroup = String(row.result_group || '');
        const mode = String(row.mode || 'unknown');
        const existing = result.runMap.get(resultGroup) || {};
        if (!existing[mode]) {
          existing[mode] = {
            runId: String(row.run_id || ''),
            configName: row.config_name ? String(row.config_name) : null,
            symbol: row.symbol ? String(row.symbol) : null,
            strategyCount: Number(row.strategy_count || 0),
            bestScore: row.best_score == null ? null : Number(row.best_score),
            bestTotalPnl: row.best_total_pnl == null ? null : Number(row.best_total_pnl),
            latestAt: formatIso(row.latest_at),
            createdAt: formatIso(row.created_at)
          };
          result.runMap.set(resultGroup, existing);
        }
      }
    }

    if (tables.has('tasks')) {
      const [rows] = await db.query(`
        SELECT
          task_id,
          config_name,
          description,
          status,
          started_at,
          completed_at,
          created_at
        FROM tasks
        ORDER BY created_at DESC
      `);

      for (const row of rows) {
        const configName = String(row.config_name || '');
        if (!configName || result.taskMap.has(configName)) {
          continue;
        }

        result.taskMap.set(configName, {
          taskId: String(row.task_id || ''),
          configName,
          description: row.description ? String(row.description) : null,
          status: String(row.status || 'unknown'),
          startedAt: formatIso(row.started_at),
          completedAt: formatIso(row.completed_at),
          createdAt: formatIso(row.created_at)
        });
      }
    }

    if (tables.has('train_configs')) {
      const [rows] = await db.query(`
        SELECT
          config_key,
          config_type,
          file_name,
          config_name,
          symbol,
          interval_type,
          result_group,
          source_table,
          train_config_ref,
          training_year,
          synced_at,
          updated_at,
          content
        FROM train_configs
        ORDER BY config_key ASC
      `);

      for (const row of rows) {
        const entry = {
          configKey: String(row.config_key || ''),
          fileName: String(row.file_name || path.basename(String(row.config_key || ''))),
          configType: String(row.config_type || ''),
          configName: row.config_name ? String(row.config_name) : null,
          symbol: row.symbol ? String(row.symbol) : null,
          intervalType: row.interval_type ? String(row.interval_type) : null,
          resultGroup: row.result_group ? String(row.result_group) : null,
          sourceTable: row.source_table ? String(row.source_table) : null,
          trainConfigRef: row.train_config_ref ? String(row.train_config_ref) : null,
          trainingYear: row.training_year ? String(row.training_year) : null,
          syncedAt: formatIso(row.synced_at),
          updatedAt: formatIso(row.updated_at),
          content: parseMaybeJson(row.content)
        };

        if (entry.configType === 'training') {
          result.configRegistry.training.push(entry);
        } else if (entry.configType === 'validation') {
          result.configRegistry.validation.push(entry);
        } else if (entry.configType === 'top-strategies') {
          result.configRegistry.topStrategies.push(entry);
        } else if (entry.configType === 'router') {
          result.configRegistry.router.push(entry);
        }
      }
    }
  } catch (error) {
    result.warning = error instanceof Error ? error.message : String(error);
  }

  return result;
}

router.get('/', async (req, res) => {
  try {
    const dbSummary = await loadDbSummary();
    const trainingEntries = dbSummary.configRegistry.training.length > 0
      ? dbSummary.configRegistry.training
        .map((entry) => ({
          path: entry.configKey,
          fileName: entry.fileName,
          config: entry.content,
          updatedAt: entry.syncedAt || entry.updatedAt
        }))
      : listFiles(TRAINING_CONFIG_DIR, (filePath) => filePath.endsWith('.json')).sort()
        .map((filePath) => ({
          path: `configs/training/${path.basename(filePath)}`,
          fileName: path.basename(filePath),
          config: safeReadJson(filePath),
          updatedAt: formatIso(safeStat(filePath)?.mtime)
        }))
        .filter((entry) => entry.config);

    const validationEntries = dbSummary.configRegistry.validation.length > 0
      ? dbSummary.configRegistry.validation
        .map((entry) => ({
          path: entry.configKey,
          fileName: entry.fileName,
          fullPath: null,
          config: entry.content
        }))
      : listFiles(VALIDATION_CONFIG_DIR, (filePath) => filePath.endsWith('.json'))
        .map((filePath) => ({
          path: `configs/validation/${path.basename(filePath)}`,
          fileName: path.basename(filePath),
          fullPath: filePath,
          config: safeReadJson(filePath)
        }))
        .filter((entry) => entry.config);

    const topStrategyEntries = dbSummary.configRegistry.topStrategies.length > 0
      ? dbSummary.configRegistry.topStrategies
        .map((entry) => ({
          fullPath: entry.configKey,
          fileName: entry.fileName,
          data: entry.content,
          stat: {
            mtime: entry.syncedAt || entry.updatedAt,
            mtimeMs: new Date(entry.syncedAt || entry.updatedAt || 0).getTime()
          }
        }))
      : listFiles(TOP_STRATEGY_DIR, (filePath) => filePath.endsWith('.json'))
        .map((filePath) => ({
          fullPath: filePath,
          fileName: path.basename(filePath),
          data: safeReadJson(filePath),
          stat: safeStat(filePath)
        }))
        .filter((entry) => entry.data);

    const routerRegistryKeys = dbSummary.configRegistry.router.map((entry) => entry.configKey);
    const routerFiles = routerRegistryKeys.length > 0
      ? routerRegistryKeys
      : listFiles(ROUTER_CONFIG_DIR, (filePath) => filePath.endsWith('.json'));
    const reportFiles = listFiles(REPORTS_ROOT, (filePath) => filePath.endsWith('.md') || filePath.endsWith('.json'));

    const pipelines = trainingEntries.map((trainingEntry) => {
      const config = trainingEntry.config;
      const fileName = trainingEntry.fileName;

      if (!config) {
        return {
          id: fileName,
          fileName,
          configError: true
        };
      }

      const resultGroup = String(config.database?.tableName || '').trim();
      const symbol = String(config.market?.symbol || 'UNKNOWN').toUpperCase();
      const trainingYear = getYearFromConfig(config, fileName);
      const topN = Number(config.output?.topN || 10);
      const runBucket = dbSummary.runMap.get(resultGroup) || {};
      const trainingRun = runBucket.training || null;
      const latestTask = dbSummary.taskMap.get(String(config.name || '')) || null;

      const snapshotMatch = topStrategyEntries
        .filter((entry) => {
          const trainConfigRef = normalizeText(entry.data?.trainConfig || entry.data?.train_config_ref);
          return trainConfigRef.endsWith(normalizeText(trainingEntry.path))
            || trainConfigRef.endsWith(normalizeText(`configs/training/${fileName}`))
            || normalizeText(entry.data?.sourceTable) === normalizeText(resultGroup);
        })
        .sort((left, right) => (right.stat?.mtimeMs || 0) - (left.stat?.mtimeMs || 0))[0] || null;

      const matchedValidations = validationEntries
        .filter((entry) => matchValidationToTraining({
          symbol,
          trainingYear,
          fileName
        }, entry))
        .map((entry) => {
          const validationResultGroup = String(entry.config.database?.tableName || '').trim();
          const validationRunBucket = dbSummary.runMap.get(validationResultGroup) || {};
          return {
            name: entry.config.name,
            path: entry.path,
            resultGroup: validationResultGroup,
            targetLabel: getValidationTargetLabel(entry.config, entry.fileName),
            timeRange: {
              startIso: entry.config.timeRange?.startIso || formatIso(entry.config.timeRange?.startTimeMs),
              endIso: entry.config.timeRange?.endIso || formatIso(entry.config.timeRange?.endTimeMs)
            },
            latestRun: validationRunBucket.validation || null,
            latestTask: dbSummary.taskMap.get(String(entry.config.name || '')) || null
          };
        })
        .sort((left, right) => String(left.targetLabel).localeCompare(String(right.targetLabel)));

      const routerConfigRef = config.regimeRouting?.routerConfigPath || null;
      const normalizedRouterConfigRef = routerConfigRef
        ? normalizeText(path.posix.normalize(path.posix.join(path.posix.dirname(trainingEntry.path), routerConfigRef)))
        : null;
      const routerPath = normalizedRouterConfigRef
        ? routerFiles.find((item) => normalizeText(String(item)).endsWith(normalizedRouterConfigRef))
          || routerFiles.find((item) => normalizeText(String(item)).endsWith(normalizeText(String(routerConfigRef))))
          || null
        : null;
      const policyPath = routerPath
        ? String(routerPath).replace(/\.json$/i, '.policy.json')
        : null;
      const policyExists = policyPath
        ? routerFiles.some((item) => normalizeText(String(item)) === normalizeText(policyPath))
          || fs.existsSync(path.join(REPO_ROOT, policyPath))
        : false;

      const symbolReportMatcher = (segment) => (filePathCandidate) => {
        const normalized = normalizeText(toRepoRelative(filePathCandidate));
        return normalized.includes(`reports/${segment}`) && normalized.includes(normalizeText(symbol));
      };

      const reportSummary = {
        costSensitivity: findLatestMatch(reportFiles, symbolReportMatcher('cost-sensitivity')),
        featureCausality: findLatestMatch(reportFiles, symbolReportMatcher('feature-causality')),
        routerValidation: findLatestMatch(reportFiles, symbolReportMatcher('regime-routing-results'))
      };

      const steps = [
        {
          key: 'training-config',
          title: 'Training Config',
          status: 'done',
          detail: trainingEntry.path
        },
        {
          key: 'training-run',
          title: 'Training Run',
          status: latestTask?.status === 'running' ? 'running' : buildStatus(Boolean(trainingRun)),
          detail: trainingRun
            ? `${trainingRun.strategyCount} strategies · latest ${trainingRun.latestAt || 'n/a'}`
            : '尚未落库'
        },
        {
          key: 'top-strategies',
          title: 'Top Snapshot',
          status: buildStatus(Boolean(snapshotMatch)),
          detail: snapshotMatch
            ? (String(snapshotMatch.fullPath).startsWith('/')
              ? toRepoRelative(snapshotMatch.fullPath)
              : String(snapshotMatch.fullPath))
            : '尚未生成'
        },
        {
          key: 'validation-config',
          title: 'Validation Configs',
          status: buildStatus(matchedValidations.length > 0),
          detail: matchedValidations.length > 0 ? `${matchedValidations.length} files` : '未找到'
        },
        {
          key: 'validation-run',
          title: 'Validation Runs',
          status: buildStatus(
            matchedValidations.length > 0 && matchedValidations.every((item) => Boolean(item.latestRun)),
            matchedValidations.some((item) => Boolean(item.latestRun))
          ),
          detail: matchedValidations.length > 0
            ? matchedValidations.map((item) => `${item.targetLabel}:${item.latestRun ? 'done' : 'todo'}`).join(' | ')
            : '等待 validation config'
        },
        {
          key: 'cost-sensitivity',
          title: 'Cost Report',
          status: buildStatus(Boolean(reportSummary.costSensitivity)),
          detail: reportSummary.costSensitivity?.path ? toRepoRelative(reportSummary.costSensitivity.path) : '未找到'
        },
        {
          key: 'feature-causality',
          title: 'Causal Audit',
          status: buildStatus(Boolean(reportSummary.featureCausality)),
          detail: reportSummary.featureCausality?.path ? toRepoRelative(reportSummary.featureCausality.path) : '未找到'
        },
        {
          key: 'router',
          title: 'Router / Policy',
          status: buildStatus(Boolean(routerPath && policyExists), Boolean(routerPath || policyExists)),
          detail: routerPath ? `${routerPath}${policyExists ? ' + policy' : ''}` : '未配置'
        },
        {
          key: 'router-validation',
          title: 'Router Validation',
          status: buildStatus(Boolean(reportSummary.routerValidation)),
          detail: reportSummary.routerValidation?.path ? toRepoRelative(reportSummary.routerValidation.path) : '未找到'
        }
      ];

      const nextAction = buildNextAction({
        fileName,
        name: config.name,
        symbol,
        resultGroup,
        timeRange: config.timeRange,
        trainingRun,
        topStrategySnapshot: snapshotMatch,
        topN,
        trainingYear
      }, matchedValidations, reportSummary, { routerPath, policyPath: policyExists ? policyPath : null });

      return {
        id: fileName.replace(/\.json$/i, ''),
        name: config.name,
        description: config.description || '',
        symbol,
        intervalType: config.market?.intervalType || null,
        trainingYear,
        topN,
        resultGroup,
        trainingConfigPath: `configs/training/${fileName}`,
        configUpdatedAt: trainingEntry.updatedAt || null,
        timeRange: {
          startIso: config.timeRange?.startIso || formatIso(config.timeRange?.startTimeMs),
          endIso: config.timeRange?.endIso || formatIso(config.timeRange?.endTimeMs)
        },
        latestTask,
        trainingRun,
        topStrategySnapshot: snapshotMatch ? {
          path: String(snapshotMatch.fullPath).startsWith('/')
            ? toRepoRelative(snapshotMatch.fullPath)
            : String(snapshotMatch.fullPath),
          generatedAt: snapshotMatch.data.generatedAt || formatIso(snapshotMatch.stat?.mtime),
          sourceRunId: snapshotMatch.data.sourceRunId || null,
          limit: snapshotMatch.data.limit || null,
          exact: Boolean(snapshotMatch.data.exact)
        } : null,
        validationConfigs: matchedValidations,
        router: {
          routerPath,
          policyPath: policyExists ? policyPath : null
        },
        reports: {
          costSensitivity: reportSummary.costSensitivity ? {
            path: toRepoRelative(reportSummary.costSensitivity.path),
            modifiedAt: reportSummary.costSensitivity.modifiedAt
          } : null,
          featureCausality: reportSummary.featureCausality ? {
            path: toRepoRelative(reportSummary.featureCausality.path),
            modifiedAt: reportSummary.featureCausality.modifiedAt
          } : null,
          routerValidation: reportSummary.routerValidation ? {
            path: toRepoRelative(reportSummary.routerValidation.path),
            modifiedAt: reportSummary.routerValidation.modifiedAt
          } : null
        },
        steps,
        nextAction
      };
    }).sort((left, right) => String(right.trainingYear || '').localeCompare(String(left.trainingYear || '')));

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      meta: {
        dbConnected: dbSummary.connected,
        dbWarning: dbSummary.warning,
        trainingConfigCount: pipelines.length
      },
      data: pipelines
    });
  } catch (error) {
    console.error('训练 pipeline 汇总失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to build training pipeline summary',
      message: error.message
    });
  }
});

module.exports = router;
