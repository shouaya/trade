const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  BACKTEST_RESULTS_TABLE,
  TABLES,
  ensureBacktestResultsSchema,
  ensureTrainDataTraceSchema,
  ensureTrainConfigsSchema,
  TRAIN_CONFIGS_TABLE,
  tableExists
} = require('@money/database');
const db = require('../config/database');
const {
  TRAIN_ROOT,
  loadTrainConfigRegistryService,
  loadTrainOrchestrationService,
  loadTrainingManagementService
} = require('../lib/train-service-loader');
const {
  mapTrainConfigRecord,
  parseJsonContent
} = require('../lib/api-mappers');
const {
  getErrorMessage,
  sendJsonError,
  sendServerError
} = require('../lib/route-utils');

const router = express.Router();

async function ensureRegistryTableExists() {
  await ensureTrainConfigsSchema(db);
  return tableExists(db, TRAIN_CONFIGS_TABLE);
}

function getTrainConfigRegistryService() {
  return loadTrainConfigRegistryService();
}

function sendRegistryNotReady(res) {
  return sendJsonError(
    res,
    503,
    'Train config registry not ready',
    'train_configs 表不存在，请先执行 docker compose run --rm train sh -lc "npm install && npm run build && npm run init-db"；如果要导入初始样例配置，再执行 npm run seed:configs'
  );
}

async function loadConfigById(id) {
  return getTrainConfigRegistryService().loadTrainConfigById(db, id);
}

async function loadTrainingGuideCoverage(symbol, intervalType) {
  const [rows] = await db.query(
    `SELECT MIN(open_time) AS min_open_time, MAX(open_time) AS max_open_time
     FROM klines
     WHERE symbol = ?
       AND interval_type = ?`,
    [symbol, intervalType]
  );

  const row = rows[0] || {};
  if (row.min_open_time == null || row.max_open_time == null) {
    return null;
  }

  return {
    symbol,
    intervalType,
    minOpenTime: Number(row.min_open_time),
    maxOpenTime: Number(row.max_open_time)
  };
}

function resolveAbsoluteConfigPath(configKey) {
  const fullPath = path.resolve(TRAIN_ROOT, configKey);
  const normalizedRoot = `${TRAIN_ROOT}${path.sep}`;
  if (!(fullPath === TRAIN_ROOT || fullPath.startsWith(normalizedRoot))) {
    throw new Error('导出路径超出 train 根目录');
  }
  return fullPath;
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function ensureJsonObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }

  return value;
}

function assertTrainingRecord(record) {
  if (String(record?.configType || '') !== 'training') {
    throw new Error('router studio 仅支持 training config');
  }
}

function buildDefaultRouterConfigKey(trainingRecord) {
  const baseName = path.basename(String(trainingRecord.configKey || ''), '.json');
  return `configs/generated/regime-routing/${baseName}_router.json`;
}

function buildDefaultPolicyConfigKey(routerConfigKey) {
  return String(routerConfigKey).replace(/\.json$/i, '.policy.json');
}

function buildRelativeConfigRef(fromConfigKey, targetConfigKey) {
  return toPosix(path.posix.relative(path.posix.dirname(String(fromConfigKey)), String(targetConfigKey)));
}

function buildStrategyCatalogFromSnapshot(snapshotRecord) {
  const content = snapshotRecord?.content && typeof snapshotRecord.content === 'object'
    ? snapshotRecord.content
    : {};
  if (content?.rollingRouter?.strategyCatalog && typeof content.rollingRouter.strategyCatalog === 'object') {
    return content.rollingRouter.strategyCatalog;
  }
  const explicitStrategies = Array.isArray(content?.strategy?.explicitStrategies)
    ? content.strategy.explicitStrategies
    : [];
  const fallbackStrategies = Array.isArray(content?.strategies)
    ? content.strategies
    : [];
  const sourceStrategies = explicitStrategies.length > 0 ? explicitStrategies : fallbackStrategies;

  return sourceStrategies.slice(0, 10).reduce((accumulator, strategy, index) => {
    const key = `rank${index + 1}`;
    const name = String(strategy?.name || strategy?.strategyName || `Strategy ${index + 1}`);
    accumulator[key] = {
      strategyName: name,
      shortLabel: `TOP${index + 1}`,
      role: index === 0 ? 'default-fallback' : 'candidate'
    };
    return accumulator;
  }, {});
}

