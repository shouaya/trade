const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

const router = express.Router();

const REQUEST_TABLE = 'train_run_requests';
const CONFIG_TABLE = 'train_configs';
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TRAIN_ROOT = process.env.TRAIN_ROOT
  ? path.resolve(process.env.TRAIN_ROOT)
  : path.join(REPO_ROOT, 'train');
const TRAIN_ORCHESTRATION_SERVICE_PATH = path.join(TRAIN_ROOT, 'dist', 'services', 'train-orchestration.js');

function loadTrainOrchestrationService() {
  if (!fs.existsSync(TRAIN_ORCHESTRATION_SERVICE_PATH)) {
    throw new Error(`train orchestration service not built: ${TRAIN_ORCHESTRATION_SERVICE_PATH}`);
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(TRAIN_ORCHESTRATION_SERVICE_PATH);
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

function toRecord(row) {
  return {
    id: Number(row.id),
    requestId: String(row.request_id),
    configId: Number(row.config_id),
    configKey: String(row.config_key),
    configName: row.config_name ? String(row.config_name) : null,
    configType: String(row.config_type),
    action: String(row.action),
    status: String(row.status),
    requestedBy: row.requested_by ? String(row.requested_by) : null,
    triggerSource: row.trigger_source ? String(row.trigger_source) : null,
    commandText: row.command_text ? String(row.command_text) : null,
    exportPath: row.export_path ? String(row.export_path) : null,
    workerPid: row.worker_pid == null ? null : Number(row.worker_pid),
    executionPid: row.execution_pid == null ? null : Number(row.execution_pid),
    cancelRequested: Number(row.cancel_requested || 0) === 1,
    attemptCount: Number(row.attempt_count || 0),
    logExcerpt: row.log_excerpt ? String(row.log_excerpt) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    startedAt: formatIso(row.started_at),
    completedAt: formatIso(row.completed_at),
    createdAt: formatIso(row.created_at),
    updatedAt: formatIso(row.updated_at)
  };
}

async function ensureTablesReady() {
  const [requestRows] = await db.query('SHOW TABLES LIKE ?', [REQUEST_TABLE]);
  const [configRows] = await db.query('SHOW TABLES LIKE ?', [CONFIG_TABLE]);
  return requestRows.length > 0 && configRows.length > 0;
}

async function loadConfigById(configId) {
  const [rows] = await db.query(
    `SELECT id, config_key, config_name, config_type
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

async function insertQueuedRequest(config, action, requestedBy, triggerSource) {
  const requestId = buildRequestId();

  await db.query(
    `INSERT INTO ${REQUEST_TABLE}
      (request_id, config_id, config_key, config_name, config_type, action, status, requested_by, trigger_source)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    [
      requestId,
      Number(config.id),
      String(config.config_key),
      config.config_name ? String(config.config_name) : null,
      String(config.config_type),
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
      data: rows.map(toRecord),
      meta: {
        queueReady: true,
        count: rows.length
      }
    });
  } catch (error) {
    console.error('加载运行请求失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch train run requests',
      message: error.message
    });
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
      data: toRecord(row)
    });
  } catch (error) {
    console.error('读取运行请求失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch train run request',
      message: error.message
    });
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
      return res.status(400).json({
        success: false,
        error: 'Unsupported action',
        message: error.message
      });
    }

    const createdRow = await insertQueuedRequest(
      config,
      action,
      req.body?.requestedBy ? String(req.body.requestedBy) : 'ui',
      'ui'
    );

    res.json({
      success: true,
      data: toRecord(createdRow),
      message: 'Run request queued'
    });
  } catch (error) {
    console.error('创建运行请求失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create train run request',
      message: error.message
    });
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
      data: toRecord(createdRow),
      message: 'Run request re-queued'
    });
  } catch (error) {
    console.error('重试运行请求失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retry train run request',
      message: error.message
    });
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
        data: toRecord(updatedRunning),
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
      data: toRecord(updated),
      message: 'Run request cancelled'
    });
  } catch (error) {
    console.error('取消运行请求失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel train run request',
      message: error.message
    });
  }
});

module.exports = router;
