const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');

const router = express.Router();

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TRAIN_ROOT = process.env.TRAIN_ROOT
  ? path.resolve(process.env.TRAIN_ROOT)
  : path.join(REPO_ROOT, 'train');
const TRAIN_CONFIGS_TABLE = 'train_configs';
const BACKTEST_RESULTS_TABLE = 'backtest_results';

function buildDbSourcePath(configKey) {
  return `db://train-configs/${String(configKey || '').replace(/^\/+/, '')}`;
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

function normalizeConfigKey(value) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');

  if (!normalized || !normalized.endsWith('.json')) {
    throw new Error('configKey 必须是 .json 结尾的相对路径');
  }

  if (normalized.includes('..')) {
    throw new Error('configKey 不能包含 ..');
  }

  if (!normalized.startsWith('configs/')) {
    throw new Error('configKey 必须位于 configs/ 下');
  }

  return normalized;
}

function parseContent(content) {
  if (typeof content === 'string') {
    return JSON.parse(content);
  }

  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return content;
  }

  throw new Error('content 必须是 JSON 对象或 JSON 字符串');
}

function detectConfigType(configKey, payload, explicitType) {
  if (explicitType) {
    return String(explicitType);
  }

  if (configKey.startsWith('configs/training/')) {
    return 'training';
  }
  if (configKey.startsWith('configs/validation/')) {
    return 'validation';
  }
  if (configKey.startsWith('configs/top-strategies/')) {
    return 'top-strategies';
  }
  if (configKey.startsWith('configs/generated/regime-routing/')) {
    return 'router';
  }
  if (configKey.startsWith('configs/generated/')) {
    return 'generated';
  }
  return payload?.generatedAt ? 'generated' : 'config';
}

function resolveTrainingYear(payload, configKey) {
  const fileYear = String(configKey).match(/(?:^|\/)(\d{4})_/);
  if (fileYear) {
    return fileYear[1];
  }

  const startIso = payload?.timeRange?.startIso;
  if (startIso) {
    return String(new Date(startIso).getUTCFullYear());
  }

  const startTimeMs = payload?.timeRange?.startTimeMs;
  if (startTimeMs) {
    return String(new Date(Number(startTimeMs)).getUTCFullYear());
  }

  return null;
}

function buildMetadata(configKey, payload, explicitType) {
  const contentRaw = JSON.stringify(payload, null, 2);
  const configType = detectConfigType(configKey, payload, explicitType);

  return {
    configKey,
    configType,
    fileName: path.basename(configKey),
    configName: payload?.name || null,
    symbol: payload?.market?.symbol ? String(payload.market.symbol).toUpperCase() : null,
    intervalType: payload?.market?.intervalType || null,
    resultGroup: payload?.database?.tableName || null,
    sourceTable: payload?.sourceTable || null,
    trainConfigRef: payload?.trainConfig || null,
    trainingYear: resolveTrainingYear(payload, configKey),
    isGenerated: configKey.includes('/generated/') || configKey.includes('/top-strategies/') || Boolean(payload?.generatedAt),
    contentRaw,
    contentHash: crypto.createHash('sha256').update(contentRaw).digest('hex')
  };
}

function toConfigRecord(row, includeContent = false) {
  const content = typeof row.content === 'string'
    ? JSON.parse(row.content)
    : row.content;

  return {
    id: Number(row.id),
    configKey: String(row.config_key),
    configType: String(row.config_type),
    fileName: String(row.file_name),
    configName: row.config_name ? String(row.config_name) : null,
    symbol: row.symbol ? String(row.symbol) : null,
    intervalType: row.interval_type ? String(row.interval_type) : null,
    resultGroup: row.result_group ? String(row.result_group) : null,
    sourceTable: row.source_table ? String(row.source_table) : null,
    trainConfigRef: row.train_config_ref ? String(row.train_config_ref) : null,
    trainingYear: row.training_year ? String(row.training_year) : null,
    isGenerated: Boolean(row.is_generated),
    contentHash: String(row.content_hash),
    fileMtime: formatIso(row.file_mtime),
    syncedAt: formatIso(row.synced_at),
    updatedAt: formatIso(row.updated_at),
    ...(includeContent ? { content } : {})
  };
}

async function ensureRegistryTableExists() {
  const [rows] = await db.query('SHOW TABLES LIKE ?', [TRAIN_CONFIGS_TABLE]);
  return rows.length > 0;
}

