import * as fs from 'fs';
import * as path from 'path';
import type * as mysql from 'mysql2/promise';
import {
  BACKTEST_RESULTS_TABLE,
  TRAIN_CONFIGS_TABLE,
  TRAIN_GOAL_TRACKING_TABLE
} from '@money/database';
import db from '../configs/database';
import {
  buildTrainConfigContentSelectSql,
  buildTrainConfigDetailJoinsSql
} from '../services/train-config-registry';

const TRAIN_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.resolve(__dirname, '../../reports/goal-tracking');
const SCORING_MODEL_VERSION = 'goal-fit-v1';

type JsonObject = Record<string, any>;

interface RegistryRow extends mysql.RowDataPacket {
  readonly id: number;
  readonly config_key: string;
  readonly config_type: string;
  readonly config_name: string | null;
  readonly train_id: string | null;
  readonly symbol: string | null;
  readonly result_group: string | null;
  readonly content: JsonObject | string | null;
}

interface BacktestResultRow extends mysql.RowDataPacket {
  readonly strategy_name: string;
  readonly total_pnl: number | string;
  readonly return_pct: number | string;
  readonly max_drawdown_pct: number | string;
  readonly score: number | string;
  readonly created_at: Date | string;
}

interface RouterReport {
  readonly symbol: string;
  readonly routerVersion: string;
  readonly comparison: {
    readonly router: RouterMetrics;
    readonly defaultStrategy: RouterMetrics;
    readonly rank1Strategy: RouterMetrics;
    readonly top10EqualWeight: RouterMetrics;
  };
  readonly dailyRoutes: readonly RouterDayRow[];
}

interface RouterMetrics {
  readonly totalPnl: number;
  readonly returnPct: number;
  readonly maxDrawdownPct: number;
}

interface RouterDayRow {
  readonly day: string;
  readonly week: string;
  readonly selectedStrategyKey: string | null;
  readonly effectiveRiskMultiplier: number;
  readonly routedPnl: number;
}

interface ValidationWindowSummary {
  readonly configKey: string;
  readonly targetLabel: string;
  readonly resultGroup: string;
  readonly strategyCount: number;
  readonly bestStrategyName: string | null;
  readonly bestTotalPnl: number;
  readonly bestReturnPct: number;
  readonly bestMaxDrawdownPct: number;
}

interface ParsedArgs {
  readonly trainConfigPath: string;
  readonly trainConfigRef: string | null;
}

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(digits));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function average(values: readonly number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle] ?? 0;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let trainConfigPath = '';
  let trainConfigRef: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--trainConfig') {
      trainConfigPath = String(argv[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (arg.startsWith('--trainConfig=')) {
      trainConfigPath = arg.slice('--trainConfig='.length);
      continue;
    }
    if (arg === '--trainConfigRef') {
      trainConfigRef = String(argv[index + 1] ?? '').trim() || null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--trainConfigRef=')) {
      trainConfigRef = arg.slice('--trainConfigRef='.length).trim() || null;
    }
  }

  if (!trainConfigPath) {
    throw new Error('--trainConfig is required');
  }

  return {
    trainConfigPath,
    trainConfigRef
  };
}

function parseConfigFile(filePath: string): JsonObject {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonObject;
}

function parseRowContent(row: RegistryRow): JsonObject {
  if (row.content && typeof row.content === 'object') {
    return row.content as JsonObject;
  }
  if (typeof row.content === 'string') {
    return JSON.parse(row.content) as JsonObject;
  }
  throw new Error(`config content missing for ${row.config_key}`);
}

function toPosix(value: string): string {
  return String(value || '').replace(/\\/g, '/');
}

function toRepoRelative(filePath: string): string {
  return toPosix(path.relative(TRAIN_ROOT, filePath));
}

function resolveConfigRef(baseConfigKey: string, targetRef: string): string {
  const normalizedRef = String(targetRef || '').trim();
  if (!normalizedRef) {
    return '';
  }
  if (path.posix.isAbsolute(normalizedRef)) {
    return toPosix(path.posix.normalize(normalizedRef));
  }
  return toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(baseConfigKey), normalizedRef)));
}

