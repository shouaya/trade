import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import db from '../configs/database';
import { TRAIN_RUN_REQUESTS_DDL } from '../database';
import { ensureTrainConfigRegistryTable } from '../services/train-config-registry';
import type * as mysql from 'mysql2/promise';

type RunRequestStatus = 'queued' | 'exporting' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

interface QueueRow extends mysql.RowDataPacket {
  readonly id: number;
  readonly request_id: string;
  readonly config_id: number;
  readonly config_key: string;
  readonly config_name: string | null;
  readonly config_type: string;
  readonly action: string;
}

const POLL_INTERVAL_MS = Number(process.env['TRAIN_QUEUE_POLL_MS'] ?? '5000');
const TRAIN_ROOT = path.resolve(__dirname, '..', '..');
const QUEUE_TABLE = 'train_run_requests';
const TRAIN_CONFIGS_TABLE = 'train_configs';
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
  if (normalized === 'future-window' || normalized === 'rolling-window' || normalized === 'custom-range') {
    return normalized;
  }
  return 'future-window';
}

function parseConfigContent(configRow: mysql.RowDataPacket): Record<string, any> {
  const content = configRow['content'];
  if (content && typeof content === 'object') {
    return content as Record<string, any>;
  }

  if (typeof content === 'string') {
    return JSON.parse(content);
  }

  throw new Error('config content is missing');
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

function resolveTrainingYearFromPayload(configKey: string, payload: Record<string, any>): string | null {
  return getYearFromConfig(payload, path.basename(configKey));
}

async function upsertRegistryConfig(
  configKey: string,
  configType: string,
  payload: Record<string, any>
): Promise<void> {
  const contentRaw = JSON.stringify(payload, null, 2);
  const contentHash = createHash('sha256').update(contentRaw).digest('hex');
  const configName = payload['name'] ? String(payload['name']) : null;
  const market = payload['market'] as Record<string, any> | undefined;
  const database = payload['database'] as Record<string, any> | undefined;
  const symbol = market?.['symbol'] ? String(market['symbol']).toUpperCase() : null;
  const intervalType = market?.['intervalType'] ? String(market['intervalType']) : null;
  const resultGroup = database?.['tableName'] ? String(database['tableName']) : null;
  const sourceTable = payload['sourceTable'] ? String(payload['sourceTable']) : null;
  const trainConfigRef = payload['trainConfig'] ? String(payload['trainConfig']) : null;
  const trainingYear = resolveTrainingYearFromPayload(configKey, payload);

  await db.query(
    `INSERT INTO ${TRAIN_CONFIGS_TABLE}
      (config_key, config_type, config_name, symbol, interval_type, result_group,
       source_table, train_config_ref, training_year, is_generated, content_hash, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, CAST(? AS JSON))
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
      configKey,
      configType,
      configName,
      symbol,
      intervalType,
      resultGroup,
      sourceTable,
      trainConfigRef,
      trainingYear,
      contentHash,
      contentRaw
    ]
  );
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

function createRuntimeExportPath(requestId: string, configRow: mysql.RowDataPacket): string {
  const runtimeDir = path.join(RUNTIME_CONFIG_ROOT, requestId);
  const fileName = path.basename(String(configRow['config_key'] || 'config.json'));
  fs.mkdirSync(runtimeDir, { recursive: true });
  return path.join(runtimeDir, fileName);
}

function resolveCommand(
  action: string,
  configRow: mysql.RowDataPacket,
  exportPath: string
): { command: string; args: readonly string[] } {
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
        'scripts/generate-top3-validation-configs.js',
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

  throw new Error(`unsupported action: ${action}`);
}

async function ensureQueueTable(): Promise<void> {
  await db.query(TRAIN_RUN_REQUESTS_DDL);
  await db.query(`ALTER TABLE ${QUEUE_TABLE} ADD COLUMN execution_pid INT NULL AFTER worker_pid`).catch(() => {});
  await db.query(`ALTER TABLE ${QUEUE_TABLE} ADD COLUMN cancel_requested TINYINT(1) NOT NULL DEFAULT 0 AFTER execution_pid`).catch(() => {});
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
    `SELECT *
     FROM ${TRAIN_CONFIGS_TABLE}
     WHERE id = ?
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

async function enqueueFollowUpGenerateValidation(request: QueueRow, configRow: mysql.RowDataPacket): Promise<boolean> {
  const [existingRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT id
     FROM ${QUEUE_TABLE}
     WHERE config_id = ?
       AND action = 'generate-validation'
       AND status IN ('queued', 'exporting', 'running', 'cancelling')
     LIMIT 1`,
    [Number(request.config_id)]
  );

  if (existingRows.length > 0) {
    return false;
  }

  await db.query(
    `INSERT INTO ${QUEUE_TABLE}
      (request_id, config_id, config_key, config_name, config_type, action, status, requested_by, trigger_source)
     VALUES (?, ?, ?, ?, ?, 'generate-validation', 'queued', ?, ?)`,
    [
      buildRequestId(),
      Number(request.config_id),
      String(configRow['config_key']),
      configRow['config_name'] ? String(configRow['config_name']) : null,
      String(configRow['config_type'] || request.config_type),
      'worker',
      'post-train'
    ]
  );

  return true;
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
  const content = typeof configRow['content'] === 'string'
    ? String(configRow['content'])
    : JSON.stringify(configRow['content'], null, 2);
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

  const { command, args } = resolveCommand(request.action, configRow, exportPath);
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
        const enqueued = await enqueueFollowUpGenerateValidation(request, configRow);
        if (enqueued) {
          console.log(`🧩 queued follow-up generate-validation for ${request.config_key}`);
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