function buildDefaultRouterContent(trainingRecord, routerConfigKey, policyConfigKey, snapshotRecord) {
  const strategyCatalog = buildStrategyCatalogFromSnapshot(snapshotRecord);
  const strategyKeys = Object.keys(strategyCatalog);
  const rollingRouter = snapshotRecord?.content?.rollingRouter && typeof snapshotRecord.content.rollingRouter === 'object'
    ? snapshotRecord.content.rollingRouter
    : null;
  const defaultStrategyKey = strategyCatalog[rollingRouter?.defaultStrategyKey]
    ? rollingRouter.defaultStrategyKey
    : (strategyKeys[0] || 'rank1');
  const symbol = String(trainingRecord.symbol || trainingRecord.content?.market?.symbol || 'BTCJPY').toUpperCase();
  const trainingYear = String(trainingRecord.trainingYear || '').trim() || 'run';

  return {
    symbol,
    routerVersion: `${symbol.toLowerCase()}_${trainingYear}_router_v1`,
    policyCatalogPath: path.posix.basename(policyConfigKey),
    executionModel: {
      precedence: ['monthly_guard', 'weekly_guard', 'daily_router', 'loss_recheck'],
      defaultFallback: {
        action: 'trade',
        riskMultiplier: 1,
        strategyKey: defaultStrategyKey
      }
    },
    strategyCatalog,
    rules: Array.isArray(rollingRouter?.rules) ? rollingRouter.rules : []
  };
}

function buildDefaultPolicyContent(routerContent, routerConfigKey) {
  const strategyCatalog = routerContent?.strategyCatalog && typeof routerContent.strategyCatalog === 'object'
    ? routerContent.strategyCatalog
    : {};
  const defaultFallback = routerContent?.executionModel?.defaultFallback;
  const defaultStrategy = defaultFallback?.strategyKey
    ? strategyCatalog[defaultFallback.strategyKey]
    : null;

  return {
    symbol: String(routerContent?.symbol || 'BTCJPY').toUpperCase(),
    routerVersion: String(routerContent?.routerVersion || 'router_v1'),
    catalogVersion: `${String(routerContent?.routerVersion || 'router_v1')}_policy_v1`,
    generatedDate: new Date().toISOString(),
    source: {
      routerConfigPath: path.posix.basename(routerConfigKey),
      notes: ['Created from Train Pipeline Router Studio']
    },
    ...(defaultFallback && defaultStrategy
      ? {
          defaultFallback: {
            action: defaultFallback.action,
            riskMultiplier: defaultFallback.riskMultiplier,
            strategy: {
              strategyKey: defaultFallback.strategyKey,
              strategyLabel: defaultStrategy.shortLabel,
              strategyName: defaultStrategy.strategyName
            }
          }
        }
      : {}),
    eventSegments: [],
    dailyGuards: []
  };
}

function loadJsonFileIfExists(configKey) {
  const absolutePath = resolveAbsoluteConfigPath(configKey);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    console.warn('删除文件失败:', filePath, error.message);
  }

  return false;
}

function formatIsoDateOnly(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function resolveRelativeConfigRef(baseConfigKey, targetRef) {
  const normalizedRef = String(targetRef || '').trim();
  if (!normalizedRef) {
    return '';
  }

  return toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(String(baseConfigKey || '')), normalizedRef)));
}

