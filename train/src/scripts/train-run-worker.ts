import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import {
  TRAIN_CONFIGS_TABLE,
  TRAIN_RUN_REQUESTS_TABLE,
  ensureTrainRunRequestsSchema
} from '@money/database';
import db from '../configs/database';
import {
  buildTrainConfigContentSelectSql,
  buildTrainConfigDetailJoinsSql,
  ensureTrainConfigRegistryTable,
  loadTrainConfigByKey,
  upsertTrainConfig
} from '../services/train-config-registry';
import type * as mysql from 'mysql2/promise';

type RunRequestStatus = 'queued' | 'exporting' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

interface QueueRow extends mysql.RowDataPacket {
  readonly id: number;
  readonly request_id: string;
  readonly config_id: number;
  readonly config_key: string;
  readonly config_name: string | null;
  readonly config_type: string;
  readonly train_id: string | null;
  readonly action: string;
}

const POLL_INTERVAL_MS = Number(process.env['TRAIN_QUEUE_POLL_MS'] ?? '5000');
const TRAIN_ROOT = path.resolve(__dirname, '..', '..');
const QUEUE_TABLE = TRAIN_RUN_REQUESTS_TABLE;
const MAX_LOG_CHARS = 50000;
const CANCEL_CHECK_INTERVAL_MS = 1000;
const CANCEL_GRACE_MS = 5000;
const RUNTIME_CONFIG_ROOT = path.join(os.tmpdir(), 'money-train-runtime');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendLog(previous: string, chunk: string): string {
  const merged = `${previous}${chunk}`;
  return merged.length > MAX_LOG_CHARS ? merged.slice(-MAX_LOG_CHARS) : merged;
}

function getYearFromConfig(config: Record<string, any>, fallbackName: string): string | null {
  const baseYear = String(fallbackName || '').match(/^(\d{4})_/);
  if (baseYear) {
    return baseYear[1] ?? null;
  }

  const timeRange = config['timeRange'] as Record<string, any> | undefined;
  const startIso = timeRange?.['startIso'];
  if (startIso) {
    return String(new Date(startIso).getUTCFullYear());
  }

  const startMs = timeRange?.['startTimeMs'];
  if (startMs) {
    return String(new Date(Number(startMs)).getUTCFullYear());
  }

  return null;
}

function deriveValidationPrefix(trainingName: string, symbol: string, topN: number): string {
  const symbolLower = String(symbol || 'asset').toLowerCase();
  const trainingYear = getYearFromConfig({}, trainingName) || 'run';
  return `${trainingYear}_${symbolLower}_top${topN}`;
}

function normalizeValidationProfile(profile: unknown): string {
  const normalized = String(profile || '').trim().toLowerCase();
  if (normalized === 'rolling-window' || normalized === 'custom-range') {
    return normalized;
  }
  return 'rolling-window';
}

function parseConfigContent(configRow: mysql.RowDataPacket): Record<string, any> {
  const content = configRow['content'];
  const trainId = String(configRow['train_id'] || '').trim();

  if (content && typeof content === 'object') {
    return applyTrainIdToConfig(content as Record<string, any>, trainId);
  }

  if (typeof content === 'string') {
    return applyTrainIdToConfig(JSON.parse(content), trainId);
  }

  throw new Error('config content is missing');
}

function applyTrainIdToConfig(config: Record<string, any>, trainId: string): Record<string, any> {
  if (!trainId) {
    return config;
  }

  return {
    ...config,
    trainId,
    trainingMeta: {
      ...(config['trainingMeta'] && typeof config['trainingMeta'] === 'object'
        ? config['trainingMeta'] as Record<string, any>
        : {}),
      trainId
    }
  };
}

function toPosix(value: string): string {
  return String(value || '').replace(/\\/g, '/');
}

function resolveConfigRef(baseConfigKey: string, targetRef: string): string {
  const normalizedRef = String(targetRef || '').trim();
  if (!normalizedRef) {
    return '';
  }

  if (path.posix.isAbsolute(normalizedRef)) {
    return toPosix(path.posix.normalize(normalizedRef));
  }

  return toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(String(baseConfigKey || '')), normalizedRef)));
}

