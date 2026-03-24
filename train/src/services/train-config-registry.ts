import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { TRAIN_CONFIGS_TABLE, ensureTrainConfigsSchema } from '@money/database';
import type * as mysql from 'mysql2/promise';
import type { FeeModelConfig } from '../types';

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
  readonly executor?: {
    readonly options?: {
      readonly feeModel?: FeeModelConfig | Record<string, unknown> | null;
    };
  };
}

export interface TrainConfigMetadata {
  readonly configKey: string;
  readonly configType: string;
  readonly configName: string | null;
  readonly symbol: string | null;
  readonly intervalType: string | null;
  readonly resultGroup: string | null;
  readonly sourceTable: string | null;
  readonly trainConfigRef: string | null;
  readonly trainingYear: string | null;
  readonly isGenerated: boolean;
  readonly contentRaw: string;
  readonly contentHash: string;
}

export interface SyncTrainConfigsResult {
  readonly scanned: number;
  readonly synced: number;
}

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

function assertBoolean(value: unknown, fieldName: string): void {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} 必须显式设置为 true 或 false`);
  }
}

function assertFiniteNumber(value: unknown, fieldName: string, min: number | null = null): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${fieldName} 必须是有限数字`);
  }
  if (min !== null && numeric < min) {
    throw new Error(`${fieldName} 必须 >= ${min}`);
  }
  return numeric;
}

export function normalizeTrainConfigKey(value: unknown): string {
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

export function resolveTrainingYear(config: RegistryConfigPayload, configKey: string): string | null {
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

export function detectConfigType(
  configKey: string,
  payload: RegistryConfigPayload,
  explicitType?: string | null
): string {
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
  return payload.generatedAt ? 'generated' : 'config';
}

export function isGeneratedConfig(configKey: string, payload: RegistryConfigPayload): boolean {
  return configKey.includes('/generated/')
    || configKey.includes('/top-strategies/')
    || Boolean(payload.generatedAt);
}

export function validateFeeModelForRunnableConfig(configType: string, payload: RegistryConfigPayload): void {
  if (!(configType === 'training' || configType === 'validation')) {
    return;
  }

  const feeModel = payload?.executor?.options?.feeModel;
  if (!feeModel || typeof feeModel !== 'object') {
    throw new Error('executor.options.feeModel 为必填，未设置时不允许保存可运行配置');
  }

  if (!String(feeModel.venueCode || '').trim()) {
    throw new Error('executor.options.feeModel.venueCode 为必填');
  }

  if (feeModel.basis !== 'notional') {
    throw new Error('executor.options.feeModel.basis 必须显式设置为 notional');
  }

  assertFiniteNumber(feeModel.commissionRate, 'executor.options.feeModel.commissionRate', 0);
  assertBoolean(feeModel.chargeOnEntry, 'executor.options.feeModel.chargeOnEntry');
  assertBoolean(feeModel.chargeOnExit, 'executor.options.feeModel.chargeOnExit');

  if (feeModel.market === 'exchange-leverage') {
    if (!String(feeModel.productCode || '').trim()) {
      throw new Error('exchange-leverage 模式要求设置 executor.options.feeModel.productCode');
    }

    const leverageMultiplier = assertFiniteNumber(feeModel.leverageMultiplier, 'executor.options.feeModel.leverageMultiplier', 0);
    if (leverageMultiplier <= 0) {
      throw new Error('executor.options.feeModel.leverageMultiplier 必须 > 0');
    }

    assertFiniteNumber(feeModel.dailyLeverageRate, 'executor.options.feeModel.dailyLeverageRate', 0);
    assertFiniteNumber(feeModel.liquidationFeeRate, 'executor.options.feeModel.liquidationFeeRate', 0);
    if (feeModel.forcedCloseFeeRate !== undefined) {
      assertFiniteNumber(feeModel.forcedCloseFeeRate, 'executor.options.feeModel.forcedCloseFeeRate', 0);
    }

    const settlementHourJst = Number(feeModel.settlementHourJst);
    if (!Number.isInteger(settlementHourJst) || settlementHourJst < 0 || settlementHourJst > 23) {
      throw new Error('executor.options.feeModel.settlementHourJst 必须是 0-23 的整数');
    }
  }
}

export function buildTrainConfigMetadata(
  configKeyInput: unknown,
  payload: RegistryConfigPayload,
  options: {
    readonly explicitType?: string | null;
    readonly contentRaw?: string | null;
  } = {}
): TrainConfigMetadata {
  const configKey = normalizeTrainConfigKey(configKeyInput);
  const contentRaw = options.contentRaw ?? JSON.stringify(payload, null, 2);
  const configType = detectConfigType(configKey, payload, options.explicitType);

  validateFeeModelForRunnableConfig(configType, payload);

  return {
    configKey,
    configType,
    configName: payload.name ?? null,
    symbol: payload.market?.symbol?.toUpperCase() ?? null,
    intervalType: payload.market?.intervalType ?? null,
    resultGroup: payload.database?.tableName ?? null,
    sourceTable: payload.sourceTable ?? null,
    trainConfigRef: payload.trainConfig ?? null,
    trainingYear: resolveTrainingYear(payload, configKey),
    isGenerated: isGeneratedConfig(configKey, payload),
    contentRaw,
    contentHash: createHash('sha256').update(contentRaw).digest('hex')
  };
}

export async function ensureTrainConfigRegistryTable(db: mysql.Pool | mysql.Connection): Promise<void> {
  await ensureTrainConfigsSchema(db);
}

export async function upsertTrainConfigFromFile(
  db: mysql.Pool | mysql.Connection,
  filePath: string
): Promise<void> {
  const payload = parseJsonFile(filePath);
  const contentRaw = fs.readFileSync(filePath, 'utf8');
  const metadata = buildTrainConfigMetadata(toTrainRelative(filePath), payload, { contentRaw });
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