function buildRouterValidationReportPaths(trainingRecord, validationRecord) {
  const routerConfigRef = String(trainingRecord?.content?.regimeRouting?.routerConfigPath || '').trim();
  if (!routerConfigRef) {
    return [];
  }

  const routerConfigKey = resolveRelativeConfigRef(trainingRecord.configKey, routerConfigRef);
  const routerContent = loadJsonFileIfExists(routerConfigKey);
  const routerVersion = String(routerContent?.routerVersion || '').trim();
  if (!routerVersion) {
    return [];
  }

  const symbol = String(validationRecord?.symbol || trainingRecord?.symbol || trainingRecord?.content?.market?.symbol || '').trim().toUpperCase();
  const timeRange = validationRecord?.content?.timeRange || {};
  const startLabel = formatIsoDateOnly(timeRange.startIso || timeRange.startTimeMs);
  const endLabel = formatIsoDateOnly(timeRange.endIso || timeRange.endTimeMs);
  if (!symbol || !startLabel || !endLabel) {
    return [];
  }

  const prefix = `reports/regime-routing-results/${symbol}_${routerVersion}_${startLabel}_to_${endLabel}`;
  return [`${prefix}.json`, `${prefix}.md`];
}

function buildReportDeletePlan(trainingRecord, relatedConfigs) {
  const fileKeys = new Set();

  const trainingSymbol = String(trainingRecord?.symbol || trainingRecord?.content?.market?.symbol || '').trim().toUpperCase();
  const trainingTimeRange = trainingRecord?.content?.timeRange || {};
  const trainingBaseName = path.basename(String(trainingRecord?.configKey || ''), '.json');
  const featureStart = formatIsoDateOnly(trainingTimeRange.startIso || trainingTimeRange.startTimeMs);
  const featureEnd = formatIsoDateOnly(trainingTimeRange.endIso || trainingTimeRange.endTimeMs);
  if (trainingSymbol && featureStart && featureEnd) {
    const featurePrefix = `reports/feature-causality/${trainingSymbol}_${featureStart}_to_${featureEnd}_60m`;
    fileKeys.add(`${featurePrefix}.json`);
    fileKeys.add(`${featurePrefix}.md`);
  }
  if (trainingBaseName) {
    fileKeys.add(`reports/goal-tracking/${trainingBaseName}.goal-tracking.json`);
    fileKeys.add(`reports/goal-tracking/${trainingBaseName}.goal-tracking.md`);
  }

  for (const item of relatedConfigs) {
    const configType = String(item?.configType || '');
    if (configType === 'validation') {
      const baseName = path.basename(String(item.configKey || ''), '.json');
      if (baseName) {
        fileKeys.add(`reports/cost-sensitivity/${baseName}.json`);
        fileKeys.add(`reports/cost-sensitivity/${baseName}.md`);
      }

      for (const reportPath of buildRouterValidationReportPaths(trainingRecord, item)) {
        fileKeys.add(reportPath);
      }
    }
  }

  return Array.from(fileKeys);
}

async function loadDerivedConfigs(trainingRecord) {
  const trainConfigRegistry = getTrainConfigRegistryService();
  const [rows] = await db.query(
    `SELECT tc.*, ${trainConfigRegistry.buildTrainConfigContentSelectSql()}
     FROM ${TRAIN_CONFIGS_TABLE} tc
     ${trainConfigRegistry.buildTrainConfigDetailJoinsSql('tc')}
     WHERE tc.id <> ?
       AND tc.train_id = ?
       AND tc.status = 'active'
     ORDER BY tc.id ASC`,
    [trainingRecord.id, trainingRecord.trainId]
  );

  return rows.map((row) => mapTrainConfigRecord(row, { includeContent: true }));
}

async function loadDistinctStrategyNamesForResultGroups(connection, resultGroups) {
  const strategyNames = new Set();

  for (const resultGroup of resultGroups) {
    const [rows] = await connection.query(
      `SELECT DISTINCT strategy_name
       FROM ${BACKTEST_RESULTS_TABLE}
       WHERE result_group = ?
         AND strategy_name IS NOT NULL
         AND strategy_name <> ''`,
      [resultGroup]
    );

    for (const row of rows) {
      const strategyName = String(row.strategy_name || '').trim();
      if (strategyName) {
        strategyNames.add(strategyName);
      }
    }
  }

  return Array.from(strategyNames);
}