function loadJsonFileIfExists(relativePath: string): JsonObject | null {
  const absolutePath = path.resolve(TRAIN_ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as JsonObject;
}

function formatIsoDateOnly(value: unknown): string {
  if (value == null || value === '') {
    return '';
  }
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 10);
}

function toFiniteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildExpectedRouterReportPath(
  routerVersion: string,
  validationContent: JsonObject,
  fallbackSymbol: string
): string | null {
  const symbol = String(validationContent?.market?.symbol || fallbackSymbol || '').trim().toUpperCase();
  const timeRange = (validationContent?.timeRange ?? {}) as JsonObject;
  const startLabel = formatIsoDateOnly(timeRange.startIso || timeRange.startTimeMs);
  const endLabel = formatIsoDateOnly(timeRange.endIso || timeRange.endTimeMs);
  if (!symbol || !routerVersion || !startLabel || !endLabel) {
    return null;
  }
  return `reports/regime-routing-results/${symbol}_${routerVersion}_${startLabel}_to_${endLabel}.json`;
}

async function loadTrainingRow(configKey: string | null, trainId: string): Promise<RegistryRow | null> {
  if (configKey) {
    const [rows] = await db.query<RegistryRow[]>(
      `SELECT tc.*, ${buildTrainConfigContentSelectSql()}
       FROM ${TRAIN_CONFIGS_TABLE} tc
       ${buildTrainConfigDetailJoinsSql('tc')}
       WHERE tc.config_key = ?
         AND tc.status = 'active'
       ORDER BY tc.version_no DESC, tc.id DESC
       LIMIT 1`,
      [configKey]
    );
    if (rows[0]) {
      return rows[0];
    }
  }

  const [rows] = await db.query<RegistryRow[]>(
    `SELECT tc.*, ${buildTrainConfigContentSelectSql()}
     FROM ${TRAIN_CONFIGS_TABLE} tc
     ${buildTrainConfigDetailJoinsSql('tc')}
     WHERE tc.train_id = ?
       AND tc.config_type = 'training'
       AND tc.status = 'active'
     ORDER BY tc.version_no DESC, tc.id DESC
     LIMIT 1`,
    [trainId]
  );
  return rows[0] ?? null;
}

async function loadDerivedRows(trainId: string): Promise<readonly RegistryRow[]> {
  const [rows] = await db.query<RegistryRow[]>(
    `SELECT tc.*, ${buildTrainConfigContentSelectSql()}
     FROM ${TRAIN_CONFIGS_TABLE} tc
     ${buildTrainConfigDetailJoinsSql('tc')}
     WHERE tc.train_id = ?
       AND tc.status = 'active'
     ORDER BY tc.id ASC`,
    [trainId]
  );
  return rows;
}

async function loadLatestValidationRows(resultGroup: string): Promise<readonly BacktestResultRow[]> {
  const [runRows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT run_id
     FROM ${BACKTEST_RESULTS_TABLE}
     WHERE result_group = ?
       AND mode = 'validation'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [resultGroup]
  );
  const latestRunId = String(runRows[0]?.['run_id'] || '').trim();
  if (!latestRunId) {
    return [];
  }

  const [rows] = await db.query<BacktestResultRow[]>(
    `SELECT strategy_name, total_pnl, return_pct, max_drawdown_pct, score, created_at
     FROM ${BACKTEST_RESULTS_TABLE}
     WHERE result_group = ?
       AND run_id = ?
     ORDER BY total_pnl DESC, return_pct DESC, score DESC, strategy_name ASC`,
    [resultGroup, latestRunId]
  );
  return rows;
}

function pickBestValidationRow(rows: readonly BacktestResultRow[]): BacktestResultRow | null {
  return rows[0] ?? null;
}

