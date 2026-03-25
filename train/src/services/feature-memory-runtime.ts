import {
  FEATURE_CANDIDATE_POOLS_TABLE,
  FEATURE_CANDIDATE_POOL_ITEMS_TABLE,
  FEATURE_MEMORIES_TABLE,
  MARKET_WINDOWS_TABLE,
  STRATEGY_DEFINITIONS_TABLE,
  STRATEGY_PARAMETER_SETS_TABLE,
  TRAIN_RUNS_TABLE,
  WINDOW_BEST_ACTIONS_TABLE
} from '@money/database';
import type * as mysql from 'mysql2/promise';

type Queryable = mysql.Pool | mysql.Connection | {
  readonly query: <T = unknown>(sql: string, params?: readonly unknown[]) => Promise<[T, unknown]>;
};

function normalizeString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
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

export async function loadMonthlyCandidatePoolsFromFeatureMemory(
  db: Queryable,
  input: {
    readonly symbol: string;
    readonly trainId?: string | null;
  }
): Promise<ReadonlyMap<string, readonly string[]>> {
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const trainId = normalizeString(input.trainId);

  const [rows] = await queryDb<mysql.RowDataPacket[]>(
    db,
    `SELECT
       mw.window_key AS window_key,
       mw.window_start_ms AS window_start_ms,
       fcpi.rank_no AS rank_no,
       sd.strategy_key AS strategy_name
     FROM ${FEATURE_CANDIDATE_POOLS_TABLE} fcp
     INNER JOIN ${FEATURE_MEMORIES_TABLE} fm
       ON fm.id = fcp.feature_memory_id
     INNER JOIN ${MARKET_WINDOWS_TABLE} mw
       ON mw.id = fm.window_id
     INNER JOIN ${TRAIN_RUNS_TABLE} tr
       ON tr.id = fcp.run_id
     INNER JOIN ${FEATURE_CANDIDATE_POOL_ITEMS_TABLE} fcpi
       ON fcpi.feature_candidate_pool_id = fcp.id
     INNER JOIN ${STRATEGY_PARAMETER_SETS_TABLE} sps
       ON sps.id = fcpi.strategy_parameter_set_id
     INNER JOIN ${STRATEGY_DEFINITIONS_TABLE} sd
       ON sd.id = sps.strategy_definition_id
     WHERE fcp.symbol = ?
       AND mw.window_type = 'monthly'
       AND (
         ? IS NULL
         OR JSON_UNQUOTE(JSON_EXTRACT(tr.notes_json, '$.trainId')) = ?
       )
     ORDER BY mw.window_start_ms ASC, fcpi.rank_no ASC`,
    [
      symbol,
      trainId,
      trainId
    ]
  );

  const monthMap = new Map<string, string[]>();
  for (const row of rows) {
    const startMs = Number(row['window_start_ms']);
    const month = Number.isFinite(startMs)
      ? new Date(startMs).toISOString().slice(0, 7)
      : String(row['window_key'] || '').split(':').at(-1) || '';
    if (!month) {
      continue;
    }
    const strategyName = String(row['strategy_name'] || '').trim();
    if (!strategyName) {
      continue;
    }
    const bucket = monthMap.get(month) ?? [];
    bucket.push(strategyName);
    monthMap.set(month, bucket);
  }

  return monthMap;
}

export async function loadMonthlyBestActionMapFromFeatureMemory(
  db: Queryable,
  input: {
    readonly symbol: string;
    readonly trainId?: string | null;
  }
): Promise<ReadonlyMap<string, {
  readonly actionType: string;
  readonly riskMultiplier: number;
}>> {
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const trainId = normalizeString(input.trainId);

  const [rows] = await queryDb<mysql.RowDataPacket[]>(
    db,
    `SELECT
       mw.window_start_ms AS window_start_ms,
       wba.action_type AS action_type,
       wba.risk_multiplier AS risk_multiplier
     FROM ${WINDOW_BEST_ACTIONS_TABLE} wba
     INNER JOIN ${MARKET_WINDOWS_TABLE} mw
       ON mw.id = wba.window_id
     INNER JOIN ${TRAIN_RUNS_TABLE} tr
       ON tr.id = wba.run_id
     WHERE mw.symbol = ?
       AND mw.window_type = 'monthly'
       AND (
         ? IS NULL
         OR JSON_UNQUOTE(JSON_EXTRACT(tr.notes_json, '$.trainId')) = ?
       )
     ORDER BY mw.window_start_ms ASC, wba.id ASC`,
    [
      symbol,
      trainId,
      trainId
    ]
  );

  const actionMap = new Map<string, {
    readonly actionType: string;
    readonly riskMultiplier: number;
  }>();
  for (const row of rows) {
    const startMs = Number(row['window_start_ms']);
    if (!Number.isFinite(startMs)) {
      continue;
    }
    const month = new Date(startMs).toISOString().slice(0, 7);
    actionMap.set(month, {
      actionType: String(row['action_type'] || '').trim() || 'trade',
      riskMultiplier: Number(row['risk_multiplier'] ?? 1) || 1
    });
  }

  return actionMap;
}