function buildTrackedConfigNames(record, relatedConfigs) {
  return Array.from(new Set(
    [record, ...relatedConfigs]
      .map((item) => String(item?.configName || '').trim())
      .filter(Boolean)
  ));
}

function buildTrackedSymbols(record, relatedConfigs) {
  return Array.from(new Set(
    [record, ...relatedConfigs]
      .map((item) => String(item?.symbol || item?.content?.market?.symbol || '').trim().toUpperCase())
      .filter(Boolean)
  ));
}

function buildStrategyRegistryNames(trainingRecord, rawStrategyNames) {
  const prefix = String(trainingRecord?.content?.output?.strategyNamePrefix || '').trim();
  if (!prefix) {
    return [];
  }

  return rawStrategyNames
    .map((name) => `${prefix}${name}`)
    .filter(Boolean);
}

router.get('/', async (req, res) => {
  try {
    const hasRegistry = await ensureRegistryTableExists();
    if (!hasRegistry) {
      return res.json({
        success: true,
        data: [],
        meta: {
          registryReady: false
        }
      });
    }

    const includeContent = String(req.query.includeContent || 'false') === 'true';
    const includeDerived = String(req.query.includeDerived || 'false') === 'true';
    const includeHistory = String(req.query.includeHistory || 'false') === 'true';
    const configType = req.query.type ? String(req.query.type) : null;
    const trainConfigRegistry = getTrainConfigRegistryService();
    const params = [];
    let query = `
      SELECT tc.*
      ${includeContent ? `, ${trainConfigRegistry.buildTrainConfigContentSelectSql()}` : ''}
      FROM ${TRAIN_CONFIGS_TABLE} tc
      ${includeContent ? trainConfigRegistry.buildTrainConfigDetailJoinsSql('tc') : ''}
    `;

    if (configType) {
      query += ' WHERE tc.config_type = ?';
      params.push(configType);
    } else if (!includeDerived) {
      query += ` WHERE tc.config_type = 'training'`;
    }

    if (!includeHistory) {
      query += query.includes(' WHERE ') ? ` AND tc.status = 'active'` : ` WHERE tc.status = 'active'`;
    }

    query += ' ORDER BY tc.updated_at DESC, tc.id DESC';

    const [rows] = await db.query(query, params);

    res.json({
      success: true,
      data: rows.map((row) => mapTrainConfigRecord(row, { includeContent })),
      meta: {
        registryReady: true,
        count: rows.length
      }
    });
  } catch (error) {
    return sendServerError(res, '加载 train configs 失败:', 'Failed to fetch train configs', error);
  }
});

router.get('/training-guide/bootstrap', async (req, res) => {
  try {
    const trainManagement = loadTrainingManagementService();
    const symbol = String(trainManagement.DEFAULT_TRAINING_SYMBOL || 'BTCJPY').toUpperCase();
    const intervalType = '1min';
    const coverage = await loadTrainingGuideCoverage(symbol, intervalType);
    const data = trainManagement.buildTrainingGuideBootstrap(new Date(), coverage);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    return sendServerError(res, '加载 training guide bootstrap 失败:', 'Failed to load training guide bootstrap', error);
  }
});

router.post('/training-guide/draft', async (req, res) => {
  try {
    const trainManagement = loadTrainingManagementService();
    const body = req.body || {};
    const data = trainManagement.buildTrainingGuideDraft(
      parseJsonContent(body.content),
      String(body.configKey || body.config_key || ''),
      new Date()
    );

    res.json({
      success: true,
      data
    });
  } catch (error) {
    return sendJsonError(res, 400, 'Failed to build training guide draft', getErrorMessage(error));
  }
});

