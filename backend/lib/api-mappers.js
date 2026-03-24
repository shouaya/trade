const path = require('path');
const { formatIso } = require('./route-utils');

function parseJsonContent(content) {
  if (typeof content === 'string') {
    return JSON.parse(content);
  }

  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return content;
  }

  throw new Error('content 必须是 JSON 对象或 JSON 字符串');
}

function mapTrainConfigRecord(row, options = {}) {
  const includeContent = options.includeContent === true;
  const content = typeof row.content === 'string'
    ? JSON.parse(row.content)
    : row.content;

  return {
    id: Number(row.id),
    configKey: String(row.config_key),
    configType: String(row.config_type),
    fileName: path.basename(String(row.config_key)),
    configName: row.config_name ? String(row.config_name) : null,
    symbol: row.symbol ? String(row.symbol) : null,
    intervalType: row.interval_type ? String(row.interval_type) : null,
    resultGroup: row.result_group ? String(row.result_group) : null,
    sourceTable: row.source_table ? String(row.source_table) : null,
    trainConfigRef: row.train_config_ref ? String(row.train_config_ref) : null,
    trainingYear: row.training_year ? String(row.training_year) : null,
    isGenerated: Boolean(row.is_generated),
    contentHash: String(row.content_hash),
    updatedAt: formatIso(row.updated_at),
    ...(includeContent ? { content } : {})
  };
}

function mapTrainRunRequestRecord(row) {
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

function mapKlineRow(row) {
  return {
    openTime: row.open_time.toString(),
    open: row.open.toString(),
    high: row.high.toString(),
    low: row.low.toString(),
    close: row.close.toString(),
    bidOpen: row.bid_open?.toString() ?? null,
    bidHigh: row.bid_high?.toString() ?? null,
    bidLow: row.bid_low?.toString() ?? null,
    bidClose: row.bid_close?.toString() ?? null,
    askOpen: row.ask_open?.toString() ?? null,
    askHigh: row.ask_high?.toString() ?? null,
    askLow: row.ask_low?.toString() ?? null,
    askClose: row.ask_close?.toString() ?? null,
    volume: row.volume ? row.volume.toString() : '0'
  };
}

module.exports = {
  mapKlineRow,
  mapTrainConfigRecord,
  mapTrainRunRequestRecord,
  parseJsonContent
};
