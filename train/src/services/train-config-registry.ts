import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type * as mysql from 'mysql2/promise';
import { TRAIN_CONFIGS_DDL } from '../database';

export interface RegistryConfigPayload {
  readonly name?: string;
  readonly timeRange?: {
    readonly startIso?: string;
    readonly startTimeMs?: number;
  };
  readonly market?: {
    readonly symbol?: string;
    readonly intervalType?: string;
  };
  readonly database?: {
    readonly tableName?: string;
  };
  readonly generatedAt?: string;
  readonly sourceTable?: string;
  readonly trainConfig?: string;
}

export interface SyncTrainConfigsResult {
  readonly scanned: number;
  readonly synced: number;
}

const TRAIN_CONFIGS_TABLE = 'train_configs';
const TRAIN_ROOT = path.resolve(__dirname, '..', '..');
const CONFIGS_ROOT = path.join(TRAIN_ROOT, 'configs');

function listJsonFiles(dirPath: string): readonly string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.json')) {
      files.push(fullPath);
    }
  }

  return files;
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function toTrainRelative(filePath: string): string {
  return toPosix(path.relative(TRAIN_ROOT, filePath));
}

function parseJsonFile(filePath: string): RegistryConfigPayload {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as RegistryConfigPayload;
}

function resolveTrainingYear(config: RegistryConfigPayload, configKey: string): string | null {
  const fileYear = configKey.match(/(?:^|\/)(\d{4})_/);
  if (fileYear) {
    return fileYear[1] ?? null;
  }

  if (config.timeRange?.startIso) {
    return String(new Date(config.timeRange.startIso).getUTCFullYear());
  }

  if (config.timeRange?.startTimeMs) {
    return String(new Date(config.timeRange.startTimeMs).getUTCFullYear());
  }

  return null;
}

function detectConfigType(configKey: string): string {
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
  return 'config';
}

function isGeneratedConfig(configKey: string, payload: RegistryConfigPayload): boolean {
  return configKey.includes('/generated/')
    || configKey.includes('/top-strategies/')
    || Boolean(payload.generatedAt);
}

export async function ensureTrainConfigRegistryTable(db: mysql.Pool | mysql.Connection): Promise<void> {
  await db.query(TRAIN_CONFIGS_DDL);
}

export async function upsertTrainConfigFromFile(
  db: mysql.Pool | mysql.Connection,
  filePath: string
): Promise<void> {
  const configKey = toTrainRelative(filePath);
  const payload = parseJsonFile(filePath);
  const contentRaw = fs.readFileSync(filePath, 'utf8');
  const hash = createHash('sha256').update(contentRaw).digest('hex');
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
      configKey,
      detectConfigType(configKey),
      payload.name ?? null,
      payload.market?.symbol?.toUpperCase() ?? null,
      payload.market?.intervalType ?? null,
      payload.database?.tableName ?? null,
      payload.sourceTable ?? null,
      payload.trainConfig ?? null,
      resolveTrainingYear(payload, configKey),
      isGeneratedConfig(configKey, payload) ? 1 : 0,
      hash,
      contentRaw
    ]
  );
}

export async function syncTrainConfigsFromDisk(
  db: mysql.Pool | mysql.Connection
): Promise<SyncTrainConfigsResult> {
  const files = listJsonFiles(CONFIGS_ROOT);
  let synced = 0;

  for (const filePath of files) {
    await upsertTrainConfigFromFile(db, filePath);
    synced += 1;
  }

  return {
    scanned: files.length,
    synced
  };
}
