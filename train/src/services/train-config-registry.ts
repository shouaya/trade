import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  ensureTrainConfigsSchema,
  GENERIC_CONFIG_DETAILS_TABLE,
  POLICY_CONFIG_DETAILS_TABLE,
  ROUTER_CONFIG_DETAILS_TABLE,
  SNAPSHOT_CONFIG_DETAILS_TABLE,
  TRAIN_CONFIGS_TABLE,
  TRAINING_CONFIG_DETAILS_TABLE,
  VALIDATION_CONFIG_DETAILS_TABLE
} from '@money/database';
import type * as mysql from 'mysql2/promise';
import type { FeeModelConfig } from '../types';

export interface RegistryConfigPayload {
  readonly name?: string;
  readonly symbol?: string;
  readonly routerVersion?: string;
  readonly catalogVersion?: string;
  readonly artifactType?: string;
  readonly generatedAt?: string;
  readonly generatedDate?: string;
  readonly exact?: boolean;
  readonly limit?: number;
  readonly trainId?: string;
  readonly trainingMeta?: {
    readonly trainId?: string;
    readonly trainingConfigKey?: string;
  };
  readonly trainingContext?: {
    readonly trainId?: string;
  };
  readonly timeRange?: {
    readonly startIso?: string;
    readonly endIso?: string;
    readonly startTimeMs?: number;
    readonly endTimeMs?: number;
  };
  readonly validationProfile?: string;
  readonly validationPlan?: {
    readonly profile?: string;
  };
  readonly validationTarget?: {
    readonly label?: string;
  };
  readonly regimeRouting?: {
    readonly routerConfigPath?: string;
    readonly policyCatalogPath?: string;
  };
  readonly market?: {
    readonly symbol?: string;
    readonly intervalType?: string;
  };
  readonly database?: {
    readonly tableName?: string;
  };
  readonly sourceTable?: string;
  readonly trainConfig?: string;
  readonly sourceRunId?: string;
  readonly executor?: {
    readonly options?: {
      readonly feeModel?: FeeModelConfig | Record<string, unknown> | null;
    };
  };
  readonly source?: {
    readonly routerConfigPath?: string;
    readonly trainingConfigPath?: string;
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
  readonly trainId: string | null;
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

const DETAIL_TABLES = [
  TRAINING_CONFIG_DETAILS_TABLE,
  VALIDATION_CONFIG_DETAILS_TABLE,
  SNAPSHOT_CONFIG_DETAILS_TABLE,
  ROUTER_CONFIG_DETAILS_TABLE,
  POLICY_CONFIG_DETAILS_TABLE,
  GENERIC_CONFIG_DETAILS_TABLE
] as const;

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

function toJsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asJsonSqlValue(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value ?? null);
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
  if (configKey.startsWith('configs/generated/regime-routing/') && configKey.endsWith('.policy.json')) {
    return 'policy';
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

  const trainId = String(
    payload.trainId
    || payload.trainingMeta?.trainId
    || payload.trainingContext?.trainId
    || ''
  ).trim() || null;

  return {
    configKey,
    configType,
    configName: payload.name ?? payload.catalogVersion ?? payload.routerVersion ?? null,
    symbol: payload.market?.symbol?.toUpperCase() ?? payload.symbol?.toUpperCase() ?? null,
    intervalType: payload.market?.intervalType ?? null,
    resultGroup: payload.database?.tableName ?? null,
    sourceTable: payload.sourceTable ?? null,
    trainConfigRef: payload.trainConfig ?? payload.source?.routerConfigPath ?? null,
    trainingYear: resolveTrainingYear(payload, configKey),
    trainId,
    isGenerated: isGeneratedConfig(configKey, payload),
    contentRaw,
    contentHash: createHash('sha256').update(contentRaw).digest('hex')
  };
}

function buildDetailRecord(configType: string, payload: RegistryConfigPayload, contentRaw: string): {
  readonly tableName: string;
  readonly columns: readonly string[];
  readonly values: readonly unknown[];
  readonly updates: readonly string[];
} {
  const timeRange = toJsonObject(payload.timeRange);
  const regimeRouting = toJsonObject(payload.regimeRouting);
  const validationTarget = toJsonObject(payload.validationTarget);

  if (configType === 'training') {
    return {
      tableName: TRAINING_CONFIG_DETAILS_TABLE,
      columns: [
        'start_time_ms', 'end_time_ms', 'start_iso', 'end_iso', 'validation_profile',
        'router_config_path', 'policy_catalog_path',
        'market_json', 'strategy_json', 'executor_json', 'output_json',
        'validation_plan_json', 'regime_routing_json', 'raw_json'
      ],
      values: [
        timeRange?.['startTimeMs'] ?? null,
        timeRange?.['endTimeMs'] ?? null,
        timeRange?.['startIso'] ?? null,
        timeRange?.['endIso'] ?? null,
        payload.validationPlan?.profile ?? payload.validationProfile ?? null,
        regimeRouting?.['routerConfigPath'] ?? null,
        regimeRouting?.['policyCatalogPath'] ?? null,
        asJsonSqlValue(payload.market),
        asJsonSqlValue((payload as Record<string, unknown>)['strategy']),
        asJsonSqlValue(payload.executor),
        asJsonSqlValue((payload as Record<string, unknown>)['output']),
        asJsonSqlValue(payload.validationPlan),
        asJsonSqlValue(payload.regimeRouting),
        contentRaw
      ],
      updates: [
        'start_time_ms = VALUES(start_time_ms)',
        'end_time_ms = VALUES(end_time_ms)',
        'start_iso = VALUES(start_iso)',
        'end_iso = VALUES(end_iso)',
        'validation_profile = VALUES(validation_profile)',
        'router_config_path = VALUES(router_config_path)',
        'policy_catalog_path = VALUES(policy_catalog_path)',
        'market_json = VALUES(market_json)',
        'strategy_json = VALUES(strategy_json)',
        'executor_json = VALUES(executor_json)',
        'output_json = VALUES(output_json)',
        'validation_plan_json = VALUES(validation_plan_json)',
        'regime_routing_json = VALUES(regime_routing_json)',
        'raw_json = VALUES(raw_json)'
      ]
    };
  }

  if (configType === 'validation') {
    return {
      tableName: VALIDATION_CONFIG_DETAILS_TABLE,
      columns: [
        'start_time_ms', 'end_time_ms', 'start_iso', 'end_iso', 'validation_profile', 'target_label',
        'market_json', 'strategy_json', 'executor_json', 'output_json',
        'validation_target_json', 'training_meta_json', 'raw_json'
      ],
      values: [
        timeRange?.['startTimeMs'] ?? null,
        timeRange?.['endTimeMs'] ?? null,
        timeRange?.['startIso'] ?? null,
        timeRange?.['endIso'] ?? null,
        payload.validationProfile ?? null,
        validationTarget?.['label'] ?? null,
        asJsonSqlValue(payload.market),
        asJsonSqlValue((payload as Record<string, unknown>)['strategy']),
        asJsonSqlValue(payload.executor),
        asJsonSqlValue((payload as Record<string, unknown>)['output']),
        asJsonSqlValue(payload.validationTarget),
        asJsonSqlValue(payload.trainingMeta),
        contentRaw
      ],
      updates: [
        'start_time_ms = VALUES(start_time_ms)',
        'end_time_ms = VALUES(end_time_ms)',
        'start_iso = VALUES(start_iso)',
        'end_iso = VALUES(end_iso)',
        'validation_profile = VALUES(validation_profile)',
        'target_label = VALUES(target_label)',
        'market_json = VALUES(market_json)',
        'strategy_json = VALUES(strategy_json)',
        'executor_json = VALUES(executor_json)',
        'output_json = VALUES(output_json)',
        'validation_target_json = VALUES(validation_target_json)',
        'training_meta_json = VALUES(training_meta_json)',
        'raw_json = VALUES(raw_json)'
      ]
    };
  }

  if (configType === 'top-strategies') {
    return {
      tableName: SNAPSHOT_CONFIG_DETAILS_TABLE,
      columns: [
        'artifact_type', 'generated_at', 'source_run_id', 'limit_n', 'exact_match',
        'market_json', 'executor_json', 'strategy_json', 'output_json',
        'training_context_json', 'validation_targets_json', 'strategies_json', 'raw_json'
      ],
      values: [
        payload.artifactType ?? null,
        payload.generatedAt ?? null,
        payload.sourceRunId ?? null,
        payload.limit ?? null,
        payload.exact ? 1 : 0,
        asJsonSqlValue(payload.market),
        asJsonSqlValue(payload.executor),
        asJsonSqlValue((payload as Record<string, unknown>)['strategy']),
        asJsonSqlValue((payload as Record<string, unknown>)['output']),
        asJsonSqlValue(payload.trainingContext),
        asJsonSqlValue((payload as Record<string, unknown>)['validationTargets']),
        asJsonSqlValue((payload as Record<string, unknown>)['strategies']),
        contentRaw
      ],
      updates: [
        'artifact_type = VALUES(artifact_type)',
        'generated_at = VALUES(generated_at)',
        'source_run_id = VALUES(source_run_id)',
        'limit_n = VALUES(limit_n)',
        'exact_match = VALUES(exact_match)',
        'market_json = VALUES(market_json)',
        'executor_json = VALUES(executor_json)',
        'strategy_json = VALUES(strategy_json)',
        'output_json = VALUES(output_json)',
        'training_context_json = VALUES(training_context_json)',
        'validation_targets_json = VALUES(validation_targets_json)',
        'strategies_json = VALUES(strategies_json)',
        'raw_json = VALUES(raw_json)'
      ]
    };
  }

  if (configType === 'router') {
    return {
      tableName: ROUTER_CONFIG_DETAILS_TABLE,
      columns: [
        'router_version', 'policy_catalog_path', 'execution_model_json',
        'strategy_catalog_json', 'rules_json', 'training_meta_json', 'raw_json'
      ],
      values: [
        payload.routerVersion ?? null,
        String((payload as Record<string, unknown>)['policyCatalogPath'] || '').trim() || null,
        asJsonSqlValue((payload as Record<string, unknown>)['executionModel']),
        asJsonSqlValue((payload as Record<string, unknown>)['strategyCatalog']),
        asJsonSqlValue((payload as Record<string, unknown>)['rules']),
        asJsonSqlValue(payload.trainingMeta),
        contentRaw
      ],
      updates: [
        'router_version = VALUES(router_version)',
        'policy_catalog_path = VALUES(policy_catalog_path)',
        'execution_model_json = VALUES(execution_model_json)',
        'strategy_catalog_json = VALUES(strategy_catalog_json)',
        'rules_json = VALUES(rules_json)',
        'training_meta_json = VALUES(training_meta_json)',
        'raw_json = VALUES(raw_json)'
      ]
    };
  }

  if (configType === 'policy') {
    return {
      tableName: POLICY_CONFIG_DETAILS_TABLE,
      columns: [
        'router_version', 'catalog_version', 'generated_date', 'source_json',
        'default_fallback_json', 'event_segments_json', 'daily_guards_json',
        'training_meta_json', 'raw_json'
      ],
      values: [
        payload.routerVersion ?? null,
        payload.catalogVersion ?? null,
        payload.generatedDate ?? null,
        asJsonSqlValue(payload.source),
        asJsonSqlValue((payload as Record<string, unknown>)['defaultFallback']),
        asJsonSqlValue((payload as Record<string, unknown>)['eventSegments']),
        asJsonSqlValue((payload as Record<string, unknown>)['dailyGuards']),
        asJsonSqlValue(payload.trainingMeta),
        contentRaw
      ],
      updates: [
        'router_version = VALUES(router_version)',
        'catalog_version = VALUES(catalog_version)',
        'generated_date = VALUES(generated_date)',
        'source_json = VALUES(source_json)',
        'default_fallback_json = VALUES(default_fallback_json)',
        'event_segments_json = VALUES(event_segments_json)',
        'daily_guards_json = VALUES(daily_guards_json)',
        'training_meta_json = VALUES(training_meta_json)',
        'raw_json = VALUES(raw_json)'
      ]
    };
  }

  return {
    tableName: GENERIC_CONFIG_DETAILS_TABLE,
    columns: ['raw_json'],
    values: [contentRaw],
    updates: ['raw_json = VALUES(raw_json)']
  };
}

async function deleteOtherDetailRows(
  db: mysql.Pool | mysql.Connection,
  configId: number,
  keepTableName: string
): Promise<void> {
  for (const tableName of DETAIL_TABLES) {
    if (tableName === keepTableName) {
      continue;
    }

    await db.query(`DELETE FROM ${tableName} WHERE config_id = ?`, [configId]);
  }
}

export async function upsertTrainConfig(
  db: mysql.Pool | mysql.Connection,
  configKeyInput: unknown,
  payload: RegistryConfigPayload,
  options: {
    readonly explicitType?: string | null;
    readonly parentConfigId?: number | null;
    readonly status?: string | null;
  } = {}
): Promise<TrainConfigMetadata & { readonly id: number; readonly versionNo: number; }> {
  const metadata = buildTrainConfigMetadata(
    configKeyInput,
    payload,
    options.explicitType === undefined
      ? {}
      : { explicitType: options.explicitType }
  );

  const [existingRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT id, version_no, config_type, train_id, content_hash
     FROM ${TRAIN_CONFIGS_TABLE}
     WHERE config_key = ?
       AND status = 'active'
     ORDER BY version_no DESC, id DESC
     LIMIT 1`,
    [metadata.configKey]
  );

  const existing = existingRows[0] ?? null;
  const sameAsCurrent = Boolean(
    existing
    && String(existing['content_hash'] || '') === metadata.contentHash
    && String(existing['config_type'] || '') === metadata.configType
    && String(existing['train_id'] || '') === String(metadata.trainId || '')
  );
  if (sameAsCurrent && existing) {
    return {
      ...metadata,
      id: Number(existing['id']),
      versionNo: Number(existing['version_no'] || 1)
    };
  }

  const parentConfigId = options.parentConfigId ?? (existing ? Number(existing['id']) : null);
  const versionNo = existing ? Number(existing['version_no'] || 1) + 1 : 1;

  if (existing) {
    await db.query(
      `UPDATE ${TRAIN_CONFIGS_TABLE}
       SET status = 'archived'
       WHERE config_key = ?
         AND status = 'active'`,
      [metadata.configKey]
    );
  }

  const [result] = await db.query<mysql.ResultSetHeader>(
    `INSERT INTO ${TRAIN_CONFIGS_TABLE}
      (config_key, config_type, config_name, symbol, interval_type, result_group,
       source_table, train_config_ref, training_year, train_id, parent_config_id, version_no, status, is_generated, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      metadata.trainId,
      parentConfigId,
      versionNo,
      options.status ?? 'active',
      metadata.isGenerated ? 1 : 0,
      metadata.contentHash
    ]
  );

  const configId = Number(result.insertId || existing?.['id'] || 0);
  if (!(configId > 0)) {
    throw new Error(`failed to resolve config id for ${metadata.configKey}`);
  }

  const detailRecord = buildDetailRecord(metadata.configType, payload, metadata.contentRaw);
  const detailColumns = ['config_id', ...detailRecord.columns];
  const placeholders = detailColumns.map(() => '?').join(', ');

  await db.query(
    `INSERT INTO ${detailRecord.tableName} (${detailColumns.join(', ')})
     VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${detailRecord.updates.join(', ')}`,
    [configId, ...detailRecord.values]
  );

  await deleteOtherDetailRows(db, configId, detailRecord.tableName);

  return {
    ...metadata,
    id: configId,
    versionNo
  };
}

export function buildTrainConfigDetailJoinsSql(alias = 'tc'): string {
  return [
    `LEFT JOIN ${TRAINING_CONFIG_DETAILS_TABLE} tcd_training ON tcd_training.config_id = ${alias}.id`,
    `LEFT JOIN ${VALIDATION_CONFIG_DETAILS_TABLE} tcd_validation ON tcd_validation.config_id = ${alias}.id`,
    `LEFT JOIN ${SNAPSHOT_CONFIG_DETAILS_TABLE} tcd_snapshot ON tcd_snapshot.config_id = ${alias}.id`,
    `LEFT JOIN ${ROUTER_CONFIG_DETAILS_TABLE} tcd_router ON tcd_router.config_id = ${alias}.id`,
    `LEFT JOIN ${POLICY_CONFIG_DETAILS_TABLE} tcd_policy ON tcd_policy.config_id = ${alias}.id`,
    `LEFT JOIN ${GENERIC_CONFIG_DETAILS_TABLE} tcd_generic ON tcd_generic.config_id = ${alias}.id`
  ].join('\n');
}

export function buildTrainConfigContentSelectSql(contentAlias = 'content'): string {
  return `COALESCE(
    tcd_training.raw_json,
    tcd_validation.raw_json,
    tcd_snapshot.raw_json,
    tcd_router.raw_json,
    tcd_policy.raw_json,
    tcd_generic.raw_json
  ) AS ${contentAlias}`;
}

export async function loadTrainConfigById(
  db: mysql.Pool | mysql.Connection,
  id: number | string
): Promise<mysql.RowDataPacket | null> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT tc.*, ${buildTrainConfigContentSelectSql()}
     FROM ${TRAIN_CONFIGS_TABLE} tc
     ${buildTrainConfigDetailJoinsSql('tc')}
     WHERE tc.id = ?
     LIMIT 1`,
    [id]
  );

  return rows[0] ?? null;
}

export async function loadTrainConfigByKey(
  db: mysql.Pool | mysql.Connection,
  configKey: string,
  options: {
    readonly includeArchived?: boolean;
  } = {}
): Promise<mysql.RowDataPacket | null> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT tc.*, ${buildTrainConfigContentSelectSql()}
     FROM ${TRAIN_CONFIGS_TABLE} tc
     ${buildTrainConfigDetailJoinsSql('tc')}
     WHERE tc.config_key = ?
       ${options.includeArchived ? '' : `AND tc.status = 'active'`}
     ORDER BY tc.version_no DESC, tc.id DESC
     LIMIT 1`,
    [configKey]
  );

  return rows[0] ?? null;
}

export async function ensureTrainConfigRegistryTable(db: mysql.Pool | mysql.Connection): Promise<void> {
  await ensureTrainConfigsSchema(db);
}

export async function upsertTrainConfigFromFile(
  db: mysql.Pool | mysql.Connection,
  filePath: string
): Promise<void> {
  const payload = parseJsonFile(filePath);
  await upsertTrainConfig(db, toTrainRelative(filePath), payload);
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
