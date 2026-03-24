const express = require('express');
const crypto = require('crypto');
const {
  ensureTrainConfigsSchema,
  ensureTrainRunRequestsSchema,
  TRAIN_CONFIGS_TABLE,
  TRAIN_RUN_REQUESTS_TABLE,
  allTablesExist
} = require('@money/database');
const db = require('../config/database');
const { loadTrainOrchestrationService } = require('../lib/train-service-loader');
const { mapTrainRunRequestRecord } = require('../lib/api-mappers');
const {
  getErrorMessage,
  sendJsonError,
  sendServerError
} = require('../lib/route-utils');

const router = express.Router();

const REQUEST_TABLE = TRAIN_RUN_REQUESTS_TABLE;
const CONFIG_TABLE = TRAIN_CONFIGS_TABLE;

async function ensureTablesReady() {
  await ensureTrainConfigsSchema(db);
  await ensureTrainRunRequestsSchema(db);
  return allTablesExist(db, [REQUEST_TABLE, CONFIG_TABLE]);
}

async function loadConfigById(configId) {
  const [rows] = await db.query(
    `SELECT id, config_key, config_name, config_type, train_id
     FROM ${CONFIG_TABLE}
     WHERE id = ?
     LIMIT 1`,
    [configId]
  );

  return rows[0] || null;
}

async function loadRequestById(id) {
  const [rows] = await db.query(
    `SELECT *
     FROM ${REQUEST_TABLE}
     WHERE id = ?
     LIMIT 1`,
    [id]
  );

  return rows[0] || null;
}

function buildRequestId() {
  return `runreq-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}`;
}

function buildTrainId() {
  return `train-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}`;
}

async function ensureConfigTrainId(configId, nextTrainId) {
  await db.query(
    `UPDATE ${CONFIG_TABLE}
     SET train_id = ?
     WHERE id = ?`,
    [nextTrainId, configId]
  );
}

async function insertQueuedRequest(config, action, requestedBy, triggerSource) {
  const requestId = buildRequestId();
  const trainId = action === 'train'
    ? buildTrainId()
    : String(config.train_id || '').trim();

  if (!trainId) {
    throw new Error('train_id is required before queuing non-training actions');
  }

  if (action === 'train') {
    await ensureConfigTrainId(Number(config.id), trainId);
  }

  await db.query(
    `INSERT INTO ${REQUEST_TABLE}
      (request_id, config_id, config_key, config_name, config_type, train_id, action, status, requested_by, trigger_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    [
      requestId,
      Number(config.id),
      String(config.config_key),
      config.config_name ? String(config.config_name) : null,
      String(config.config_type),
      trainId,
      action,
      requestedBy,
      triggerSource
    ]
  );

  const [rows] = await db.query(
    `SELECT *
     FROM ${REQUEST_TABLE}
     WHERE request_id = ?
     LIMIT 1`,
    [requestId]
  );

  return rows[0];
}

router.get('/', async (req, res) => {
  try {
    const ready = await ensureTablesReady();
    if (!ready) {
      return res.json({
        success: true,
        data: [],
        meta: {
          queueReady: false
        }
      });
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const [rows] = await db.query(
      `SELECT *
       FROM ${REQUEST_TABLE}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [limit]
    );

    res.json({
      success: true,
      data: rows.map(mapTrainRunRequestRecord),
      meta: {
        queueReady: true,
        count: rows.length
      }
    });
  } catch (error) {
    return sendServerError(res, '加载运行请求失败:', 'Failed to fetch train run requests', error);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await loadRequestById(req.params.id);
    if (!row) {
      return res.status(404).json({
        success: false,
        error: 'Run request not found'
      });
    }

    res.json({
      success: true,
      data: mapTrainRunRequestRecord(row)
    });
  } catch (error) {
    return sendServerError(res, '读取运行请求失败:', 'Failed to fetch train run request', error);
  }
});

