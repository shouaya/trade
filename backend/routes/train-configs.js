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
        exportedPath: absolutePath,
        runCommand: trainOrchestration.buildRunCommand(record.configType, record.configKey)
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