function sendRegistryNotReady(res) {
  return res.status(503).json({
    success: false,
    error: 'Train config registry not ready',
    message: 'train_configs 表不存在，请先执行 docker compose run --rm train sh -lc "npm install && npm run build && npm run init-db"；如果要导入初始样例配置，再执行 npm run seed:configs'
  });
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

  return rows.map((row) => toConfigRecord(row, true));
}

function buildRunCommand(configType, configKey) {
  if (configType === 'training') {
    return `docker compose run --rm train sh -lc "npm install && npm run build && npm run train -- ${configKey}"`;
  }

  if (configType === 'validation') {
    return `docker compose run --rm train sh -lc "npm install && npm run build && npm run validate -- ${configKey}"`;
  }

  return null;
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
      data: rows.map((row) => toConfigRecord(row, includeContent)),
      meta: {
        registryReady: true,
        count: rows.length
      }
    });
  } catch (error) {
    console.error('加载 train configs 失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch train configs',
      message: error.message
    });
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
      data: toConfigRecord(row, true)
    });
  } catch (error) {
    console.error('读取 train config 失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch train config',
      message: error.message
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const hasRegistry = await ensureRegistryTableExists();
    if (!hasRegistry) {
      return sendRegistryNotReady(res);
    }

    const body = req.body || {};
    const payload = parseContent(body.content);
    const configKey = normalizeConfigKey(body.configKey || body.config_key);
    const metadata = buildMetadata(configKey, payload, body.configType || body.config_type);

    await db.query(
      `INSERT INTO ${TRAIN_CONFIGS_TABLE}
        (config_key, config_type, file_path, file_name, config_name, symbol, interval_type, result_group,
         source_table, train_config_ref, training_year, is_generated, content_hash, content, file_mtime, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), NULL, NOW())
       ON DUPLICATE KEY UPDATE
         config_type = VALUES(config_type),
         file_path = VALUES(file_path),
         file_name = VALUES(file_name),
         config_name = VALUES(config_name),
         symbol = VALUES(symbol),
         interval_type = VALUES(interval_type),
         result_group = VALUES(result_group),
         source_table = VALUES(source_table),
         train_config_ref = VALUES(train_config_ref),
         training_year = VALUES(training_year),
         is_generated = VALUES(is_generated),
         content_hash = VALUES(content_hash),
         content = VALUES(content),
         synced_at = NOW()`,
      [
        metadata.configKey,
        metadata.configType,
        buildDbSourcePath(metadata.configKey),
        metadata.fileName,
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
      data: toConfigRecord(rows[0], true),
      message: 'Train config saved'
    });
  } catch (error) {
    console.error('保存 train config 失败:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to save train config',
      message: error.message
    });
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

    const record = toConfigRecord(row, true);
    const absolutePath = resolveAbsoluteConfigPath(record.configKey);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, `${JSON.stringify(record.content, null, 2)}\n`, 'utf8');

    await db.query(
      `UPDATE ${TRAIN_CONFIGS_TABLE}
       SET file_path = ?, file_mtime = NOW(), synced_at = NOW()
       WHERE id = ?`,
      [absolutePath, record.id]
    );

    res.json({
      success: true,
      data: {
        id: record.id,
        configKey: record.configKey,
        exportedPath: absolutePath,
        runCommand: buildRunCommand(record.configType, record.configKey)
      },
      message: 'Train config exported'
    });
  } catch (error) {
    console.error('导出 train config 失败:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to export train config',
      message: error.message
    });
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

    const record = toConfigRecord(row, true);
    const relatedConfigs = record.configType === 'training'
      ? await loadDerivedConfigs(record)
      : [];

    const resultGroups = new Set(
      [record.resultGroup, ...relatedConfigs.map((item) => item.resultGroup)]
        .filter(Boolean)
        .map((item) => String(item))
    );

    connection = await db.getConnection();
    await connection.beginTransaction();

    let deletedBacktestRows = 0;
    for (const resultGroup of resultGroups) {
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
      const removableConfigs = relatedConfigs.filter((item) => item.configType === 'validation' || item.configType === 'top-strategies');
      for (const item of removableConfigs) {
        const absolutePath = resolveAbsoluteConfigPath(item.configKey);
        if (safeUnlink(absolutePath)) {
          deletedFiles.push(item.configKey);
        }
      }

      if (removableConfigs.length > 0) {
        const ids = removableConfigs.map((item) => item.id);
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
        clearedResultGroups: Array.from(resultGroups),
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

    console.error('清除 train 结果失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear train results',
      message: error.message
    });
  }
});

module.exports = router;