router.post('/', async (req, res) => {
  try {
    const ready = await ensureTablesReady();
    if (!ready) {
      return res.status(400).json({
        success: false,
        error: 'Queue not ready',
        message: 'train_run_requests or train_configs table is missing'
      });
    }

    const configId = Number(req.body?.configId);
    if (!Number.isInteger(configId) || configId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid configId'
      });
    }

    const config = await loadConfigById(configId);
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Config not found'
      });
    }

    const configType = String(config.config_type);
    const trainOrchestration = loadTrainOrchestrationService();
    let action;
    try {
      action = trainOrchestration.resolveRunRequestAction(configType, req.body?.action ? String(req.body.action) : null);
    } catch (error) {
      return sendJsonError(res, 400, 'Unsupported action', getErrorMessage(error));
    }

    const createdRow = await insertQueuedRequest(
      config,
      action,
      req.body?.requestedBy ? String(req.body.requestedBy) : 'ui',
      'ui'
    );

    res.json({
      success: true,
      data: mapTrainRunRequestRecord(createdRow),
      message: 'Run request queued'
    });
  } catch (error) {
    return sendServerError(res, '创建运行请求失败:', 'Failed to create train run request', error);
  }
});

router.post('/:id/retry', async (req, res) => {
  try {
    const current = await loadRequestById(req.params.id);
    if (!current) {
      return res.status(404).json({
        success: false,
        error: 'Run request not found'
      });
    }

    const status = String(current.status);
    if (!(status === 'failed' || status === 'cancelled' || status === 'completed')) {
      return res.status(400).json({
        success: false,
        error: 'Request cannot be retried',
        message: `Current status is ${status}`
      });
    }

    const config = await loadConfigById(Number(current.config_id));
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Config not found for retry'
      });
    }

    const createdRow = await insertQueuedRequest(
      config,
      String(current.action),
      req.body?.requestedBy ? String(req.body.requestedBy) : 'ui',
      'retry'
    );

    res.json({
      success: true,
      data: mapTrainRunRequestRecord(createdRow),
      message: 'Run request re-queued'
    });
  } catch (error) {
    return sendServerError(res, '重试运行请求失败:', 'Failed to retry train run request', error);
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const current = await loadRequestById(req.params.id);
    if (!current) {
      return res.status(404).json({
        success: false,
        error: 'Run request not found'
      });
    }

    const status = String(current.status);
    if (status === 'running') {
      const [result] = await db.query(
        `UPDATE ${REQUEST_TABLE}
         SET status = 'cancelling', cancel_requested = 1, error_message = ?, updated_at = NOW()
         WHERE id = ? AND status = 'running'`,
        ['cancel requested by user', Number(current.id)]
      );

      if (result.affectedRows !== 1) {
        return res.status(409).json({
          success: false,
          error: 'Cancel conflict',
          message: 'Request status changed before cancel'
        });
      }

      const updatedRunning = await loadRequestById(req.params.id);
      return res.json({
        success: true,
        data: mapTrainRunRequestRecord(updatedRunning),
        message: 'Run request cancelling'
      });
    }

    if (!(status === 'queued' || status === 'exporting' || status === 'cancelling')) {
      return res.status(400).json({
        success: false,
        error: 'Request cannot be cancelled',
        message: `Only queued/exporting/running request can be cancelled, got ${status}`
      });
    }

    const [result] = await db.query(
      `UPDATE ${REQUEST_TABLE}
       SET status = 'cancelled', cancel_requested = 1, completed_at = NOW(), error_message = ?, updated_at = NOW()
       WHERE id = ? AND status IN ('queued', 'exporting', 'cancelling')`,
      ['cancelled by user', Number(current.id)]
    );

    if (result.affectedRows !== 1) {
      return res.status(409).json({
        success: false,
        error: 'Cancel conflict',
        message: 'Request status changed before cancel'
      });
    }

    const updated = await loadRequestById(req.params.id);
    res.json({
      success: true,
      data: mapTrainRunRequestRecord(updated),
      message: 'Run request cancelled'
    });
  } catch (error) {
    return sendServerError(res, '取消运行请求失败:', 'Failed to cancel train run request', error);
  }
});

module.exports = router;