function computePoolTurnoverRatios(monthlyPools: readonly JsonObject[]): readonly number[] {
  const strategySets = monthlyPools.map((pool) => {
    const names = new Set<string>();
    const topStrategies = Array.isArray(pool?.topStrategies) ? pool.topStrategies : [];
    for (const item of topStrategies) {
      const strategyName = String((item as JsonObject)?.strategyName || '').trim();
      if (strategyName) {
        names.add(strategyName);
      }
    }
    const selected = String(pool?.selectedStrategyName || '').trim();
    if (names.size === 0 && selected) {
      names.add(selected);
    }
    return names;
  });

  const turnovers: number[] = [];
  for (let index = 1; index < strategySets.length; index += 1) {
    const previous = strategySets[index - 1] ?? new Set<string>();
    const current = strategySets[index] ?? new Set<string>();
    const union = new Set<string>([...previous, ...current]);
    if (union.size === 0) {
      turnovers.push(0);
      continue;
    }
    let changed = 0;
    for (const name of union) {
      if (previous.has(name) !== current.has(name)) {
        changed += 1;
      }
    }
    turnovers.push(changed / union.size);
  }
  return turnovers;
}

function computeTopContributionShare(values: readonly number[], topN: number): number {
  const positive = values.filter((value) => value > 0).sort((left, right) => right - left);
  if (!positive.length) {
    return 1;
  }
  const total = positive.reduce((sum, value) => sum + value, 0);
  const top = positive.slice(0, topN).reduce((sum, value) => sum + value, 0);
  return total > 0 ? top / total : 1;
}

function computeStrategySwitchPerWeek(dailyRoutes: readonly RouterDayRow[]): number {
  if (!dailyRoutes.length) {
    return 0;
  }

  const routesByWeek = new Map<string, RouterDayRow[]>();
  for (const row of dailyRoutes) {
    const week = String(row.week || '').trim();
    if (!week) {
      continue;
    }
    const items = routesByWeek.get(week) || [];
    items.push(row);
    routesByWeek.set(week, items);
  }

  const switchCounts: number[] = [];
  for (const rows of routesByWeek.values()) {
    const sorted = [...rows].sort((left, right) => String(left.day).localeCompare(String(right.day)));
    let switches = 0;
    for (let index = 1; index < sorted.length; index += 1) {
      const previousKey = sorted[index - 1]?.selectedStrategyKey ?? null;
      const currentKey = sorted[index]?.selectedStrategyKey ?? null;
      if (previousKey !== currentKey) {
        switches += 1;
      }
    }
    switchCounts.push(switches);
  }

  return average(switchCounts);
}

function renderMarkdown(report: JsonObject): string {
  const summary = report.summary as JsonObject;
  const adaptation = report.adaptation as JsonObject;
  const validation = report.validation as JsonObject;
  const router = (report.router ?? null) as JsonObject | null;
  const stability = report.stability as JsonObject;
  const notes = Array.isArray(report.notes) ? report.notes as readonly string[] : [];

  const noteSection = notes.length > 0
    ? notes.map((note) => `- ${note}`).join('\n')
    : '- 当前没有新增预警。';

  return `# ${report.symbol} Goal Tracking

- Train ID: \`${report.trainId}\`
- Training config: \`${report.trainingConfigKey}\`
- Generated at: \`${report.generatedAt}\`
- Scoring model: \`${report.scoringModelVersion}\`

## Summary

- Goal attainment: \`${summary.goalAttainmentPct}%\`
- Status: \`${summary.status}\`
- Headline: ${summary.headline}

## Adaptation

- Monthly pools: \`${adaptation.monthlyPoolCount}\`
- Avg pool size: \`${adaptation.avgPoolSize}\`
- Unique strategies: \`${adaptation.uniqueStrategyCount}\`
- Avg turnover ratio: \`${adaptation.avgTurnoverRatio}\`
- Score: \`${adaptation.scorePct}%\`

## Validation

- Validation windows: \`${validation.windowCount}\`
- Profitable best-window ratio: \`${validation.profitableWindowRatio}\`
- Median best return: \`${validation.medianBestReturnPct}%\`
- Worst best return: \`${validation.worstBestReturnPct}%\`
- Score: \`${validation.scorePct}%\`

## Router

- Coverage ratio: \`${router?.coverageRatio ?? 0}\`
- Positive window ratio: \`${router?.positiveWindowRatio ?? 0}\`
- Beat baseline ratio: \`${router?.beatBaselineRatio ?? 0}\`
- Avg strategy switches / week: \`${router?.avgStrategySwitchesPerWeek ?? 0}\`
- Score: \`${router?.scorePct ?? 0}%\`

## Stability

- Positive window ratio: \`${stability.positiveWindowRatio}\`
- Avg max drawdown pct: \`${stability.avgMaxDrawdownPct}\`
- Profit concentration share (top 5): \`${stability.topContributionShare}\`
- Score: \`${stability.scorePct}%\`

## Notes

${noteSection}
`;
}

