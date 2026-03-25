import * as fs from 'fs';
import * as path from 'path';
import {
  TRAIN_CONFIGS_TABLE
} from '@money/database';
import type * as mysql from 'mysql2/promise';
import {
  buildTrainConfigContentSelectSql,
  buildTrainConfigDetailJoinsSql
} from './train-config-registry';
import {
  resolveRelativeConfigRef
} from './router-artifact-builder';

type JsonObject = Record<string, any>;

type Queryable = mysql.Pool | mysql.Connection | {
  readonly query: <T = unknown>(sql: string, params?: readonly unknown[]) => Promise<[T, unknown]>;
};

const TRAIN_ROOT = path.resolve(__dirname, '..', '..');

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function isConfigKey(value: string): boolean {
  return value.startsWith('configs/') && value.endsWith('.json');
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

async function queryDb<T = unknown>(
  db: Queryable,
  sql: string,
  params: readonly unknown[] = []
): Promise<[T, unknown]> {
  const query = (db as {
    readonly query: (statement: string, values?: readonly unknown[]) => Promise<[T, unknown]>;
  }).query;
  return query.call(db, sql, params);
}

export function resolveTrainConfigPath(configPathOrKey: string): string {
  if (path.isAbsolute(configPathOrKey)) {
    return configPathOrKey;
  }
  return path.resolve(TRAIN_ROOT, configPathOrKey);
}

export async function loadTrainConfigContentByKey<T = JsonObject>(
  db: Queryable,
  configKeyInput: string
): Promise<T | null> {
  const configKey = toPosix(String(configKeyInput || '').trim());
  if (!isConfigKey(configKey)) {
    return null;
  }

  const [rows] = await queryDb<mysql.RowDataPacket[]>(
    db,
    `SELECT tc.*, ${buildTrainConfigContentSelectSql()}
     FROM ${TRAIN_CONFIGS_TABLE} tc
     ${buildTrainConfigDetailJoinsSql('tc')}
     WHERE tc.config_key = ?
       AND tc.status = 'active'
     ORDER BY tc.version_no DESC, tc.updated_at DESC, tc.id DESC
     LIMIT 1`,
    [configKey]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  const content = row['content'];
  if (!content) {
    return null;
  }

  return (typeof content === 'string'
    ? JSON.parse(content)
    : content) as T;
}

export async function loadConfigContentFromFileOrDb<T = JsonObject>(
  db: Queryable,
  configPathOrKey: string
): Promise<{
  readonly content: T;
  readonly absolutePath: string | null;
  readonly configKey: string | null;
}> {
  const absolutePath = resolveTrainConfigPath(configPathOrKey);
  if (fs.existsSync(absolutePath)) {
    return {
      content: readJson<T>(absolutePath),
      absolutePath,
      configKey: isConfigKey(toPosix(String(configPathOrKey).trim()))
        ? toPosix(String(configPathOrKey).trim())
        : null
    };
  }

  const configKey = isConfigKey(toPosix(String(configPathOrKey).trim()))
    ? toPosix(String(configPathOrKey).trim())
    : null;
  if (!configKey) {
    throw new Error(`config file not found: ${absolutePath}`);
  }

  const content = await loadTrainConfigContentByKey<T>(db, configKey);
  if (!content) {
    throw new Error(`config not found in db: ${configKey}`);
  }

  return {
    content,
    absolutePath: null,
    configKey
  };
}

export async function loadConfigContentByRelativeRef<T = JsonObject>(
  db: Queryable,
  baseConfigKey: string,
  relativeRef: string
): Promise<T | null> {
  const normalizedRef = String(relativeRef || '').trim();
  if (!normalizedRef) {
    return null;
  }
  const targetConfigKey = resolveRelativeConfigRef(baseConfigKey, normalizedRef);
  return loadTrainConfigContentByKey<T>(db, targetConfigKey);
}