router.post('/training-guide/preview', async (req, res) => {
  try {
    const trainManagement = loadTrainingManagementService();
    const body = req.body || {};
    const draft = body.draft && typeof body.draft === 'object' ? body.draft : {};
    const symbol = String(draft.symbol || trainManagement.DEFAULT_TRAINING_SYMBOL || 'BTCJPY').toUpperCase();
    const intervalType = String(draft.intervalType || '1min');
    const coverage = await loadTrainingGuideCoverage(symbol, intervalType);
    const data = trainManagement.buildTrainingConfigFromGuide(
      draft,
      body.baseConfig && typeof body.baseConfig === 'object'
        ? body.baseConfig
        : trainManagement.buildDefaultTrainingTemplate(new Date(), coverage),
      new Date()
    );

    res.json({
      success: true,
      data
    });
  } catch (error) {
    return sendJsonError(res, 400, 'Failed to build training config preview', getErrorMessage(error));
  }
});

router.get('/:id', async (req, res) => {
  try {
    const hasRegistry = await ensureRegistryTableExists();
    if (!hasRegistry) {
      return sendRegistryNotReady(res);
    }
    await ensureBacktestResultsSchema(db);
    await ensureTrainDataTraceSchema(db);

    const row = await loadConfigById(req.params.id);
    if (!row) {
      return res.status(404).json({
        success: false,
        error: 'Train config not found'
      });
    }

    res.json({
      success: true,
      data: mapTrainConfigRecord(row, { includeContent: true })
    });
  } catch (error) {
    return sendServerError(res, '读取 train config 失败:', 'Failed to fetch train config', error);
  }
});

router.get('/:id/router-artifacts/bootstrap', async (req, res) => {
  try {
    const hasRegistry = await ensureRegistryTableExists();
    if (!hasRegistry) {
      return sendRegistryNotReady(res);
    }

    const row = await loadConfigById(req.params.id);
    if (!row) {
      return res.status(404).json({
        success: false,
        error: 'Train config not found'
      });
    }

    const trainingRecord = mapTrainConfigRecord(row, { includeContent: true });
    assertTrainingRecord(trainingRecord);

    const derivedConfigs = await loadDerivedConfigs(trainingRecord);
    const snapshotRecord = [...derivedConfigs]
      .filter((item) => String(item.configType || '') === 'top-strategies')
      .sort((left, right) => Number(right.id || 0) - Number(left.id || 0))[0] || null;

    const existingRouterRef = String(trainingRecord.content?.regimeRouting?.routerConfigPath || '').trim();
    const existingPolicyRef = String(trainingRecord.content?.regimeRouting?.policyCatalogPath || '').trim();
    const routerConfigKey = existingRouterRef
      ? toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(trainingRecord.configKey), existingRouterRef)))
      : buildDefaultRouterConfigKey(trainingRecord);
    const policyConfigKey = existingPolicyRef
      ? toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(trainingRecord.configKey), existingPolicyRef)))
      : buildDefaultPolicyConfigKey(routerConfigKey);

    const routerContent = loadJsonFileIfExists(routerConfigKey)
      || buildDefaultRouterContent(trainingRecord, routerConfigKey, policyConfigKey, snapshotRecord);
    const policyContent = loadJsonFileIfExists(policyConfigKey)
      || buildDefaultPolicyContent(routerContent, routerConfigKey);

    res.json({
      success: true,
      data: {
        trainingConfigId: trainingRecord.id,
        trainingConfigKey: trainingRecord.configKey,
        routerConfigKey,
        policyConfigKey,
        routerRelativeRef: buildRelativeConfigRef(trainingRecord.configKey, routerConfigKey),
        policyRelativeRef: buildRelativeConfigRef(trainingRecord.configKey, policyConfigKey),
        routerContent,
        policyContent,
        strategyCatalogCount: Object.keys(routerContent.strategyCatalog || {}).length,
        snapshotConfigKey: snapshotRecord?.configKey || null,
        snapshotReady: Boolean(snapshotRecord)
      }
    });
  } catch (error) {
    return sendJsonError(res, 400, 'Failed to bootstrap router artifacts', getErrorMessage(error));
  }
});

