import {
  ANALYSIS_ARTIFACTS_TABLE,
  TRAIN_RUNS_TABLE
} from '@money/database';
import type * as mysql from 'mysql2/promise';

type JsonObject = Record<string, any>;

type Queryable = mysql.Pool | mysql.Connection | {
  readonly query: <T = unknown>(sql: string, params?: readonly unknown[]) => Promise<[T, unknown]>;
};

function normalizeString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function parseMaybeJson(value: unknown): JsonObject | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value as JsonObject;
  }

  try {
    return JSON.parse(String(value)) as JsonObject;
  } catch {
    return null;
  }
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

export async function loadLatestRollingSnapshotFromFeatureMemory(
  db: Queryable,
  input: {
    readonly trainId?: string | null;
    readonly symbol?: string | null;
  }
): Promise<JsonObject | null> {
  const trainId = normalizeString(input.trainId);
  const symbol = normalizeString(input.symbol);

  const [rows] = await queryDb<mysql.RowDataPacket[]>(
    db,
    `SELECT
       aa.payload_json AS payload_json,
       aa.updated_at AS updated_at
     FROM ${ANALYSIS_ARTIFACTS_TABLE} aa
     LEFT JOIN ${TRAIN_RUNS_TABLE} tr
       ON tr.id = aa.run_id
     WHERE aa.artifact_type = 'evaluation-report'
       AND (? IS NULL OR aa.symbol = ?)
       AND JSON_UNQUOTE(JSON_EXTRACT(aa.payload_json, '$.artifact.artifactType')) = 'rolling-strategy-package'
       AND (
         ? IS NULL
         OR JSON_UNQUOTE(JSON_EXTRACT(aa.payload_json, '$.trainId')) = ?
         OR JSON_UNQUOTE(JSON_EXTRACT(tr.notes_json, '$.trainId')) = ?
       )
     ORDER BY aa.updated_at DESC, aa.id DESC
     LIMIT 1`,
    [
      symbol,
      symbol,
      trainId,
      trainId,
      trainId
    ]
  );

  const payload = parseMaybeJson(rows[0]?.['payload_json']);
  const artifact = parseMaybeJson(payload?.['artifact']);
  if (artifact) {
    return artifact;
  }

  return payload;
}