async function loadConfigRecordByKey(configKey: string): Promise<mysql.RowDataPacket | null> {
  return await loadTrainConfigByKey(db, configKey);
}

function resolveTimeArg(timeRange: Record<string, any> | undefined, kind: 'start' | 'end'): string {
  const isoKey = kind === 'start' ? 'startIso' : 'endIso';
  const msKey = kind === 'start' ? 'startTimeMs' : 'endTimeMs';

  if (timeRange?.[isoKey]) {
    return String(timeRange[isoKey]);
  }

  if (timeRange?.[msKey] != null) {
    return String(timeRange[msKey]);
  }

  throw new Error(`timeRange.${isoKey} is missing`);
}

async function resolveLinkedTrainingConfigRow(configRow: mysql.RowDataPacket): Promise<mysql.RowDataPacket | null> {
  const configType = String(configRow['config_type'] || '');
  if (configType === 'training') {
    return configRow;
  }

  const config = parseConfigContent(configRow);
  const linkedConfigKey = String(config['trainConfig'] || configRow['train_config_ref'] || '').trim();
  if (!linkedConfigKey) {
    return null;
  }

  return await loadConfigRecordByKey(linkedConfigKey);
}

async function resolveRouterConfigPath(configRow: mysql.RowDataPacket): Promise<string> {
  const linkedTrainingRow = await resolveLinkedTrainingConfigRow(configRow);
  if (!linkedTrainingRow) {
    throw new Error('linked training config is missing for router validation');
  }

  const trainingConfig = parseConfigContent(linkedTrainingRow);
  const regimeRouting = trainingConfig['regimeRouting'] as Record<string, any> | undefined;
  const routerConfigPath = String(regimeRouting?.['routerConfigPath'] || '').trim();
  if (!routerConfigPath) {
    throw new Error('regimeRouting.routerConfigPath is missing');
  }

  const trainingConfigKey = String(linkedTrainingRow['config_key'] || '').trim();
  if (!trainingConfigKey) {
    throw new Error('linked training config key is missing for router validation');
  }

  return resolveConfigRef(trainingConfigKey, routerConfigPath);
}