router.post('/', async (req, res) => {
  try {
    const hasRegistry = await ensureRegistryTableExists();
    if (!hasRegistry) {
      return sendRegistryNotReady(res);
    }

    const body = req.body || {};
    const payload = parseJsonContent(body.content);
    const trainConfigRegistry = getTrainConfigRegistryService();
    const saved = await trainConfigRegistry.upsertTrainConfig(
      db,
      body.configKey || body.config_key,
      payload,
      {
        explicitType: body.configType || body.config_type
      }
    );
    const savedRow = await trainConfigRegistry.loadTrainConfigByKey(db, saved.configKey);

    res.json({
      success: true,
      data: mapTrainConfigRecord(savedRow, { includeContent: true }),
      message: 'Train config saved'
    });
  } catch (error) {
    return sendJsonError(res, 400, 'Failed to save train config', getErrorMessage(error));
  }
});

router.post('/:id/router-artifacts', async (req, res) => {
  try {
    const hasRegistry = await ensureRegistryTableExists();
    if (!hasRegistry) {
      return sendRegistryNotReady(res);
    }

    const row = await loadConfigById(req.params.id);
    if (!row) {
      return res.status(404).json({
        success: false,
        error: 'Train config not found'
      });
    }

    const trainingRecord = mapTrainConfigRecord(row, { includeContent: true });
    assertTrainingRecord(trainingRecord);

    const routerContent = ensureJsonObject(parseJsonContent(req.body?.routerContent), 'routerContent');
    const policyContent = ensureJsonObject(parseJsonContent(req.body?.policyContent), 'policyContent');
    const routerConfigKey = String(req.body?.routerConfigKey || '').trim();
    const policyConfigKey = String(req.body?.policyConfigKey || '').trim();

    if (!routerConfigKey || !policyConfigKey) {
      return sendJsonError(res, 400, 'Failed to save router artifacts', 'routerConfigKey 和 policyConfigKey 为必填');
    }

    if (!routerConfigKey.startsWith('configs/generated/regime-routing/') || !routerConfigKey.endsWith('.json')) {
      return sendJsonError(res, 400, 'Failed to save router artifacts', 'routerConfigKey 必须位于 configs/generated/regime-routing/ 且以 .json 结尾');
    }
    if (!policyConfigKey.startsWith('configs/generated/regime-routing/') || !policyConfigKey.endsWith('.json')) {
      return sendJsonError(res, 400, 'Failed to save router artifacts', 'policyConfigKey 必须位于 configs/generated/regime-routing/ 且以 .json 结尾');
    }

    if (trainingRecord.trainId) {
      routerContent.trainId = trainingRecord.trainId;
      routerContent.trainingMeta = {
        ...(routerContent.trainingMeta && typeof routerContent.trainingMeta === 'object' ? routerContent.trainingMeta : {}),
        trainId: trainingRecord.trainId
      };
      policyContent.trainId = trainingRecord.trainId;
      policyContent.trainingMeta = {
        ...(policyContent.trainingMeta && typeof policyContent.trainingMeta === 'object' ? policyContent.trainingMeta : {}),
        trainId: trainingRecord.trainId
      };
    }

    routerContent.policyCatalogPath = path.posix.basename(policyConfigKey);
    policyContent.source = {
      ...(policyContent.source && typeof policyContent.source === 'object' ? policyContent.source : {}),
      routerConfigPath: path.posix.basename(routerConfigKey)
    };

    const routerAbsolutePath = resolveAbsoluteConfigPath(routerConfigKey);
    const policyAbsolutePath = resolveAbsoluteConfigPath(policyConfigKey);
    fs.mkdirSync(path.dirname(routerAbsolutePath), { recursive: true });
    fs.mkdirSync(path.dirname(policyAbsolutePath), { recursive: true });
    fs.writeFileSync(routerAbsolutePath, `${JSON.stringify(routerContent, null, 2)}\n`, 'utf8');
    fs.writeFileSync(policyAbsolutePath, `${JSON.stringify(policyContent, null, 2)}\n`, 'utf8');

    const trainConfigRegistry = getTrainConfigRegistryService();
    await trainConfigRegistry.upsertTrainConfig(db, routerConfigKey, routerContent, {
      explicitType: 'router',
      parentConfigId: trainingRecord.id
    });
    await trainConfigRegistry.upsertTrainConfig(db, policyConfigKey, policyContent, {
      explicitType: 'policy',
      parentConfigId: trainingRecord.id
    });

    const nextTrainingContent = {
      ...trainingRecord.content,
      ...(trainingRecord.trainId
        ? {
            trainId: trainingRecord.trainId,
            trainingMeta: {
              ...(trainingRecord.content?.trainingMeta && typeof trainingRecord.content.trainingMeta === 'object'
                ? trainingRecord.content.trainingMeta
                : {}),
              trainId: trainingRecord.trainId
            }
          }
        : {}),
      regimeRouting: {
        ...(trainingRecord.content?.regimeRouting && typeof trainingRecord.content.regimeRouting === 'object'
          ? trainingRecord.content.regimeRouting
          : {}),
        routerConfigPath: buildRelativeConfigRef(trainingRecord.configKey, routerConfigKey),
        policyCatalogPath: buildRelativeConfigRef(trainingRecord.configKey, policyConfigKey)
      }
    };

    await trainConfigRegistry.upsertTrainConfig(db, trainingRecord.configKey, nextTrainingContent, {
      explicitType: 'training',
      parentConfigId: trainingRecord.id
    });

    res.json({
      success: true,
      data: {
        routerConfigKey,
        policyConfigKey,
        routerRelativeRef: buildRelativeConfigRef(trainingRecord.configKey, routerConfigKey),
        policyRelativeRef: buildRelativeConfigRef(trainingRecord.configKey, policyConfigKey)
      },
      message: 'Router artifacts saved'
    });
  } catch (error) {
    return sendJsonError(res, 400, 'Failed to save router artifacts', getErrorMessage(error));
  }
});

