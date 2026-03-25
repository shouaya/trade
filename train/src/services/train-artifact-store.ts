import {
  TRAIN_ARTIFACTS_TABLE,
  ensureTrainArtifactsSchema
} from '@money/database';
import type * as mysql from 'mysql2/promise';

type JsonValue = unknown;

export type TrainArtifactType =
  | 'goal-tracking'
  | 'feature-causality'
  | 'cost-sensitivity'
  | 'router-validation'
  | 'ai-summary';

export interface SaveTrainArtifactInput {
  readonly artifactKey: string;
  readonly artifactType: TrainArtifactType;
  readonly trainId?: string | null;
  readonly configId?: number | null;
  readonly configKey?: string | null;
  readonly symbol?: string | null;
  readonly intervalType?: string | null;
  readonly periodStartMs?: number | null;
  readonly periodEndMs?: number | null;
  readonly reportPath?: string | null;
  readonly summaryPath?: string | null;
  readonly summaryMarkdown?: string | null;
  readonly payload: JsonValue;
  readonly metadata?: JsonValue;
}

function toNullableString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function toNullableNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function saveTrainArtifact(
  db: mysql.Pool | mysql.Connection,
  input: SaveTrainArtifactInput
): Promise<void> {
  await ensureTrainArtifactsSchema(db);

  await db.query(
    `INSERT INTO ${TRAIN_ARTIFACTS_TABLE}
      (
        artifact_key,
        artifact_type,
        train_id,
        config_id,
        config_key,
        symbol,
        interval_type,
        period_start_ms,
        period_end_ms,
        report_path,
        summary_path,
        summary_markdown,
        payload_json,
        metadata_json
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       artifact_type = VALUES(artifact_type),
       train_id = VALUES(train_id),
       config_id = VALUES(config_id),
       config_key = VALUES(config_key),
       symbol = VALUES(symbol),
       interval_type = VALUES(interval_type),
       period_start_ms = VALUES(period_start_ms),
       period_end_ms = VALUES(period_end_ms),
       report_path = VALUES(report_path),
       summary_path = VALUES(summary_path),
       summary_markdown = VALUES(summary_markdown),
       payload_json = VALUES(payload_json),
       metadata_json = VALUES(metadata_json),
       updated_at = CURRENT_TIMESTAMP`,
    [
      input.artifactKey,
      input.artifactType,
      toNullableString(input.trainId),
      toNullableNumber(input.configId),
      toNullableString(input.configKey),
      toNullableString(input.symbol),
      toNullableString(input.intervalType),
      toNullableNumber(input.periodStartMs),
      toNullableNumber(input.periodEndMs),
      toNullableString(input.reportPath),
      toNullableString(input.summaryPath),
      input.summaryMarkdown ?? null,
      JSON.stringify(input.payload ?? null),
      input.metadata === undefined ? null : JSON.stringify(input.metadata ?? null)
    ]
  );
}