function safeUnlink(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn(`failed to remove file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function safeRmdir(dirPath: string): void {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn(`failed to remove dir ${dirPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function upsertRegistryConfig(
  configKey: string,
  configType: string,
  payload: Record<string, any>
): Promise<void> {
  await upsertTrainConfig(db, configKey, payload, {
    explicitType: configType
  });
}

async function persistGeneratedArtifacts(stdoutText: string): Promise<void> {
  const parsed = JSON.parse(stdoutText) as {
    readonly validationConfigs?: readonly { readonly configKey: string; readonly configType: string; readonly content: Record<string, any>; }[];
    readonly snapshot?: { readonly configKey: string; readonly configType: string; readonly content: Record<string, any>; };
  };

  const items = [
    ...(parsed.validationConfigs || []),
    ...(parsed.snapshot ? [parsed.snapshot] : [])
  ];

  for (const item of items) {
    await upsertRegistryConfig(item.configKey, item.configType, item.content);
    safeUnlink(path.resolve(TRAIN_ROOT, item.configKey));
  }
}

function parseGeneratedArtifacts(stdoutText: string): {
  readonly validationConfigs: readonly { readonly configKey: string; readonly configType: string; readonly content: Record<string, any>; }[];
  readonly snapshot: { readonly configKey: string; readonly configType: string; readonly content: Record<string, any>; } | null;
} {
  const parsed = JSON.parse(stdoutText) as {
    readonly validationConfigs?: readonly { readonly configKey: string; readonly configType: string; readonly content: Record<string, any>; }[];
    readonly snapshot?: { readonly configKey: string; readonly configType: string; readonly content: Record<string, any>; };
  };

  return {
    validationConfigs: parsed.validationConfigs || [],
    snapshot: parsed.snapshot || null
  };
}

function createRuntimeExportPath(requestId: string, configRow: mysql.RowDataPacket): string {
  const runtimeDir = path.join(RUNTIME_CONFIG_ROOT, requestId);
  const fileName = path.basename(String(configRow['config_key'] || 'config.json'));
  fs.mkdirSync(runtimeDir, { recursive: true });
  return path.join(runtimeDir, fileName);
}

async function resolveCommand(
  action: string,
  configRow: mysql.RowDataPacket,
  exportPath: string
): Promise<{ command: string; args: readonly string[] }> {
  const configKey = String(configRow['config_key']);
  if (action === 'train' || action === 'validate') {
    return {
      command: 'node',
      args: ['dist/scripts/train.js', exportPath]
    };
  }

  if (action === 'generate-validation') {
    const config = parseConfigContent(configRow);
    const fileName = path.basename(configKey);
    const trainingYear = getYearFromConfig(config, fileName);
    const market = config['market'] as Record<string, any> | undefined;
    const database = config['database'] as Record<string, any> | undefined;
    const output = config['output'] as Record<string, any> | undefined;
    const validationPlan = config['validationPlan'] as Record<string, any> | undefined;
    const symbol = String(market?.['symbol'] || 'UNKNOWN').toUpperCase();
    const sourceTable = String(database?.['tableName'] || '').trim();
    const topN = Number(output?.['topN'] || 10);
    const validationProfile = normalizeValidationProfile(validationPlan?.['profile']);

    if (!trainingYear) {
      throw new Error('training year is missing');
    }

    if (!sourceTable) {
      throw new Error('sourceTable/result_group is missing');
    }

    return {
      command: 'node',
      args: [
        'dist/scripts/generate-validation-artifacts.js',
        `--trainConfig=${exportPath}`,
        `--trainConfigRef=${configKey}`,
        `--symbol=${symbol}`,
        `--sourceTable=${sourceTable}`,
        `--outPrefix=${deriveValidationPrefix(fileName, symbol, topN)}`,
        `--strategyPrefix=${trainingYear}-${symbol}-VAL-`,
        `--descriptionPrefix=${trainingYear} ${symbol} validation`,
        `--limit=${topN}`,
        `--profile=${validationProfile}`,
        '--exact=true',
        '--outputMode=json'
      ]
    };
  }

  if (action === 'build-router') {
    return {
      command: 'node',
      args: [
        'dist/scripts/build-router-artifacts.js',
        '--trainConfig',
        exportPath,
        '--trainConfigRef',
        configKey
      ]
    };
  }

  if (action === 'feature-causality') {
    const config = parseConfigContent(configRow);
    const market = config['market'] as Record<string, any> | undefined;
    const timeRange = config['timeRange'] as Record<string, any> | undefined;
    const featureEngineering = config['featureEngineering'] as Record<string, any> | undefined;
    const symbol = String(market?.['symbol'] || '').trim().toUpperCase();
    const intervalType = String(market?.['intervalType'] || '1min').trim();
    const trainId = String(configRow['train_id'] || config['trainId'] || '').trim();
    const openingMinutes = Math.max(1, Number(featureEngineering?.['openingWindowMinutes'] || 60));

    if (!symbol) {
      throw new Error('market.symbol is missing');
    }

    return {
      command: 'node',
      args: [
        'dist/scripts/feature-causality-audit.js',
        '--symbol',
        symbol,
        '--intervalType',
        intervalType,
        '--start',
        resolveTimeArg(timeRange, 'start'),
        '--end',
        resolveTimeArg(timeRange, 'end'),
        '--openingMinutes',
        String(openingMinutes),
        ...(trainId ? ['--trainId', trainId] : [])
      ]
    };
  }

  if (action === 'cost-sensitivity') {
    return {
      command: 'node',
      args: [
        'dist/scripts/cost-sensitivity-report.js',
        '--config',
        exportPath
      ]
    };
  }

  if (action === 'router-validate') {
    return {
      command: 'node',
      args: [
        'dist/scripts/router-validate.js',
        '--validation',
        exportPath,
        '--router',
        await resolveRouterConfigPath(configRow)
      ]
    };
  }

  if (action === 'goal-tracking') {
    return {
      command: 'node',
      args: [
        'dist/scripts/goal-attainment-report.js',
        '--trainConfig',
        exportPath,
        '--trainConfigRef',
        String(configRow['config_key'] || '')
      ]
    };
  }

  throw new Error(`unsupported action: ${action}`);
}

async function ensureQueueTable(): Promise<void> {
  await ensureTrainRunRequestsSchema(db);
}

async function claimNextRequest(): Promise<QueueRow | null> {
  const [rows] = await db.query<QueueRow[]>(
    `SELECT *
     FROM ${QUEUE_TABLE}
     WHERE status = 'queued'
     ORDER BY created_at ASC, id ASC
     LIMIT 1`
  );

  const next = rows[0];
  if (!next) {
    return null;
  }

  const [result] = await db.query<mysql.ResultSetHeader>(
    `UPDATE ${QUEUE_TABLE}
     SET status = 'exporting', worker_pid = ?, execution_pid = NULL, cancel_requested = 0, attempt_count = attempt_count + 1, started_at = NOW(), error_message = NULL
     WHERE id = ? AND status = 'queued'`,
    [process.pid, next.id]
  );

  return result.affectedRows === 1 ? next : null;
}

function buildRequestId(): string {
  return `runreq-${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString('hex')}`;
}

async function loadConfigRecord(configId: number): Promise<mysql.RowDataPacket | null> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT tc.*, ${buildTrainConfigContentSelectSql()}
     FROM ${TRAIN_CONFIGS_TABLE} tc
     ${buildTrainConfigDetailJoinsSql('tc')}
     WHERE tc.id = ?
     LIMIT 1`,
    [configId]
  );

  return rows[0] ?? null;
}

async function loadRequestRecord(id: number): Promise<mysql.RowDataPacket | null> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT *
     FROM ${QUEUE_TABLE}
     WHERE id = ?
     LIMIT 1`,
    [id]
  );

  return rows[0] ?? null;
}

async function hasActiveRequestForAction(configId: number, action: string): Promise<boolean> {
  const [existingRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT id
     FROM ${QUEUE_TABLE}
     WHERE config_id = ?
       AND action = ?
       AND status IN ('queued', 'exporting', 'running', 'cancelling')
     LIMIT 1`,
    [configId, action]
  );

  return existingRows.length > 0;
}

async function enqueueRequestForConfigRow(
  configRow: mysql.RowDataPacket,
  action: string,
  triggerSource: string
): Promise<boolean> {
  const configId = Number(configRow['id']);
  if (!Number.isInteger(configId) || configId <= 0) {
    return false;
  }

  if (await hasActiveRequestForAction(configId, action)) {
    return false;
  }

  await db.query(
    `INSERT INTO ${QUEUE_TABLE}
      (request_id, config_id, config_key, config_name, config_type, train_id, action, status, requested_by, trigger_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    [
      buildRequestId(),
      configId,
      String(configRow['config_key']),
      configRow['config_name'] ? String(configRow['config_name']) : null,
      String(configRow['config_type'] || ''),
      configRow['train_id'] ? String(configRow['train_id']) : null,
      action,
      'worker',
      triggerSource
    ]
  );

  return true;
}

async function enqueueGeneratedValidationRuns(stdoutText: string): Promise<void> {
  const generatedArtifacts = parseGeneratedArtifacts(stdoutText);
  for (const item of generatedArtifacts.validationConfigs) {
    const configRow = await loadConfigRecordByKey(item.configKey);
    if (!configRow) {
      continue;
    }

    const enqueued = await enqueueRequestForConfigRow(configRow, 'validate', 'post-generate-validation');
    if (enqueued) {
      console.log(`🧪 queued auto validation for ${item.configKey}`);
    }
  }
}

async function enqueueBuildRouterForConfigRow(configRow: mysql.RowDataPacket): Promise<void> {
  const enqueued = await enqueueRequestForConfigRow(configRow, 'build-router', 'post-generate-validation');
  if (enqueued) {
    console.log(`🧭 queued rolling router maintenance for ${configRow['config_key']}`);
  }
}

function hasRouterConfigPath(trainingRow: mysql.RowDataPacket | null): boolean {
  if (!trainingRow) {
    return false;
  }

  const trainingConfig = parseConfigContent(trainingRow);
  const regimeRouting = trainingConfig['regimeRouting'] as Record<string, any> | undefined;
  return String(regimeRouting?.['routerConfigPath'] || '').trim().length > 0;
}

async function enqueuePostTrainFollowUps(configRow: mysql.RowDataPacket): Promise<void> {
  const followUps = [
    { action: 'generate-validation', triggerSource: 'post-train' },
    { action: 'feature-causality', triggerSource: 'post-train' }
  ];

  for (const item of followUps) {
    const enqueued = await enqueueRequestForConfigRow(configRow, item.action, item.triggerSource);
    if (enqueued) {
      console.log(`🧩 queued follow-up ${item.action} for ${configRow['config_key']}`);
    }
  }
}

async function enqueuePostValidationFollowUps(configRow: mysql.RowDataPacket): Promise<void> {
  const linkedTrainingRow = await resolveLinkedTrainingConfigRow(configRow);
  const followUps = ['cost-sensitivity'];
  if (hasRouterConfigPath(linkedTrainingRow)) {
    followUps.push('router-validate');
  }

  for (const action of followUps) {
    const enqueued = await enqueueRequestForConfigRow(configRow, action, 'post-validation');
    if (enqueued) {
      console.log(`📊 queued follow-up ${action} for ${configRow['config_key']}`);
    }
  }

  if (linkedTrainingRow) {
    const enqueued = await enqueueRequestForConfigRow(linkedTrainingRow, 'goal-tracking', 'post-validation');
    if (enqueued) {
      console.log(`🎯 queued follow-up goal-tracking for ${linkedTrainingRow['config_key']}`);
    }
  }
}

async function updateRequestStatus(
  id: number,
  status: RunRequestStatus,
  fields: Record<string, unknown> = {}
): Promise<void> {
  const assignments = ['status = ?'];
  const values: unknown[] = [status];

  for (const [key, value] of Object.entries(fields)) {
    assignments.push(`${key} = ?`);
    values.push(value);
  }

  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    assignments.push('completed_at = NOW()');
  }

  values.push(id);

  await db.query(
    `UPDATE ${QUEUE_TABLE}
     SET ${assignments.join(', ')}
     WHERE id = ?`,
    values
  );
}

async function exportConfigToRuntimeFile(request: QueueRow, configRow: mysql.RowDataPacket): Promise<string> {
  const contentObject = parseConfigContent({
    ...configRow,
    train_id: configRow['train_id'] || request.train_id || null
  } as mysql.RowDataPacket);
  const content = JSON.stringify(contentObject, null, 2);
  const fullPath = createRuntimeExportPath(request.request_id, configRow);
  fs.writeFileSync(fullPath, `${content.trimEnd()}\n`, 'utf8');
  return fullPath;
}

async function terminateChildGracefully(child: ChildProcess, logs: string): Promise<string> {
  let nextLogs = appendLog(logs, '\n[user-cancel] SIGTERM requested\n');
  child.kill('SIGTERM');

  await sleep(CANCEL_GRACE_MS);

  if (child.exitCode === null && !child.killed) {
    nextLogs = appendLog(nextLogs, '[user-cancel] SIGKILL requested\n');
    child.kill('SIGKILL');
  }

  return nextLogs;
}

async function runChildProcess(
  requestId: number,
  command: string,
  args: readonly string[]
): Promise<{ code: number | null; logs: string; cancelled: boolean; stdoutText: string; }> {
  return await new Promise((resolve, reject) => {
    let logs = '';
    let stdoutText = '';
    let cancelRequested = false;
    let cancelPoll = null;
    const child = spawn(command, args, {
      cwd: TRAIN_ROOT,
      env: {
        ...process.env,
        TRAIN_SKIP_CONFIG_REGISTRY_UPSERT: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    void db.query(
      `UPDATE ${QUEUE_TABLE}
       SET execution_pid = ?
       WHERE id = ?`,
      [child.pid ?? null, requestId]
    );

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdoutText += text;
      process.stdout.write(text);
      logs = appendLog(logs, text);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      process.stderr.write(text);
      logs = appendLog(logs, text);
    });

    child.on('error', (error) => reject(error));

    cancelPoll = setInterval(async () => {
      try {
        const row = await loadRequestRecord(requestId);
        if (!row) {
          return;
        }

        const requested = Number(row['cancel_requested'] ?? 0) === 1 || String(row['status'] ?? '') === 'cancelling';
        if (requested && !cancelRequested) {
          cancelRequested = true;
          logs = await terminateChildGracefully(child, logs);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logs = appendLog(logs, `\n[cancel-poll-error] ${message}\n`);
      }
    }, CANCEL_CHECK_INTERVAL_MS);

    child.on('close', (code) => {
      if (cancelPoll) {
        clearInterval(cancelPoll);
      }
      resolve({ code, logs: logs, cancelled: cancelRequested, stdoutText } as { code: number | null; logs: string; cancelled: boolean; stdoutText: string; });
    });
  });
}

async function processRequest(request: QueueRow): Promise<void> {
  const configRow = await loadConfigRecord(request.config_id);
  if (!configRow) {
    await updateRequestStatus(request.id, 'failed', {
      error_message: 'config record not found',
      log_excerpt: 'config record not found'
    });
    return;
  }

  const configType = String(configRow['config_type'] || request.config_type);
  if (!(configType === 'training' || configType === 'validation')) {
    await updateRequestStatus(request.id, 'failed', {
      error_message: `config type ${configType} is not runnable`,
      log_excerpt: `config type ${configType} is not runnable`
    });
    return;
  }

  const exportPath = await exportConfigToRuntimeFile(request, configRow);
  const freshRequest = await loadRequestRecord(request.id);
  if (freshRequest && String(freshRequest['status']) === 'cancelled') {
    safeRmdir(path.dirname(exportPath));
    return;
  }

  const { command, args } = await resolveCommand(request.action, configRow, exportPath);
  const commandText = `${command} ${args.join(' ')}`;

  await updateRequestStatus(request.id, 'running', {
    export_path: exportPath,
    command_text: commandText,
    execution_pid: null
  });

  try {
    const result = await runChildProcess(request.id, command, args);
    if (result.cancelled) {
      await updateRequestStatus(request.id, 'cancelled', {
        log_excerpt: result.logs,
        error_message: 'cancelled by user',
        execution_pid: null
      });
      return;
    }

    if (result.code === 0) {
      if (request.action === 'generate-validation') {
        await persistGeneratedArtifacts(result.stdoutText);
      }
      await updateRequestStatus(request.id, 'completed', {
        log_excerpt: result.logs,
        execution_pid: null
      });
      if (request.action === 'train') {
        await enqueuePostTrainFollowUps(configRow);
      }
      if (request.action === 'generate-validation') {
        await enqueueBuildRouterForConfigRow(configRow);
        await enqueueGeneratedValidationRuns(result.stdoutText);
      }
      if (request.action === 'validate') {
        await enqueuePostValidationFollowUps(configRow);
      }
      if (request.action === 'router-validate' || request.action === 'build-router') {
        const linkedTrainingRow = await resolveLinkedTrainingConfigRow(configRow);
        if (linkedTrainingRow) {
          await enqueueRequestForConfigRow(linkedTrainingRow, 'goal-tracking', `post-${request.action}`);
        }
      }
      return;
    }

    await updateRequestStatus(request.id, 'failed', {
      error_message: `command exited with code ${String(result.code)}`,
      log_excerpt: result.logs,
      execution_pid: null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateRequestStatus(request.id, 'failed', {
      error_message: message,
      log_excerpt: message,
      execution_pid: null
    });
  } finally {
    safeRmdir(path.dirname(exportPath));
  }
}

async function main(): Promise<void> {
  console.log('🚦 train run worker starting...');
  console.log(`📁 train root: ${TRAIN_ROOT}`);
  console.log(`⏱️  poll interval: ${POLL_INTERVAL_MS} ms`);

  await ensureTrainConfigRegistryTable(db);
  await ensureQueueTable();

  while (true) {
    try {
      const request = await claimNextRequest();
      if (!request) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      console.log(`▶️  processing request ${request.request_id} (${request.action} ${request.config_key})`);
      await processRequest(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('❌ worker loop error:', message);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ train run worker failed:', message);
    await db.end();
    process.exit(1);
  });
}

export { main };