router.post('/:id/export', async (req, res) => {
  try {
    const hasRegistry = await ensureRegistryTableExists();
    if (!hasRegistry) {
      return sendRegistryNotReady(res);
    }

    const row = await loadConfigById(req.params.id);
    if (!row) {
      return res.status(404).json({
        success: false,
        error: 'Train config not found'
      });
    }

    const record = mapTrainConfigRecord(row, { includeContent: true });
    const trainOrchestration = loadTrainOrchestrationService();
    const absolutePath = resolveAbsoluteConfigPath(record.configKey);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, `${JSON.stringify(record.content, null, 2)}\n`, 'utf8');

    res.json({
      success: true,
      data: {
        id: record.id,
        configKey: record.configKey,
        exportedPath: absolutePath
      },
      message: 'Train config exported'
    });
  } catch (error) {
    return sendJsonError(res, 400, 'Failed to export train config', getErrorMessage(error));
  }
});

router.post('/:id/clear-results', async (req, res) => {
  let connection;

  try {
    const hasRegistry = await ensureRegistryTableExists();
    if (!hasRegistry) {
      return sendRegistryNotReady(res);
    }

    const row = await loadConfigById(req.params.id);
    if (!row) {
      return res.status(404).json({
        success: false,
        error: 'Train config not found'
      });
    }

    const record = mapTrainConfigRecord(row, { includeContent: true });
    const relatedConfigs = record.configType === 'training'
      ? await loadDerivedConfigs(record)
      : [];
    const trainOrchestration = loadTrainOrchestrationService();
    const clearPlan = trainOrchestration.buildClearResultsPlan(record, relatedConfigs);
    const reportDeletePlan = record.configType === 'training'
      ? buildReportDeletePlan(record, relatedConfigs)
      : [];
    if (record.configType === 'training' && !record.trainId) {
      return sendJsonError(res, 400, 'Failed to clear train results', 'train_id is required; old data compatibility has been removed');
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    let deletedBacktestRows = 0;
    if (record.configType === 'training') {
      const [deleteResult] = await connection.query(
        `DELETE FROM ${BACKTEST_RESULTS_TABLE}
         WHERE train_id = ?`,
        [record.trainId]
      );
      deletedBacktestRows = Number(deleteResult.affectedRows || 0);
    } else {
      for (const resultGroup of clearPlan.resultGroups) {
        const [deleteResult] = await connection.query(
          `DELETE FROM ${BACKTEST_RESULTS_TABLE}
           WHERE result_group = ?`,
          [resultGroup]
        );
        deletedBacktestRows += Number(deleteResult.affectedRows || 0);
      }
    }

    const deletedFiles = [];
    const deletedReportFiles = [];
    let deletedRegistryRows = 0;
    let deletedRequestRows = 0;
    let deletedTaskRows = 0;
    let deletedTradeRows = 0;
    let deletedStrategyRows = 0;
    let deletedGoalTrackingRows = 0;
    if (record.configType === 'training') {
      const [deleteRequestsResult] = await connection.query(
        `DELETE FROM ${TABLES.TRAIN_RUN_REQUESTS}
         WHERE train_id = ?`,
        [record.trainId]
      );
      deletedRequestRows = Number(deleteRequestsResult.affectedRows || 0);

      const [deleteTasksResult] = await connection.query(
        `DELETE FROM ${TABLES.TASKS}
         WHERE train_id = ?`,
        [record.trainId]
      );
      deletedTaskRows = Number(deleteTasksResult.affectedRows || 0);

      const [deleteTradesResult] = await connection.query(
        `DELETE FROM ${TABLES.TRADES}
         WHERE train_id = ?`,
        [record.trainId]
      );
      deletedTradeRows = Number(deleteTradesResult.affectedRows || 0);

      const [deleteStrategiesResult] = await connection.query(
        `DELETE FROM ${TABLES.STRATEGIES}
         WHERE train_id = ?`,
        [record.trainId]
      );
      deletedStrategyRows = Number(deleteStrategiesResult.affectedRows || 0);

      const [deleteGoalTrackingResult] = await connection.query(
        `DELETE FROM ${TABLES.TRAIN_GOAL_TRACKING}
         WHERE train_id = ?`,
        [record.trainId]
      );
      deletedGoalTrackingRows = Number(deleteGoalTrackingResult.affectedRows || 0);

      for (const item of clearPlan.removableConfigs) {
        const absolutePath = resolveAbsoluteConfigPath(item.configKey);
        if (safeUnlink(absolutePath)) {
          deletedFiles.push(item.configKey);
        }
      }

      for (const reportKey of reportDeletePlan) {
        const absolutePath = resolveAbsoluteConfigPath(reportKey);
        if (safeUnlink(absolutePath)) {
          deletedReportFiles.push(reportKey);
        }
      }

      const [deleteRegistryResult] = await connection.query(
        `DELETE FROM ${TRAIN_CONFIGS_TABLE}
         WHERE train_id = ?`,
        [record.trainId]
      );
      deletedRegistryRows = Number(deleteRegistryResult.affectedRows || 0);
    }

    await connection.commit();
    connection.release();
    connection = null;

    res.json({
      success: true,
      data: {
        configId: record.id,
        configKey: record.configKey,
        configType: record.configType,
        clearedResultGroups: Array.from(clearPlan.resultGroups),
        deletedBacktestRows,
        deletedRegistryRows,
        deletedRequestRows,
        deletedTaskRows,
        deletedTradeRows,
        deletedStrategyRows,
        deletedGoalTrackingRows,
        deletedFiles,
        deletedReportFiles
      },
      message: 'Train results cleared'
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }

    return sendServerError(res, '清除 train 结果失败:', 'Failed to clear train results', error);
  }
});

module.exports = router;