async function upsertGoalTrackingRow(params: {
  readonly trainId: string;
  readonly configId: number;
  readonly configKey: string;
  readonly symbol: string;
  readonly reportPath: string;
  readonly report: JsonObject;
}): Promise<void> {
  const { report } = params;
  const adaptation = report.adaptation as JsonObject;
  const validation = report.validation as JsonObject;
  const router = (report.router ?? null) as JsonObject | null;
  const stability = report.stability as JsonObject;
  const summary = report.summary as JsonObject;

  await db.query(
    `INSERT INTO ${TRAIN_GOAL_TRACKING_TABLE}
      (train_id, config_id, config_key, symbol, report_path,
       goal_attainment_pct, adaptation_score_pct, validation_score_pct, router_score_pct, stability_score_pct,
       profitable_validation_ratio, router_positive_ratio, router_beat_baseline_ratio, monthly_pool_turnover_ratio, avg_pool_size, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       config_key = VALUES(config_key),
       symbol = VALUES(symbol),
       report_path = VALUES(report_path),
       goal_attainment_pct = VALUES(goal_attainment_pct),
       adaptation_score_pct = VALUES(adaptation_score_pct),
       validation_score_pct = VALUES(validation_score_pct),
       router_score_pct = VALUES(router_score_pct),
       stability_score_pct = VALUES(stability_score_pct),
       profitable_validation_ratio = VALUES(profitable_validation_ratio),
       router_positive_ratio = VALUES(router_positive_ratio),
       router_beat_baseline_ratio = VALUES(router_beat_baseline_ratio),
       monthly_pool_turnover_ratio = VALUES(monthly_pool_turnover_ratio),
       avg_pool_size = VALUES(avg_pool_size),
       payload_json = VALUES(payload_json),
       updated_at = CURRENT_TIMESTAMP`,
    [
      params.trainId,
      params.configId,
      params.configKey,
      params.symbol,
      params.reportPath,
      Number(summary.goalAttainmentPct || 0),
      Number(adaptation.scorePct || 0),
      Number(validation.scorePct || 0),
      router ? Number(router.scorePct || 0) : null,
      Number(stability.scorePct || 0),
      Number(validation.profitableWindowRatio || 0),
      router ? Number(router.positiveWindowRatio || 0) : null,
      router ? Number(router.beatBaselineRatio || 0) : null,
      Number(adaptation.avgTurnoverRatio || 0),
      Number(adaptation.avgPoolSize || 0),
      JSON.stringify(report)
    ]
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = parseConfigFile(args.trainConfigPath);
  const trainId = String(config.trainId || config.trainingMeta?.trainId || '').trim();
  if (!trainId) {
    throw new Error('trainId is required in training config');
  }

  const trainingRow = await loadTrainingRow(args.trainConfigRef, trainId);
  if (!trainingRow) {
    throw new Error(`training config row not found for train_id=${trainId}`);
  }

  const trainingContent = parseRowContent(trainingRow);
  const symbol = String(trainingContent?.market?.symbol || trainingRow.symbol || '').trim().toUpperCase();
  const relatedRows = await loadDerivedRows(trainId);
  const validationRows = relatedRows.filter((row) => String(row.config_type || '') === 'validation');
  const snapshotRow = relatedRows.find((row) => {
    const content = parseRowContent(row);
    return Array.isArray(content?.rollingPlan?.monthlyPools) && content.rollingPlan.monthlyPools.length > 0;
  }) ?? null;

  const snapshotContent = snapshotRow ? parseRowContent(snapshotRow) : {};
  const monthlyPools = Array.isArray(snapshotContent?.rollingPlan?.monthlyPools)
    ? snapshotContent.rollingPlan.monthlyPools as readonly JsonObject[]
    : [];
  const turnoverRatios = computePoolTurnoverRatios(monthlyPools);
  const poolSizes = monthlyPools.map((pool) => {
    const topStrategies = Array.isArray(pool?.topStrategies) ? pool.topStrategies : [];
    return topStrategies.length;
  });
  const uniqueStrategies = new Set<string>();
  const distinctBuckets = new Set<string>();
  for (const pool of monthlyPools) {
    const featureBucket = String(pool?.featureBucket || '').trim();
    if (featureBucket) {
      distinctBuckets.add(featureBucket);
    }
    const topStrategies = Array.isArray(pool?.topStrategies) ? pool.topStrategies : [];
    for (const item of topStrategies) {
      const strategyName = String((item as JsonObject)?.strategyName || '').trim();
      if (strategyName) {
        uniqueStrategies.add(strategyName);
      }
    }
  }

  const avgPoolSize = average(poolSizes);
  const avgTurnoverRatio = average(turnoverRatios);
  const breadthRatio = clamp01(uniqueStrategies.size / Math.max(avgPoolSize * 2, 1));
  const bucketCoverageRatio = clamp01(distinctBuckets.size / 4);
  const adaptationScorePct = round(100 * (
    (avgTurnoverRatio * 0.45)
    + (breadthRatio * 0.35)
    + (bucketCoverageRatio * 0.20)
  ), 2);

  const validationWindows: ValidationWindowSummary[] = [];
  for (const row of validationRows) {
    const validationContent = parseRowContent(row);
    const resultGroup = String(row.result_group || validationContent?.database?.tableName || '').trim();
    if (!resultGroup) {
      continue;
    }
    const latestRows = await loadLatestValidationRows(resultGroup);
    const bestRow = pickBestValidationRow(latestRows);
    validationWindows.push({
      configKey: String(row.config_key || ''),
      targetLabel: String(validationContent?.validationTarget?.label || validationContent?.name || row.config_name || '').trim(),
      resultGroup,
      strategyCount: latestRows.length,
      bestStrategyName: bestRow?.strategy_name ? String(bestRow.strategy_name) : null,
      bestTotalPnl: round(toFiniteNumber(bestRow?.total_pnl), 2),
      bestReturnPct: round(toFiniteNumber(bestRow?.return_pct), 4),
      bestMaxDrawdownPct: round(toFiniteNumber(bestRow?.max_drawdown_pct), 4)
    });
  }

  const profitableWindowRatio = validationWindows.length > 0
    ? validationWindows.filter((item) => item.bestTotalPnl > 0).length / validationWindows.length
    : 0;
  const medianBestReturnPct = median(validationWindows.map((item) => item.bestReturnPct));
  const worstBestReturnPct = validationWindows.length > 0
    ? Math.min(...validationWindows.map((item) => item.bestReturnPct))
    : 0;
  const validationScorePct = round(100 * (
    (profitableWindowRatio * 0.50)
    + (clamp01((medianBestReturnPct + 2) / 7) * 0.30)
    + (clamp01((worstBestReturnPct + 5) / 5) * 0.20)
  ), 2);

  const regimeRouting = (trainingContent?.regimeRouting ?? {}) as JsonObject;
  const routerConfigRef = String(regimeRouting.routerConfigPath || '').trim();
  const routerContent = routerConfigRef
    ? loadJsonFileIfExists(resolveConfigRef(String(trainingRow.config_key), routerConfigRef))
    : null;
  const routerVersion = String(routerContent?.routerVersion || '').trim();

  const routerReports: RouterReport[] = [];
  for (const row of validationRows) {
    const validationContent = parseRowContent(row);
    const reportPath = buildExpectedRouterReportPath(
      routerVersion,
      validationContent,
      symbol
    );
    if (!reportPath) {
      continue;
    }
    const report = loadJsonFileIfExists(reportPath);
    if (report) {
      routerReports.push(report as unknown as RouterReport);
    }
  }

  const beatDefaultRatio = routerReports.length > 0
    ? routerReports.filter((item) => item.comparison.router.totalPnl > item.comparison.defaultStrategy.totalPnl).length / routerReports.length
    : 0;
  const beatRank1Ratio = routerReports.length > 0
    ? routerReports.filter((item) => item.comparison.router.totalPnl > item.comparison.rank1Strategy.totalPnl).length / routerReports.length
    : 0;
  const beatTop10Ratio = routerReports.length > 0
    ? routerReports.filter((item) => item.comparison.router.totalPnl > item.comparison.top10EqualWeight.totalPnl).length / routerReports.length
    : 0;
  const beatBaselineRatio = average([beatDefaultRatio, beatRank1Ratio, beatTop10Ratio]);
  const routerPositiveWindowRatio = routerReports.length > 0
    ? routerReports.filter((item) => item.comparison.router.totalPnl > 0).length / routerReports.length
    : 0;
  const routerCoverageRatio = validationWindows.length > 0 ? routerReports.length / validationWindows.length : 0;
  const routerDrawdowns = routerReports.map((item) => toFiniteNumber(item.comparison.router.maxDrawdownPct));
  const routerDailyRoutes = routerReports.flatMap((item) => item.dailyRoutes || []);
  const stopDayRatio = routerDailyRoutes.length > 0
    ? routerDailyRoutes.filter((item) => Number(item.effectiveRiskMultiplier) === 0).length / routerDailyRoutes.length
    : 0;
  const reduceDayRatio = routerDailyRoutes.length > 0
    ? routerDailyRoutes.filter((item) => Number(item.effectiveRiskMultiplier) > 0 && Number(item.effectiveRiskMultiplier) < 1).length / routerDailyRoutes.length
    : 0;
  const avgStrategySwitchesPerWeek = computeStrategySwitchPerWeek(routerDailyRoutes);
  const routerScorePct = routerReports.length > 0
    ? round(100 * (
      (beatBaselineRatio * 0.40)
      + (routerPositiveWindowRatio * 0.40)
      + (routerCoverageRatio * 0.20)
    ), 2)
    : null;

  const stabilityPositiveWindowRatio = routerReports.length > 0 ? routerPositiveWindowRatio : profitableWindowRatio;
  const avgMaxDrawdownPct = routerReports.length > 0
    ? average(routerDrawdowns)
    : average(validationWindows.map((item) => item.bestMaxDrawdownPct));
  const topContributionShare = routerReports.length > 0
    ? computeTopContributionShare(routerDailyRoutes.map((item) => toFiniteNumber(item.routedPnl)), 5)
    : computeTopContributionShare(validationWindows.map((item) => item.bestTotalPnl), 3);
  const drawdownHealth = 1 - clamp01((avgMaxDrawdownPct - 5) / 15);
  const concentrationHealth = 1 - clamp01((topContributionShare - 0.4) / 0.5);
  const stabilityScorePct = round(100 * (
    (stabilityPositiveWindowRatio * 0.45)
    + (drawdownHealth * 0.35)
    + (concentrationHealth * 0.20)
  ), 2);

  const goalAttainmentPct = round(routerScorePct == null
    ? (
      (adaptationScorePct * 0.30)
      + (validationScorePct * 0.40)
      + (stabilityScorePct * 0.30)
    )
    : (
      (adaptationScorePct * 0.20)
      + (validationScorePct * 0.25)
      + (routerScorePct * 0.30)
      + (stabilityScorePct * 0.25)
    ), 2);

  let status = 'weak-fit';
  let headline = '市场特征与策略库的匹配度仍偏弱，离稳定盈利还有明显距离。';
  if (goalAttainmentPct >= 75) {
    status = 'on-track';
    headline = '系统已经出现较明确的特征-策略匹配迹象，可以继续做稳定性强化。';
  } else if (goalAttainmentPct >= 60) {
    status = 'partial-fit';
    headline = '系统已有部分匹配能力，但稳定盈利证据还不够硬。';
  }

  const notes: string[] = [];
  if (avgTurnoverRatio < 0.15 && monthlyPools.length > 1) {
    notes.push('rolling 候选池月度变动偏小，说明系统对市场切换的自适应还不够积极。');
  }
  if (profitableWindowRatio < 0.5) {
    notes.push('validation 窗口里可盈利月份占比不足一半，策略库未来适配性偏弱。');
  }
  if (routerReports.length > 0 && beatBaselineRatio < 0.5) {
    notes.push('router 对 default / rank1 / top10 的超额优势不足，说明特征到策略的映射还不够稳定。');
  }
  if (topContributionShare > 0.7) {
    notes.push('收益过度集中在少数窗口，当前盈利稳定性不够理想。');
  }
  if (routerReports.length === 0) {
    notes.push('当前还没有可用的 router validation 汇总，本次达成率以 rolling validation 为主。');
  }

  const report = {
    trainId,
    symbol,
    trainingConfigKey: String(trainingRow.config_key),
    trainingConfigName: String(trainingRow.config_name || trainingContent?.name || ''),
    generatedAt: new Date().toISOString(),
    scoringModelVersion: SCORING_MODEL_VERSION,
    summary: {
      goalAttainmentPct,
      status,
      headline
    },
    adaptation: {
      monthlyPoolCount: monthlyPools.length,
      avgPoolSize: round(avgPoolSize, 4),
      uniqueStrategyCount: uniqueStrategies.size,
      distinctFeatureBuckets: distinctBuckets.size,
      avgTurnoverRatio: round(avgTurnoverRatio, 4),
      scorePct: adaptationScorePct
    },
    validation: {
      windowCount: validationWindows.length,
      profitableWindowRatio: round(profitableWindowRatio, 4),
      medianBestReturnPct: round(medianBestReturnPct, 4),
      worstBestReturnPct: round(worstBestReturnPct, 4),
      scorePct: validationScorePct,
      windows: validationWindows
    },
    router: routerReports.length > 0 ? {
      windowCount: routerReports.length,
      coverageRatio: round(routerCoverageRatio, 4),
      positiveWindowRatio: round(routerPositiveWindowRatio, 4),
      beatDefaultRatio: round(beatDefaultRatio, 4),
      beatRank1Ratio: round(beatRank1Ratio, 4),
      beatTop10Ratio: round(beatTop10Ratio, 4),
      beatBaselineRatio: round(beatBaselineRatio, 4),
      avgStopDayRatio: round(stopDayRatio, 4),
      avgReduceDayRatio: round(reduceDayRatio, 4),
      avgStrategySwitchesPerWeek: round(avgStrategySwitchesPerWeek, 4),
      scorePct: routerScorePct
    } : null,
    stability: {
      positiveWindowRatio: round(stabilityPositiveWindowRatio, 4),
      avgMaxDrawdownPct: round(avgMaxDrawdownPct, 4),
      topContributionShare: round(topContributionShare, 4),
      scorePct: stabilityScorePct
    },
    notes
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const baseName = path.basename(String(trainingRow.config_key), '.json');
  const jsonPath = path.join(OUTPUT_DIR, `${baseName}.goal-tracking.json`);
  const mdPath = path.join(OUTPUT_DIR, `${baseName}.goal-tracking.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdPath, renderMarkdown(report), 'utf8');

  await upsertGoalTrackingRow({
    trainId,
    configId: Number(trainingRow.id),
    configKey: String(trainingRow.config_key),
    symbol,
    reportPath: toRepoRelative(mdPath),
    report
  });

  console.log(`[goal-tracking] validation windows: ${validationWindows.length}`);
  console.log(`[goal-tracking] router reports: ${routerReports.length}`);
  console.log(`[goal-tracking] goal attainment: ${goalAttainmentPct}% (${status})`);
  console.log(`Goal tracking JSON written: ${jsonPath}`);
  console.log(`Goal tracking report written: ${mdPath}`);

  await db.end();
}

void main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Goal tracking failed: ${message}`);
  try {
    await db.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
