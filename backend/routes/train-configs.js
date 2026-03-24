const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  BACKTEST_RESULTS_TABLE,
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
  return tableExists(db, TRAIN_CONFIGS_TABLE);
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
  const [rows] = await db.query(
    `SELECT *
     FROM ${TRAIN_CONFIGS_TABLE}
     WHERE id = ?
     LIMIT 1`,
    [id]
  );

  return rows[0] || null;
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
  const defaultStrategyKey = strategyKeys[0] || 'rank1';
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
    rules: []
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

async function loadDerivedConfigs(trainingRecord) {
  const [rows] = await db.query(
    `SELECT *
     FROM ${TRAIN_CONFIGS_TABLE}
     WHERE id <> ?
       AND (
         train_config_ref = ?
         OR source_table = ?
       )
     ORDER BY id ASC`,
    [trainingRecord.id, trainingRecord.configKey, trainingRecord.resultGroup || '']
  );

  return rows.map((row) => mapTrainConfigRecord(row, { includeContent: true }));
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
    const configType = req.query.type ? String(req.query.type) : null;
    const params = [];
    let query = `
      SELECT *
      FROM ${TRAIN_CONFIGS_TABLE}
    `;

    if (configType) {
      query += ' WHERE config_type = ?';
      params.push(configType);
    } else if (!includeDerived) {
      query += ` WHERE config_type = 'training'`;
    }

    query += ' ORDER BY updated_at DESC, id DESC';

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
    const data = trainManagement.buildTrainingGuideBootstrap(new Date());

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
    const data = trainManagement.buildTrainingConfigFromGuide(
      body.draft && typeof body.draft === 'object' ? body.draft : {},
      body.baseConfig && typeof body.baseConfig === 'object' ? body.baseConfig : trainManagement.buildDefaultTrainingTemplate(new Date()),
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
    const trainConfigRegistry = loadTrainConfigRegistryService();
    const metadata = trainConfigRegistry.buildTrainConfigMetadata(
      body.configKey || body.config_key,
      payload,
      {
        explicitType: body.configType || body.config_type
      }
    );

    await db.query(
      `INSERT INTO ${TRAIN_CONFIGS_TABLE}
        (config_key, config_type, config_name, symbol, interval_type, result_group,
         source_table, train_config_ref, training_year, is_generated, content_hash, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         config_type = VALUES(config_type),
         config_name = VALUES(config_name),
         symbol = VALUES(symbol),
         interval_type = VALUES(interval_type),
         result_group = VALUES(result_group),
         source_table = VALUES(source_table),
         train_config_ref = VALUES(train_config_ref),
         training_year = VALUES(training_year),
         is_generated = VALUES(is_generated),
         content_hash = VALUES(content_hash),
         content = VALUES(content)`,
      [
        metadata.configKey,
        metadata.configType,
        metadata.configName,
        metadata.symbol,
        metadata.intervalType,
        metadata.resultGroup,
        metadata.sourceTable,
        metadata.trainConfigRef,
        metadata.trainingYear,
        metadata.isGenerated ? 1 : 0,
        metadata.contentHash,
        metadata.contentRaw
      ]
    );

    const [rows] = await db.query(
      `SELECT *
       FROM ${TRAIN_CONFIGS_TABLE}
       WHERE config_key = ?
       LIMIT 1`,
      [metadata.configKey]
    );

    res.json({
      success: true,
      data: mapTrainConfigRecord(rows[0], { includeContent: true }),
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

    const trainConfigRegistry = loadTrainConfigRegistryService();
    const routerMetadata = trainConfigRegistry.buildTrainConfigMetadata(routerConfigKey, routerContent, {
      explicitType: 'router'
    });

    await db.query(
      `INSERT INTO ${TRAIN_CONFIGS_TABLE}
        (config_key, config_type, config_name, symbol, interval_type, result_group,
         source_table, train_config_ref, training_year, is_generated, content_hash, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         config_type = VALUES(config_type),
         config_name = VALUES(config_name),
         symbol = VALUES(symbol),
         interval_type = VALUES(interval_type),
         result_group = VALUES(result_group),
         source_table = VALUES(source_table),
         train_config_ref = VALUES(train_config_ref),
         training_year = VALUES(training_year),
         is_generated = VALUES(is_generated),
         content_hash = VALUES(content_hash),
         content = VALUES(content)`,
      [
        routerMetadata.configKey,
        routerMetadata.configType,
        routerMetadata.configName,
        routerMetadata.symbol,
        routerMetadata.intervalType,
        routerMetadata.resultGroup,
        routerMetadata.sourceTable,
        routerMetadata.trainConfigRef,
        routerMetadata.trainingYear,
        routerMetadata.isGenerated ? 1 : 0,
        routerMetadata.contentHash,
        routerMetadata.contentRaw
      ]
    );

    const nextTrainingContent = {
      ...trainingRecord.content,
      regimeRouting: {
        ...(trainingRecord.content?.regimeRouting && typeof trainingRecord.content.regimeRouting === 'object'
          ? trainingRecord.content.regimeRouting
          : {}),
        routerConfigPath: buildRelativeConfigRef(trainingRecord.configKey, routerConfigKey),
        policyCatalogPath: buildRelativeConfigRef(trainingRecord.configKey, policyConfigKey)
      }
    };

    const trainingMetadata = trainConfigRegistry.buildTrainConfigMetadata(trainingRecord.configKey, nextTrainingContent, {
      explicitType: 'training'
    });

    await db.query(
      `UPDATE ${TRAIN_CONFIGS_TABLE}
       SET config_name = ?, symbol = ?, interval_type = ?, result_group = ?, source_table = ?, train_config_ref = ?,
           training_year = ?, is_generated = ?, content_hash = ?, content = CAST(? AS JSON)
       WHERE id = ?`,
      [
        trainingMetadata.configName,
        trainingMetadata.symbol,
        trainingMetadata.intervalType,
        trainingMetadata.resultGroup,
        trainingMetadata.sourceTable,
        trainingMetadata.trainConfigRef,
        trainingMetadata.trainingYear,
        trainingMetadata.isGenerated ? 1 : 0,
        trainingMetadata.contentHash,
        trainingMetadata.contentRaw,
        trainingRecord.id
      ]
    );

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

    connection = await db.getConnection();
    await connection.beginTransaction();

    let deletedBacktestRows = 0;
    for (const resultGroup of clearPlan.resultGroups) {
      const [deleteResult] = await connection.query(
        `DELETE FROM ${BACKTEST_RESULTS_TABLE}
         WHERE result_group = ?`,
        [resultGroup]
      );
      deletedBacktestRows += Number(deleteResult.affectedRows || 0);
    }

    const deletedFiles = [];
    let deletedRegistryRows = 0;
    if (record.configType === 'training') {
      for (const item of clearPlan.removableConfigs) {
        const absolutePath = resolveAbsoluteConfigPath(item.configKey);
        if (safeUnlink(absolutePath)) {
          deletedFiles.push(item.configKey);
        }
      }

      if (clearPlan.removableConfigs.length > 0) {
        const ids = clearPlan.removableConfigs.map((item) => item.id);
        const [deleteRegistryResult] = await connection.query(
          `DELETE FROM ${TRAIN_CONFIGS_TABLE}
           WHERE id IN (${ids.map(() => '?').join(', ')})`,
          ids
        );
        deletedRegistryRows = Number(deleteRegistryResult.affectedRows || 0);
      }
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
        deletedFiles
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
