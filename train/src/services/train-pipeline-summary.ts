import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TRAIN_ARTIFACTS_TABLE,
  ROLLING_POOL_DETAILS_TABLE,
  ROLLING_RULE_DETAILS_TABLE
} from '@money/database';
import {
  buildTrainConfigContentSelectSql,
  buildTrainConfigDetailJoinsSql
} from './train-config-registry';

type Queryable = {
  readonly query: (sql: string, params?: readonly unknown[]) => Promise<[any[], any]>;
};

type BuildTrainingPipelineSummaryOptions = {
  readonly db: Queryable;
  readonly repoRoot: string;
  readonly trainRoot: string;
};

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function toRepoRelative(repoRoot: string, filePath: string): string {
  return toPosix(path.relative(repoRoot, filePath));
}

function safeReadText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function parseMaybeJson(value: unknown): any {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function extractTrainId(config: any): string | null {
  return String(
    config?.trainId
    || config?.trainingMeta?.trainId
    || config?.trainingContext?.trainId
    || ''
  ).trim() || null;
}

function listFiles(dirPath: string, predicate: (filePath: string) => boolean = () => true): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath, predicate));
      continue;
    }

    if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function formatIso(value: unknown): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function toRequestSummary(row: any): any {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    requestId: String(row.request_id),
    configId: Number(row.config_id),
    configKey: String(row.config_key),
    configName: row.config_name ? String(row.config_name) : null,
    configType: String(row.config_type),
    action: String(row.action),
    status: String(row.status),
    errorMessage: row.error_message ? String(row.error_message) : null,
    startedAt: formatIso(row.started_at),
    completedAt: formatIso(row.completed_at),
    createdAt: formatIso(row.created_at),
    updatedAt: formatIso(row.updated_at)
  };
}

function isActiveRequestStatus(status: unknown): boolean {
  return status === 'queued'
    || status === 'exporting'
    || status === 'running'
    || status === 'cancelling';
}

function normalizeText(value: unknown): string {
  return String(value || '').toLowerCase();
}

function getYearFromConfig(config: any, fallbackName: string): string | null {
  const baseYear = String(fallbackName || '').match(/^(\d{4})_/);
  if (baseYear) {
    return baseYear[1] || null;
  }

  const startIso = config?.timeRange?.startIso;
  if (startIso) {
    return String(new Date(startIso).getUTCFullYear());
  }

  const startMs = config?.timeRange?.startTimeMs;
  if (startMs) {
    return String(new Date(Number(startMs)).getUTCFullYear());
  }

  return null;
}

function getValidationTargetLabel(validationConfig: any, fallbackName: string): string {
  const explicitLabel = validationConfig?.validationTarget?.label;
  if (explicitLabel) {
    return String(explicitLabel);
  }

  const yearMatch = String(fallbackName).match(/_(\d{4})_validation\.json$/i);
  if (yearMatch) {
    return yearMatch[1] || 'validation';
  }

  const endIso = validationConfig?.timeRange?.endIso;
  const startIso = validationConfig?.timeRange?.startIso;
  if (startIso && endIso) {
    return `${String(startIso).slice(0, 10)} -> ${String(endIso).slice(0, 10)}`;
  }

  if (startIso) {
    return String(startIso).slice(0, 10);
  }

  return 'validation';
}

function getValidationProfile(validationConfig: any, fallbackName: string): string {
  const explicitProfile = validationConfig?.validationProfile;
  if (explicitProfile) {
    return String(explicitProfile);
  }

  const fileText = normalizeText([fallbackName, validationConfig?.name, validationConfig?.description].join(' '));
  if (fileText.includes('rolling')) {
    return 'rolling-window';
  }
  if (fileText.includes('custom')) {
    return 'custom-range';
  }

  return 'unknown';
}

function getValidationPriority(profile: unknown): number {
  switch (String(profile || '')) {
    case 'rolling-window':
      return 1;
    case 'custom-range':
      return 2;
    default:
      return 9;
  }
}

function matchValidationToTraining(training: any, validation: any): boolean {
  if (normalizeText(validation.config?.market?.symbol) !== normalizeText(training.symbol)) {
    return false;
  }

  const trainingYear = String(training.trainingYear || '');
  const fileText = normalizeText([
    validation.fileName,
    validation.config?.name,
    validation.config?.description,
    validation.config?.database?.tableName,
    validation.config?.trainConfig,
    validation.config?.validationProfile,
    validation.config?.validationTarget?.label
  ].join(' '));

  if (trainingYear && (fileText.includes(`from_${trainingYear}`) || fileText.includes(`from ${trainingYear}`))) {
    return true;
  }

  const exactTrainConfig = normalizeText(`configs/training/${training.fileName}`);
  return fileText.includes(exactTrainConfig);
}

function buildReportPreview(filePath: string): string | null {
  const raw = safeReadText(filePath);
  if (!raw) {
    return null;
  }

  if (filePath.endsWith('.json')) {
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2).slice(0, 1200).trim();
    } catch {
      return raw.slice(0, 1200).trim();
    }
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 12);

  const preview = lines.join('\n').slice(0, 1200).trim();
  return preview || null;
}

function stringifyPreview(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 1200) : null;
  }

  try {
    return JSON.stringify(value, null, 2).slice(0, 1200).trim() || null;
  } catch {
    return String(value).slice(0, 1200).trim() || null;
  }
}

function buildArtifactPreview(artifact: any, repoRoot: string): string | null {
  const summaryMarkdown = String(artifact?.summaryMarkdown || '').trim();
  if (summaryMarkdown) {
    return summaryMarkdown.slice(0, 1200);
  }

  const reportPath = String(artifact?.reportPath || '').trim();
  if (reportPath) {
    const absolutePath = path.isAbsolute(reportPath) ? reportPath : path.join(repoRoot, reportPath);
    const filePreview = buildReportPreview(absolutePath);
    if (filePreview) {
      return filePreview;
    }
  }

  return stringifyPreview(artifact?.payload ?? null);
}

function toArtifactSummary(artifact: any, repoRoot: string): any {
  if (!artifact) {
    return null;
  }

  return {
    path: getArtifactPath(artifact),
    modifiedAt: artifact.updatedAt || null,
    preview: buildArtifactPreview(artifact, repoRoot)
  };
}

function getArtifactPath(artifact: any): string | null {
  return artifact?.summaryPath
    || artifact?.reportPath
    || (artifact?.artifactKey ? `train_artifacts:${artifact.artifactKey}` : null);
}

function pickLatestArtifact(artifacts: readonly any[], matcher: (artifact: any) => boolean): any {
  const matched = artifacts.filter(matcher).sort((left, right) => {
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
    return rightTime - leftTime;
  });
  return matched[0] || null;
}

function extractRollingPackageArtifact(artifact: any): any | null {
  const payload = artifact?.payload;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const nested = payload.artifact;
  if (nested && typeof nested === 'object' && nested.artifactType === 'rolling-strategy-package') {
    return nested;
  }

  if (payload.artifactType === 'rolling-strategy-package') {
    return payload;
  }

  return null;
}

function buildTopStrategySnapshotFromArtifact(artifact: any): any | null {
  const rollingPackage = extractRollingPackageArtifact(artifact);
  if (!rollingPackage) {
    return null;
  }

  return {
    path: getArtifactPath(artifact) || `analysis_artifacts:${artifact.artifactKey}`,
    configName: rollingPackage.name || null,
    generatedAt: rollingPackage.generatedAt || artifact.updatedAt || artifact.createdAt || null,
    sourceRunId: rollingPackage.sourceRunId || null,
    limit: rollingPackage.limit || null,
    exact: Boolean(rollingPackage.exact),
    rollingPlan: {
      monthlyPools: Array.isArray(rollingPackage?.rollingPlan?.monthlyPools)
        ? rollingPackage.rollingPlan.monthlyPools
        : [],
      rules: rollingPackage?.rollingPlan?.rules || {},
      normalizedRules: []
    }
  };
}

function buildStatus(stepDone: boolean, partial = false): string {
  if (stepDone) {
    return 'done';
  }
  if (partial) {
    return 'partial';
  }
  return 'todo';
}

function isCompletedRequestStatus(status: unknown): boolean {
  return String(status || '') === 'completed';
}

function isCompletedTaskStatus(status: unknown): boolean {
  return String(status || '') === 'completed';
}

function hasTrainingCompleted(pipeline: {
  readonly trainingRun?: any;
  readonly latestRequest?: any;
  readonly latestTask?: any;
  readonly latestGenerateValidationRequest?: any;
  readonly topStrategySnapshot?: any;
} | null | undefined): boolean {
  if (!pipeline) {
    return false;
  }

  return Boolean(
    pipeline.trainingRun
    || isCompletedRequestStatus(pipeline.latestRequest?.status)
    || isCompletedTaskStatus(pipeline.latestTask?.status)
    || pipeline.latestGenerateValidationRequest
    || pipeline.topStrategySnapshot
  );
}

function formatRange(timeRange: any): string {
  if (!timeRange?.startIso || !timeRange?.endIso) {
    return '时间范围未知';
  }

  return `${String(timeRange.startIso).slice(0, 10)} -> ${String(timeRange.endIso).slice(0, 10)}`;
}

function getRequestStatusText(status: unknown): string {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'exporting':
      return '导出中';
    case 'running':
      return '执行中';
    case 'cancelling':
      return '停止中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return String(status || '');
  }
}

export function buildFinalConfigState(pipeline: any): any {
  const latestArtifactRequest = pipeline?.latestGenerateValidationRequest || null;
  const isGenerating = latestArtifactRequest?.action === 'generate-validation'
    && isActiveRequestStatus(latestArtifactRequest?.status);
  const trainingCompleted = hasTrainingCompleted(pipeline);

  if (pipeline?.topStrategySnapshot) {
    return {
      title: pipeline.topStrategySnapshot.path,
      detail: `final config ${formatIso(pipeline.topStrategySnapshot.generatedAt) || pipeline.topStrategySnapshot.generatedAt || 'n/a'}`,
      status: 'done',
      canExport: true,
      requestId: latestArtifactRequest?.id || null
    };
  }

  if (isGenerating) {
    return {
      title: '最终策略 config 生成中',
      detail: `请求 ${latestArtifactRequest.requestId || latestArtifactRequest.id} · ${getRequestStatusText(latestArtifactRequest.status)}`,
      status: 'running',
      canExport: false,
      requestId: latestArtifactRequest?.id || null
    };
  }

  if (latestArtifactRequest?.action === 'generate-validation' && latestArtifactRequest?.status === 'failed') {
    return {
      title: '最终策略 config 生成失败',
      detail: latestArtifactRequest.errorMessage || '请查看生成请求日志并重试',
      status: 'todo',
      canExport: false,
      requestId: latestArtifactRequest.id
    };
  }

  if (trainingCompleted) {
    return {
      title: '等待生成最终策略 config',
      detail: 'rolling training manifest 已完成，接下来应生成 rolling package。',
      status: 'todo',
      canExport: false,
      requestId: null
    };
  }

  return {
    title: '尚未生成',
    detail: '先完成训练候选池，再生成最终策略 config。',
    status: 'todo',
    canExport: false,
    requestId: null
  };
}

export function buildMethodologyStages(pipeline: any, trainingConfig: any): any[] {
  const validations = Array.isArray(pipeline?.validationConfigs) ? pipeline.validationConfigs : [];
  const strategyTypes = Array.isArray(trainingConfig?.strategy?.types) ? trainingConfig.strategy.types : [];
  const holdMinutes = Array.isArray(trainingConfig?.strategy?.parameters?.risk?.maxHoldMinutes)
    ? trainingConfig.strategy.parameters.risk.maxHoldMinutes
    : [];
  const lotSize = trainingConfig?.strategy?.parameters?.risk?.lotSize?.[0];
  const hasTrainingConfig = Boolean(pipeline?.trainingConfigPath);
  const hasValidationConfig = validations.length > 0;
  const trainingCompleted = hasTrainingCompleted(pipeline);
  const hasSnapshot = Boolean(pipeline?.topStrategySnapshot);
  const hasAnyValidationRun = validations.some((item: any) => Boolean(item.latestRun));
  const hasAllValidationRuns = validations.length > 0 && validations.every((item: any) => Boolean(item.latestRun));
  const hasActiveValidationRequest = validations.some((item: any) => isActiveRequestStatus(item.latestRequest?.status));
  const hasRouter = Boolean(pipeline?.router?.routerPath);
  const hasPolicy = Boolean(pipeline?.router?.policyPath);
  const routerReady = hasRouter && hasPolicy;
  const hasFeatureCausality = Boolean(pipeline?.reports?.featureCausality?.path);
  const hasCostSensitivity = Boolean(pipeline?.reports?.costSensitivity?.path);
  const hasRouterValidation = Boolean(pipeline?.reports?.routerValidation?.path);
  const trainingRequestRunning = isActiveRequestStatus(pipeline?.latestRequest?.status);
  const trainingRange = formatRange(pipeline?.timeRange);
  const strategyLabel = strategyTypes.length > 0 ? strategyTypes.join(', ') : '未定义';
  const holdLabel = holdMinutes.length > 0 ? holdMinutes.join(' - ') : '未定义';
  const validationLabels = validations.length > 0
    ? validations.map((item: any) => `${item.targetLabel}:${item.latestRun ? 'done' : (item.latestRequest?.status || 'todo')}`)
    : ['尚未生成 validation config'];

  return [
    {
      key: 'stage-0-boundary',
      label: '阶段 0',
      title: '确认任务边界',
      status: hasTrainingConfig && hasValidationConfig ? 'done' : hasTrainingConfig ? 'partial' : 'todo',
      summary: hasValidationConfig
        ? '训练区间内部 rolling 验证窗口已经进入配置库，边界清晰。'
        : '已有 training config，但内部 rolling validation 配置还未生成。',
      inputs: ['交易对', '训练区间', 'rolling 起点/窗口', '既有 router / report'],
      outputs: [
        pipeline?.trainingConfigPath || '等待 training config',
        hasValidationConfig ? `${validations.length} 份 validation config` : '等待 validation config'
      ],
      gates: ['symbol 明确', 'rolling 从训练期内部启动', '命名不混淆旧结果'],
      evidence: [
        pipeline?.symbol || 'UNKNOWN',
        trainingRange,
        hasValidationConfig ? `validation ${validations.length} 份` : '未匹配到 validation'
      ],
      notes: '方法论要求先锁定 symbol、训练期以及 rolling 起点，再进入 feature-memory 月度学习。',
      actionKeys: ['generate-validation', 'prepare-validation']
    },
    {
      key: 'stage-1-diagnosis',
      label: '阶段 1',
      title: '波动与结构诊断',
      status: hasFeatureCausality ? 'done' : trainingCompleted || hasSnapshot ? 'partial' : 'todo',
      summary: hasFeatureCausality
        ? '已有结构诊断类报告，可作为阶段 1 的证据入口。'
        : '当前缺少显式结构诊断报告，建议先补一份波动/因果分析。',
      inputs: ['历史数据切片', '好周 / 坏周样本', '高波 / 低波段'],
      outputs: ['波动报告', '周 / 月 / 日结构概览'],
      gates: ['能区分高低波', '能指出典型坏区间', '能解释至少几类结构差异'],
      evidence: hasFeatureCausality
        ? [pipeline.reports.featureCausality.path]
        : trainingCompleted
          ? ['rolling manifest 已完成，可回填结构诊断报告']
          : ['等待 rolling training manifest 完成后补证据'],
      notes: '当前系统没有单独的“波动诊断”文件类型，先用 feature causality / 分析报告近似承载。',
      actionKeys: ['feature-causality']
    },
    {
      key: 'stage-2-family',
      label: '阶段 2',
      title: '定义候选策略家族',
      status: hasTrainingConfig ? 'done' : 'todo',
      summary: hasTrainingConfig
        ? `当前 training config 已固定主家族：${strategyLabel}。`
        : '需要先创建训练配置并明确主策略家族。',
      inputs: ['主策略家族', '参数空间', '交易时段', '风控边界'],
      outputs: ['训练配置 JSON', '受约束参数空间'],
      gates: ['单轮尽量只用一个主家族', '参数空间有覆盖但不过宽', '先能跑通再扩网格'],
      evidence: [
        `策略族: ${strategyLabel}`,
        `TopN: ${pipeline?.topN || 'n/a'}`,
        `lotSize: ${lotSize ?? '未定义'} · hold: ${holdLabel}`
      ],
      notes: '这一步以配置编辑器为主，先把关键参数定下来，再进入候选池训练。',
      actionKeys: []
    },
    {
      key: 'stage-3-candidate-pool',
      label: '阶段 3',
      title: '训练候选池',
      status: trainingRequestRunning ? 'running' : trainingCompleted ? 'done' : 'todo',
      summary: pipeline?.trainingRun
        ? `候选池已落库，当前记录 ${pipeline.trainingRun.strategyCount} 个策略结果。`
        : trainingCompleted
          ? 'rolling training manifest 已完成，后续会在 generate-validation 阶段逐月学习候选池。'
          : trainingRequestRunning
          ? '训练任务正在执行，等待 rolling manifest 完成。'
          : '还没有训练结果，先跑 rolling training manifest。',
      inputs: ['training config', '参数网格', 'train_id'],
      outputs: ['train_run_requests', 'rolling manifest', '后续 generate-validation 输入'],
      gates: ['参数空间不能过窄', '策略之间要有结构差异', '不再先做整段全量回测'],
      evidence: [
        pipeline?.resultGroup || '未配置结果表',
        pipeline?.trainingRun
          ? `${pipeline.trainingRun.runId} · ${pipeline.trainingRun.strategyCount} strategies`
          : trainingCompleted
            ? `manifest ready · ${pipeline?.latestRequest?.requestId || pipeline?.latestTask?.taskId || 'n/a'}`
            : '尚未落库',
        pipeline?.latestRequest?.requestId ? `queue ${pipeline.latestRequest.requestId}` : '暂无训练请求'
      ],
      notes: '这一步对应 `METHODOLOGY` 的主入口，训练 UI 的自动执行也从这里开始。',
      actionKeys: ['run-training']
    },
    {
      key: 'stage-4-weekly-base',
      label: '阶段 4',
      title: '构建周级策略映射',
      status: routerReady ? 'done' : trainingCompleted ? 'partial' : 'todo',
      summary: routerReady
        ? '已存在可执行 router / policy，可视为周级 base policy 已固化。'
        : trainingCompleted
          ? '候选池已具备，下一步应归纳 weekly base policy。'
          : '先完成候选池训练，再做周级映射。',
      inputs: ['周级特征', 'bucket 划分', '坏周 / 好周表现'],
      outputs: ['weekly_guard 规则'],
      gates: ['解决大方向错误', '不要把日级细节塞进周级', '规则不能过碎'],
      evidence: [
        hasSnapshot ? pipeline.topStrategySnapshot.path : '尚未生成最终策略 config',
        hasRouter ? pipeline.router.routerPath : '尚未找到 router',
        hasPolicy ? pipeline.router.policyPath : '尚未找到 policy'
      ],
      notes: '当前系统没有单独的 weekly_guard 文件，UI 先用 router / policy 产物作为阶段完成度代理。',
      actionKeys: []
    },
    {
      key: 'stage-5-daily-overlay',
      label: '阶段 5',
      title: '构建日级策略映射',
      status: hasRouterValidation ? 'done' : hasRouter || hasAnyValidationRun ? 'partial' : 'todo',
      summary: hasRouterValidation
        ? '已有 router 相关验证报告，说明日级 overlay 已进入可回放状态。'
        : hasRouter || hasAnyValidationRun
          ? '已经具备部分样本或路由产物，可以继续收敛 daily overlay。'
          : '先准备 rolling 验证样本，再提炼日级映射。',
      inputs: ['坏日 / 好日样本', '日级特征', '候选策略差异'],
      outputs: ['daily_router'],
      gates: ['每条规则都能解释具体坏日', '不能只修单个记忆样本', '不能一上来大量 stop'],
      evidence: [
        ...validationLabels.slice(0, 2),
        hasRouterValidation ? pipeline.reports.routerValidation.path : '尚无 daily router 验证报告'
      ],
      notes: '方法论强调每条日级规则都要能回答“修的是哪几天、为什么错、是否误伤”。',
      actionKeys: []
    },
    {
      key: 'stage-6-loss-recheck',
      label: '阶段 6',
      title: '加入亏损反馈保护',
      status: routerReady && hasRouterValidation ? 'done' : routerReady ? 'partial' : 'todo',
      summary: routerReady
        ? '保护层已经随 router/policy 进入稳定产物，但还缺少独立 loss recheck 证据。'
        : 'loss recheck 还没有进入稳定执行产物。',
      inputs: ['连续亏损日', '前一日失败 + 次日继续硬做样本'],
      outputs: ['loss_recheck'],
      gates: ['它只能做保护层', '不能反过来成为主要决策层'],
      evidence: [
        hasRouter ? pipeline.router.routerPath : '尚未找到 router',
        hasPolicy ? pipeline.router.policyPath : '尚未找到 policy',
        hasRouterValidation ? '已有 router validation 证据' : '等待验证保护层效果'
      ],
      notes: '当前数据层没有单独拆出 loss_recheck 产物，UI 先把它视为 router 内部保护层能力。',
      actionKeys: []
    },
    {
      key: 'stage-7-router',
      label: '阶段 7',
      title: '生成 router / policy catalog',
      status: routerReady ? 'done' : hasRouter || hasPolicy ? 'partial' : 'todo',
      summary: routerReady
        ? 'router 与 policy catalog 已齐，可进入共用验证和复盘。'
        : hasRouter || hasPolicy
          ? 'router / policy 只完成了一部分，还不能算稳定产物。'
          : '还没有发现 router / policy 产物。',
      inputs: ['weekly_guard', 'daily_router', 'loss_recheck'],
      outputs: ['router config', 'policy catalog', 'daily policy summary'],
      gates: ['不能只有 router 没说明书', '不能只有说明书 没可执行配置'],
      evidence: [
        hasRouter ? pipeline.router.routerPath : '未找到 router config',
        hasPolicy ? pipeline.router.policyPath : '未找到 policy catalog',
        hasRouterValidation ? pipeline.reports.routerValidation.path : '尚无 routing report'
      ],
      notes: '这一步是方法论里的“固化产物”阶段，前后端都应围绕这套产物展开。',
      actionKeys: ['build-router']
    },
    {
      key: 'stage-8-rolling-validation',
      label: '阶段 8',
      title: 'Rolling 验证',
      status: hasActiveValidationRequest
        ? 'running'
        : hasAllValidationRuns && (hasCostSensitivity || hasRouterValidation)
          ? 'done'
          : hasValidationConfig || hasSnapshot
            ? 'partial'
            : 'todo',
      summary: hasAllValidationRuns
        ? `rolling validation 已完成 ${validations.length} 个目标区间。`
        : hasValidationConfig
          ? 'validation 配置已经就绪，可以直接执行 rolling 验证。'
          : '先生成最终策略 config 与 validation config，再进入 rolling 验证。',
      inputs: ['validation config', 'final strategy config', '同版 router'],
      outputs: ['rolling validation result', 'scorecard', 'cost sensitivity'],
      gates: ['至少和 default/rank1/topN/oracle 对比', '检查摩擦成本', '关注负收益周和坏周解释'],
      evidence: [
        ...validationLabels.slice(0, 3),
        hasCostSensitivity ? pipeline.reports.costSensitivity.path : '尚无成本敏感度报告'
      ],
      notes: '这里是方法论里的滚动泛化检验，要连续覆盖多个验证窗口，而不是退回按年度切一刀的旧模式。',
      actionKeys: ['generate-validation', 'prepare-validation', 'waiting-generate-validation', 'run-validation', 'waiting-validation', 'cost-sensitivity', 'router-validate']
    },
    {
      key: 'stage-9-iteration',
      label: '阶段 9',
      title: '失败后迭代',
      status: hasRouterValidation || hasCostSensitivity ? 'done' : hasAllValidationRuns ? 'partial' : 'todo',
      summary: hasRouterValidation || hasCostSensitivity
        ? '复盘材料已经具备，可以按坏周 -> 坏日 -> 规则误伤顺序迭代。'
        : hasAllValidationRuns
          ? '验证结果已出来，下一步应该进入复盘和迭代，而不是继续盲目扩参数。'
          : '等待 rolling 验证结果，再决定是否进入迭代。',
      inputs: ['坏周清单', '坏日样本', '误伤样本', '回撤对比'],
      outputs: ['新一轮训练/规则修订计划'],
      gates: ['先查候选池', '再查周级', '再查日级', '不要盲目扩大参数空间'],
      evidence: [
        hasRouterValidation ? pipeline.reports.routerValidation.path : '尚无 router validation 报告',
        hasCostSensitivity ? pipeline.reports.costSensitivity.path : '尚无 cost sensitivity 报告'
      ],
      notes: '方法论明确要求失败时按固定顺序回查，不要直接写窄规则或无限扩网格。',
      actionKeys: ['review']
    }
  ];
}

export function getSuggestedStageKey(stages: readonly any[]): string {
  const runningStage = stages.find((stage: any) => stage.status === 'running');
  if (runningStage) {
    return runningStage.key;
  }

  const pendingStage = stages.find((stage: any) => stage.status !== 'done');
  if (pendingStage) {
    return pendingStage.key;
  }

  return stages[stages.length - 1]?.key || '';
}

function buildNextAction(training: any, validationRecords: readonly any[], reports: any, routerFiles: any): any {
  const costSensitivityPath = reports?.costSensitivity?.path || getArtifactPath(reports?.costSensitivity) || null;
  const featureCausalityPath = reports?.featureCausality?.path || getArtifactPath(reports?.featureCausality) || null;
  const routerValidationPath = reports?.routerValidation?.path || getArtifactPath(reports?.routerValidation) || null;
  const latestGenerateValidationRequest = training.latestGenerateValidationRequest || null;
  const hasActiveGenerateValidationRequest = isActiveRequestStatus(latestGenerateValidationRequest?.status);
  if (!training.trainingCompleted) {
    if (isActiveRequestStatus(training.latestRequest?.status)) {
      return {
        key: 'waiting-training',
        title: '等待 rolling training manifest 完成',
        reason: '训练请求已经在 worker 中执行，无需重复排队。',
        commands: []
      };
    }
    return {
      key: 'run-training',
      title: '先跑 rolling training manifest',
      reason: '数据库里还没有看到这个 training config 的完成记录。',
      commands: [
        '优先直接在 UI 中点击“运行训练”。如需 CLI 离线执行，请先从配置库导出对应 training config。'
      ]
    };
  }

  if (!training.topStrategySnapshot && hasActiveGenerateValidationRequest) {
    return {
      key: 'waiting-generate-validation',
      title: '等待 rolling package 生成',
      reason: 'worker 正在根据 training manifest 逐月学习 rolling 候选池 / mapping package 和 validation 配置。',
      commands: []
    };
  }

  if (!training.topStrategySnapshot) {
    return {
      key: 'generate-validation',
      title: '生成 rolling package 和 validation 配置',
      reason: 'training manifest 已完成，但数据库里还没有看到对应的 rolling 候选池 / mapping package。',
      commands: [
        '优先直接在 UI 中点击“下一步”，系统会把 rolling package 与 validation config 直接写入数据库；只有需要离线保存时再手动导出。'
      ]
    };
  }

  if (validationRecords.length === 0) {
    return {
      key: 'prepare-validation',
      title: '补生成 validation 配置',
      reason: 'rolling package 已存在，但数据库里还没有找到匹配的 validation 配置记录。',
      commands: [
        '重新触发一次“生成 Validation”，系统会把 validation config 和 rolling package 一起写入数据库。'
      ]
    };
  }

  const activeValidation = validationRecords
    .filter((item) => !item.latestRun && isActiveRequestStatus(item.latestRequest?.status))
    .sort((left, right) => getValidationPriority(left.validationProfile) - getValidationPriority(right.validationProfile))[0];
  if (activeValidation) {
    return {
      key: 'waiting-validation',
      title: `等待 Validation ${activeValidation.targetLabel}`,
      reason: 'validation 请求已经在 worker 中执行，无需重复排队。',
      commands: []
    };
  }

  const pendingValidation = validationRecords
    .filter((item) => !item.latestRun && !isActiveRequestStatus(item.latestRequest?.status))
    .sort((left, right) => getValidationPriority(left.validationProfile) - getValidationPriority(right.validationProfile))[0];
  if (pendingValidation) {
    return {
      key: 'run-validation',
      title: `跑验证 ${pendingValidation.targetLabel}`,
      reason: 'validation config 已存在，但该验证期还没有落库结果。',
      commands: [
        '优先直接在 UI 中点击“运行验证”。如需 CLI 离线执行，请先导出对应 validation config。'
      ]
    };
  }

  const latestValidation = validationRecords
    .filter((item) => item.latestRun)
    .sort((left, right) => new Date(right.latestRun.latestAt || 0).getTime() - new Date(left.latestRun.latestAt || 0).getTime())[0];

  if (!costSensitivityPath && latestValidation) {
    return {
      key: 'cost-sensitivity',
      title: '补跑成本敏感度报告',
      reason: '验证已经有结果，但还没有看到成本敏感度报告。',
      commands: [
        `docker compose run --rm train sh -lc "npm install && npm run build && npm run report:cost-sensitivity -- --config ${latestValidation.path}"`
      ]
    };
  }

  if (!featureCausalityPath) {
    const startDate = String(latestValidation?.timeRange?.startIso || training.timeRange?.startIso || '').slice(0, 10);
    const endDate = String(latestValidation?.timeRange?.endIso || training.timeRange?.endIso || '').slice(0, 10);
    return {
      key: 'feature-causality',
      title: '补跑因果特征审计',
      reason: '还没有看到这个交易对对应的 feature causality 报告。',
      commands: [
        `docker compose run --rm train sh -lc "npm install && npm run build && npm run audit:causal-features -- --symbol ${training.symbol} --start ${startDate} --end ${endDate} --openingMinutes 60"`
      ]
    };
  }

  if (!routerFiles.routerPath || !routerFiles.policyPath) {
    return {
      key: 'build-router',
      title: '补 router / policy catalog',
      reason: !routerFiles.routerPath
        ? '训练和验证已经跑通，但数据库里还没有看到可用的 router 配置。'
        : 'router 已存在，但 policy catalog 还没有同步落库完成。',
      commands: [
        '系统会按 rolling 训练结果自动维护 router 和 policy catalog，必要时也可以手动补跑 build-router'
      ]
    };
  }

  if (!routerValidationPath && latestValidation) {
    return {
      key: 'router-validate',
      title: '跑 router 验证',
      reason: 'router 已存在，但还没有看到 regime routing 验证报告。',
      commands: [
        `docker compose run --rm train sh -lc "npm install && npm run build && node dist/scripts/router-validate.js --validation ${latestValidation.path} --router ${routerFiles.routerPath}"`
      ]
    };
  }

  return {
      key: 'review',
      title: '进入结果复盘',
      reason: '主流程产物已经齐全，可以开始看报告和策略差异。',
      commands: [
      '先看 train_artifacts / analysis_artifacts 中的最新结构化产物，AI 总结 markdown 放在 train/reports/'
      ]
  };
}

async function getExistingTables(db: Queryable): Promise<Set<string>> {
  const [rows] = await db.query('SHOW TABLES');
  const tables = new Set<string>();

  for (const row of rows) {
    for (const value of Object.values(row)) {
      tables.add(String(value));
    }
  }

  return tables;
}

async function loadDbSummary(db: Queryable): Promise<any> {
  const result: any = {
    connected: false,
    warning: null,
    runMap: new Map(),
    taskMap: new Map(),
    latestRequestMap: new Map(),
    latestActionRequestMap: new Map(),
    artifacts: [],
    configRegistry: {
      training: [],
      validation: [],
      topStrategies: [],
      router: [],
      policy: []
    }
  };

  try {
    await db.query("SET NAMES 'utf8mb4'");
    const tables = await getExistingTables(db);
    result.connected = true;

    if (tables.has('backtest_results')) {
      const [rows] = await db.query(`
        SELECT
          result_group,
          mode,
          run_id,
          config_name,
          symbol,
          COUNT(*) AS strategy_count,
          MAX(score) AS best_score,
          MAX(total_pnl) AS best_total_pnl,
          MAX(updated_at) AS latest_at,
          MAX(created_at) AS created_at
        FROM backtest_results
        GROUP BY result_group, mode, run_id, config_name, symbol
        ORDER BY latest_at DESC
      `);

      for (const row of rows) {
        const resultGroup = String(row.result_group || '');
        const mode = String(row.mode || 'unknown');
        const existing = result.runMap.get(resultGroup) || {};
        if (!existing[mode]) {
          existing[mode] = {
            runId: String(row.run_id || ''),
            configName: row.config_name ? String(row.config_name) : null,
            symbol: row.symbol ? String(row.symbol) : null,
            strategyCount: Number(row.strategy_count || 0),
            bestScore: row.best_score == null ? null : Number(row.best_score),
            bestTotalPnl: row.best_total_pnl == null ? null : Number(row.best_total_pnl),
            latestAt: formatIso(row.latest_at),
            createdAt: formatIso(row.created_at)
          };
          result.runMap.set(resultGroup, existing);
        }
      }
    }

    if (tables.has('tasks')) {
      const [rows] = await db.query(`
        SELECT
          task_id,
          config_name,
          description,
          status,
          started_at,
          completed_at,
          created_at
        FROM tasks
        ORDER BY created_at DESC
      `);

      for (const row of rows) {
        const configName = String(row.config_name || '');
        if (!configName || result.taskMap.has(configName)) {
          continue;
        }

        result.taskMap.set(configName, {
          taskId: String(row.task_id || ''),
          configName,
          description: row.description ? String(row.description) : null,
          status: String(row.status || 'unknown'),
          startedAt: formatIso(row.started_at),
          completedAt: formatIso(row.completed_at),
          createdAt: formatIso(row.created_at)
        });
      }
    }

    if (tables.has('train_run_requests')) {
      const [rows] = await db.query(`
        SELECT *
        FROM train_run_requests
        ORDER BY created_at DESC, id DESC
      `);

      for (const row of rows) {
        const configKey = String(row.config_key || '');
        const action = String(row.action || '');
        if (!configKey) {
          continue;
        }

        if (!result.latestRequestMap.has(configKey)) {
          result.latestRequestMap.set(configKey, toRequestSummary(row));
        }

        const actionKey = `${configKey}::${action}`;
        if (!result.latestActionRequestMap.has(actionKey)) {
          result.latestActionRequestMap.set(actionKey, toRequestSummary(row));
        }
      }
    }

    if (tables.has(TRAIN_ARTIFACTS_TABLE)) {
      const [rows] = await db.query(`
        SELECT
          id,
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
          metadata_json,
          created_at,
          updated_at
        FROM ${TRAIN_ARTIFACTS_TABLE}
        ORDER BY updated_at DESC, id DESC
      `);

      result.artifacts = rows.map((row: any) => ({
        id: Number(row.id || 0),
        artifactKey: String(row.artifact_key || ''),
        artifactType: String(row.artifact_type || ''),
        trainId: row.train_id ? String(row.train_id) : null,
        configId: row.config_id == null ? null : Number(row.config_id),
        configKey: row.config_key ? String(row.config_key) : null,
        symbol: row.symbol ? String(row.symbol) : null,
        intervalType: row.interval_type ? String(row.interval_type) : null,
        periodStartMs: row.period_start_ms == null ? null : Number(row.period_start_ms),
        periodEndMs: row.period_end_ms == null ? null : Number(row.period_end_ms),
        reportPath: row.report_path ? String(row.report_path) : null,
        summaryPath: row.summary_path ? String(row.summary_path) : null,
        summaryMarkdown: row.summary_markdown ? String(row.summary_markdown) : null,
        payload: parseMaybeJson(row.payload_json),
        metadata: parseMaybeJson(row.metadata_json),
        createdAt: formatIso(row.created_at),
        updatedAt: formatIso(row.updated_at)
      }));
    }

    if (tables.has('train_configs')) {
      const [rows] = await db.query(`
        SELECT
          tc.id,
          tc.config_key,
          tc.config_type,
          tc.config_name,
          tc.symbol,
          tc.interval_type,
          tc.result_group,
          tc.source_table,
          tc.train_config_ref,
          tc.training_year,
          tc.updated_at,
          ${buildTrainConfigContentSelectSql()}
        FROM train_configs tc
        ${buildTrainConfigDetailJoinsSql('tc')}
        WHERE tc.status = 'active'
        ORDER BY tc.config_key ASC
      `);

      const rollingPoolMap = new Map<number, any[]>();
      const rollingRuleMap = new Map<number, any[]>();

      if (tables.has(ROLLING_POOL_DETAILS_TABLE)) {
        const [poolRows] = await db.query(`
          SELECT config_id, month_key, feature_bucket, selected_strategy_name, action_type, risk_cap, top_strategies_json
          FROM ${ROLLING_POOL_DETAILS_TABLE}
          ORDER BY month_key ASC, id ASC
        `);

        for (const poolRow of poolRows) {
          const configId = Number(poolRow.config_id || 0);
          const items = rollingPoolMap.get(configId) || [];
          items.push({
            month: String(poolRow.month_key || ''),
            featureBucket: poolRow.feature_bucket ? String(poolRow.feature_bucket) : null,
            selectedStrategyName: poolRow.selected_strategy_name ? String(poolRow.selected_strategy_name) : null,
            actionType: poolRow.action_type ? String(poolRow.action_type) : null,
            riskCap: poolRow.risk_cap == null ? null : Number(poolRow.risk_cap),
            topStrategies: parseMaybeJson(poolRow.top_strategies_json) || []
          });
          rollingPoolMap.set(configId, items);
        }
      }

      if (tables.has(ROLLING_RULE_DETAILS_TABLE)) {
        const [ruleRows] = await db.query(`
          SELECT config_id, layer_key, rule_id, priority_no, feature_bucket, strategy_key, strategy_name, action_type, risk_cap, risk_multiplier, rationale, rule_json
          FROM ${ROLLING_RULE_DETAILS_TABLE}
          ORDER BY layer_key ASC, priority_no ASC, id ASC
        `);

        for (const ruleRow of ruleRows) {
          const configId = Number(ruleRow.config_id || 0);
          const items = rollingRuleMap.get(configId) || [];
          items.push({
            layerKey: String(ruleRow.layer_key || ''),
            ruleId: String(ruleRow.rule_id || ''),
            priority: Number(ruleRow.priority_no || 0),
            featureBucket: ruleRow.feature_bucket ? String(ruleRow.feature_bucket) : null,
            strategyKey: ruleRow.strategy_key ? String(ruleRow.strategy_key) : null,
            strategyName: ruleRow.strategy_name ? String(ruleRow.strategy_name) : null,
            actionType: ruleRow.action_type ? String(ruleRow.action_type) : null,
            riskCap: ruleRow.risk_cap == null ? null : Number(ruleRow.risk_cap),
            riskMultiplier: ruleRow.risk_multiplier == null ? null : Number(ruleRow.risk_multiplier),
            rationale: ruleRow.rationale ? String(ruleRow.rationale) : null,
            rule: parseMaybeJson(ruleRow.rule_json)
          });
          rollingRuleMap.set(configId, items);
        }
      }

      for (const row of rows) {
        const configId = Number(row.id || 0);
        const entry = {
          id: configId,
          configKey: String(row.config_key || ''),
          fileName: path.basename(String(row.config_key || '')),
          configType: String(row.config_type || ''),
          configName: row.config_name ? String(row.config_name) : null,
          symbol: row.symbol ? String(row.symbol) : null,
          intervalType: row.interval_type ? String(row.interval_type) : null,
          resultGroup: row.result_group ? String(row.result_group) : null,
          sourceTable: row.source_table ? String(row.source_table) : null,
          trainConfigRef: row.train_config_ref ? String(row.train_config_ref) : null,
          trainingYear: row.training_year ? String(row.training_year) : null,
          updatedAt: formatIso(row.updated_at),
          content: parseMaybeJson(row.content),
          rollingDetails: {
            monthlyPools: rollingPoolMap.get(configId) || [],
            rules: rollingRuleMap.get(configId) || []
          }
        };

        if (entry.configType === 'training') {
          result.configRegistry.training.push(entry);
        } else if (entry.configType === 'validation') {
          result.configRegistry.validation.push(entry);
        } else if (entry.configType === 'top-strategies') {
          result.configRegistry.topStrategies.push(entry);
        } else if (entry.configType === 'router') {
          result.configRegistry.router.push(entry);
        } else if (entry.configType === 'policy') {
          result.configRegistry.policy.push(entry);
        }
      }
    }
  } catch (error) {
    result.warning = error instanceof Error ? error.message : String(error);
  }

  return result;
}

export async function buildTrainingPipelineSummary(options: BuildTrainingPipelineSummaryOptions): Promise<any> {
  const { db, repoRoot, trainRoot } = options;
  const routerConfigDir = path.join(trainRoot, 'configs', 'generated', 'regime-routing');

  const dbSummary = await loadDbSummary(db);
  const trainingEntries = dbSummary.configRegistry.training
    .map((entry: any) => ({
      path: entry.configKey,
      fileName: entry.fileName,
      config: entry.content,
      updatedAt: entry.updatedAt
    }));

  const validationEntries = dbSummary.configRegistry.validation
    .map((entry: any) => ({
      path: entry.configKey,
      fileName: entry.fileName,
      fullPath: null,
      config: entry.content
    }));

  const topStrategyEntries = dbSummary.configRegistry.topStrategies
    .map((entry: any) => ({
      fullPath: entry.configKey,
      fileName: entry.fileName,
      data: {
        ...(entry.content || {}),
        rollingDetails: entry.rollingDetails || null
      },
      stat: {
        mtime: entry.updatedAt,
        mtimeMs: new Date(entry.updatedAt || 0).getTime()
      }
    }));

  const routerRegistryKeys = [
    ...dbSummary.configRegistry.router.map((entry: any) => entry.configKey),
    ...dbSummary.configRegistry.policy.map((entry: any) => entry.configKey)
  ];
  const routerFiles = routerRegistryKeys.length > 0
    ? routerRegistryKeys
    : listFiles(routerConfigDir, (filePath) => filePath.endsWith('.json'));
  const artifactRows = Array.isArray(dbSummary.artifacts) ? dbSummary.artifacts : [];

  const pipelines = trainingEntries.map((trainingEntry: any) => {
    const config = trainingEntry.config;
    const fileName = trainingEntry.fileName;

    if (!config) {
      return {
        id: fileName,
        fileName,
        configError: true
      };
    }

    const resultGroup = String(config.database?.tableName || '').trim();
    const symbol = String(config.market?.symbol || 'UNKNOWN').toUpperCase();
    const trainingYear = getYearFromConfig(config, fileName);
    const trainId = extractTrainId(config);
    const topN = Number(config.output?.topN || 10);
    const runBucket = dbSummary.runMap.get(resultGroup) || {};
    const trainingRun = runBucket.training || null;
    const latestTask = dbSummary.taskMap.get(String(config.name || '')) || null;
    const trainingLatestRequest = dbSummary.latestRequestMap.get(trainingEntry.path) || null;
    const latestGenerateValidationRequest = dbSummary.latestActionRequestMap.get(`${trainingEntry.path}::generate-validation`) || null;
    const generateValidationRunning = isActiveRequestStatus(latestGenerateValidationRequest?.status);

    const snapshotMatch = topStrategyEntries
      .filter((entry: any) => {
        const trainConfigRef = normalizeText(entry.data?.trainConfig || entry.data?.train_config_ref);
        return trainConfigRef.endsWith(normalizeText(trainingEntry.path))
          || trainConfigRef.endsWith(normalizeText(`configs/training/${fileName}`))
          || normalizeText(entry.data?.sourceTable) === normalizeText(resultGroup);
      })
      .sort((left: any, right: any) => (right.stat?.mtimeMs || 0) - (left.stat?.mtimeMs || 0))[0] || null;
    const snapshotArtifactMatch = !snapshotMatch
      ? pickLatestArtifact(artifactRows, (artifact) => {
          if (normalizeText(artifact?.symbol) !== normalizeText(symbol)) {
            return false;
          }
          if (trainId && String(artifact?.trainId || '') !== trainId) {
            return false;
          }
          return Boolean(extractRollingPackageArtifact(artifact));
        })
      : null;

    const trainingCompleted = hasTrainingCompleted({
      trainingRun,
      latestRequest: trainingLatestRequest,
      latestTask,
      latestGenerateValidationRequest,
      topStrategySnapshot: snapshotMatch
    });

    const matchedValidations = validationEntries
      .filter((entry: any) => !entry.config?.draftFromTraining)
      .filter((entry: any) => matchValidationToTraining({
        symbol,
        trainingYear,
        fileName
      }, entry))
      .map((entry: any) => {
        const validationResultGroup = String(entry.config.database?.tableName || '').trim();
        const validationRunBucket = dbSummary.runMap.get(validationResultGroup) || {};
        const validationProfile = getValidationProfile(entry.config, entry.fileName);
        return {
          name: entry.config.name,
          path: entry.path,
          validationProfile,
          resultGroup: validationResultGroup,
          targetLabel: getValidationTargetLabel(entry.config, entry.fileName),
          timeRange: {
            startIso: entry.config.timeRange?.startIso || formatIso(entry.config.timeRange?.startTimeMs),
            endIso: entry.config.timeRange?.endIso || formatIso(entry.config.timeRange?.endTimeMs)
          },
          latestRun: validationRunBucket.validation || null,
          latestRequest: dbSummary.latestRequestMap.get(entry.path) || null,
          latestTask: dbSummary.taskMap.get(String(entry.config.name || '')) || null
        };
      })
      .sort((left: any, right: any) => {
        const priorityDiff = getValidationPriority(left.validationProfile) - getValidationPriority(right.validationProfile);
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        return String(left.targetLabel).localeCompare(String(right.targetLabel));
      });

    const hasActiveValidationRequest = matchedValidations.some((item: any) => isActiveRequestStatus(item.latestRequest?.status));
    const validationConfigKeys = matchedValidations.map((item: any) => String(item.path || ''));

    const routerConfigRef = config.regimeRouting?.routerConfigPath || null;
    const normalizedRouterConfigRef = routerConfigRef
      ? normalizeText(path.posix.normalize(path.posix.join(path.posix.dirname(trainingEntry.path), routerConfigRef)))
      : null;
    const routerPath = normalizedRouterConfigRef
      ? routerFiles.find((item: string) => normalizeText(String(item)).endsWith(normalizedRouterConfigRef))
        || routerFiles.find((item: string) => normalizeText(String(item)).endsWith(normalizeText(String(routerConfigRef))))
        || null
      : null;
    const policyPath = routerPath
      ? String(routerPath).replace(/\.json$/i, '.policy.json')
      : null;
    const policyExists = policyPath
      ? routerFiles.some((item: string) => normalizeText(String(item)) === normalizeText(policyPath))
        || fs.existsSync(path.join(repoRoot, policyPath))
      : false;

    const matchesArtifact = (artifact: any, type: string): boolean => {
      if (String(artifact?.artifactType || '') !== type) {
        return false;
      }
      if (normalizeText(artifact?.symbol) !== normalizeText(symbol)) {
        return false;
      }
      if (trainId && String(artifact?.trainId || '') === trainId) {
        return true;
      }
      if (type === 'goal-tracking' && String(artifact?.configKey || '') === String(trainingEntry.path || '')) {
        return true;
      }
      if ((type === 'cost-sensitivity' || type === 'router-validation')
        && validationConfigKeys.includes(String(artifact?.configKey || ''))) {
        return true;
      }
      if (type === 'feature-causality' && !trainId) {
        return true;
      }
      return false;
    };

    const reportSummary = {
      costSensitivity: pickLatestArtifact(artifactRows, (artifact) => matchesArtifact(artifact, 'cost-sensitivity')),
      featureCausality: pickLatestArtifact(artifactRows, (artifact) => matchesArtifact(artifact, 'feature-causality')),
      routerValidation: pickLatestArtifact(artifactRows, (artifact) => matchesArtifact(artifact, 'router-validation')),
      goalTracking: pickLatestArtifact(artifactRows, (artifact) => matchesArtifact(artifact, 'goal-tracking')),
      aiSummary: pickLatestArtifact(artifactRows, (artifact) => {
        if (String(artifact?.artifactType || '') !== 'ai-summary') {
          return false;
        }
        if (trainId && String(artifact?.trainId || '') === trainId) {
          return true;
        }
        return String(artifact?.configKey || '') === String(trainingEntry.path || '');
      })
    };

    const steps = [
      {
        key: 'training-config',
        title: 'Training Config',
        status: 'done',
        detail: trainingEntry.path
      },
      {
        key: 'training-run',
        title: 'Training Run',
        status: isActiveRequestStatus(trainingLatestRequest?.status)
          ? 'running'
          : latestTask?.status === 'running'
            ? 'running'
            : buildStatus(trainingCompleted),
        detail: trainingRun
          ? `${trainingRun.strategyCount} strategies · latest ${trainingRun.latestAt || 'n/a'}`
          : trainingCompleted
            ? `manifest completed · ${trainingLatestRequest?.requestId || latestTask?.taskId || 'n/a'}`
          : trainingLatestRequest
            ? `queue ${trainingLatestRequest.status}`
            : '尚未落库'
      },
      {
        key: 'top-strategies',
        title: 'Rolling Package',
        status: generateValidationRunning ? 'running' : buildStatus(Boolean(snapshotMatch)),
        detail: snapshotMatch
          ? (String(snapshotMatch.fullPath).startsWith('/')
            ? toRepoRelative(repoRoot, snapshotMatch.fullPath)
            : String(snapshotMatch.fullPath))
          : generateValidationRunning
            ? `queue ${latestGenerateValidationRequest.status}`
            : '尚未生成'
      },
      {
        key: 'validation-config',
        title: 'Validation Configs',
        status: generateValidationRunning
          ? 'running'
          : buildStatus(matchedValidations.length > 0),
        detail: matchedValidations.length > 0
          ? `${matchedValidations.length} records`
          : generateValidationRunning
            ? '派生生成中'
            : '未找到'
      },
      {
        key: 'validation-run',
        title: 'Validation Runs',
        status: hasActiveValidationRequest
          ? 'running'
          : buildStatus(
            matchedValidations.length > 0 && matchedValidations.every((item: any) => Boolean(item.latestRun)),
            matchedValidations.some((item: any) => Boolean(item.latestRun))
          ),
        detail: matchedValidations.length > 0
          ? matchedValidations
            .map((item: any) => `${item.targetLabel}:${item.latestRequest?.status || (item.latestRun ? 'done' : 'todo')}`)
            .join(' | ')
          : '等待 validation config'
      },
      {
        key: 'cost-sensitivity',
        title: 'Cost Report',
        status: buildStatus(Boolean(reportSummary.costSensitivity)),
        detail: getArtifactPath(reportSummary.costSensitivity) || '未找到'
      },
      {
        key: 'feature-causality',
        title: 'Causal Audit',
        status: buildStatus(Boolean(reportSummary.featureCausality)),
        detail: getArtifactPath(reportSummary.featureCausality) || '未找到'
      },
      {
        key: 'router',
        title: 'Router / Policy',
        status: buildStatus(Boolean(routerPath && policyExists), Boolean(routerPath || policyExists)),
        detail: routerPath ? `${routerPath}${policyExists ? ' + policy' : ''}` : '未配置'
      },
      {
        key: 'router-validation',
        title: 'Router Validation',
        status: buildStatus(Boolean(reportSummary.routerValidation)),
        detail: getArtifactPath(reportSummary.routerValidation) || '未找到'
      },
      {
        key: 'goal-tracking',
        title: 'Goal Tracking',
        status: buildStatus(Boolean(reportSummary.goalTracking)),
        detail: getArtifactPath(reportSummary.goalTracking) || '未找到'
      },
      {
        key: 'ai-summary',
        title: 'AI Summary',
        status: buildStatus(Boolean(reportSummary.aiSummary)),
        detail: getArtifactPath(reportSummary.aiSummary) || '未找到'
      }
    ];

    const topStrategySnapshot = snapshotMatch ? {
      path: String(snapshotMatch.fullPath).startsWith('/')
        ? toRepoRelative(repoRoot, snapshotMatch.fullPath)
        : String(snapshotMatch.fullPath),
      configName: snapshotMatch.data.name || null,
      generatedAt: snapshotMatch.data.generatedAt || formatIso(snapshotMatch.stat?.mtime),
      sourceRunId: snapshotMatch.data.sourceRunId || null,
      limit: snapshotMatch.data.limit || null,
      exact: Boolean(snapshotMatch.data.exact),
      rollingPlan: {
        monthlyPools: Array.isArray(snapshotMatch.data?.rollingPlan?.monthlyPools)
          ? snapshotMatch.data.rollingPlan.monthlyPools
          : Array.isArray(snapshotMatch.data?.rollingDetails?.monthlyPools)
            ? snapshotMatch.data.rollingDetails.monthlyPools
          : [],
        rules: snapshotMatch.data?.rollingPlan?.rules || {},
        normalizedRules: snapshotMatch.data?.rollingDetails?.rules || []
      }
    } : buildTopStrategySnapshotFromArtifact(snapshotArtifactMatch);

    const reports = {
      costSensitivity: toArtifactSummary(reportSummary.costSensitivity, repoRoot),
      featureCausality: toArtifactSummary(reportSummary.featureCausality, repoRoot),
      routerValidation: toArtifactSummary(reportSummary.routerValidation, repoRoot),
      goalTracking: toArtifactSummary(reportSummary.goalTracking, repoRoot),
      aiSummary: toArtifactSummary(reportSummary.aiSummary, repoRoot)
    };

    const router = {
      routerPath,
      policyPath: policyExists ? policyPath : null
    };

    const nextAction = buildNextAction({
      fileName,
      name: config.name,
      symbol,
      resultGroup,
      timeRange: config.timeRange,
      validationPlan: config.validationPlan || null,
      latestRequest: trainingLatestRequest,
      latestTask,
      trainingCompleted,
      trainingRun,
      topStrategySnapshot,
      latestGenerateValidationRequest,
      topN,
      trainingYear
    }, matchedValidations, reportSummary, router);

    const pipeline = {
      id: fileName.replace(/\.json$/i, ''),
      name: config.name,
      description: config.description || '',
      symbol,
      intervalType: config.market?.intervalType || null,
      trainingYear,
      topN,
      resultGroup,
      trainingConfigPath: trainingEntry.path,
      configUpdatedAt: trainingEntry.updatedAt || null,
      timeRange: {
        startIso: config.timeRange?.startIso || formatIso(config.timeRange?.startTimeMs),
        endIso: config.timeRange?.endIso || formatIso(config.timeRange?.endTimeMs)
      },
      latestTask,
      latestRequest: trainingLatestRequest,
      latestGenerateValidationRequest,
      trainId,
      trainingCompleted,
      trainingRun,
      topStrategySnapshot,
      validationConfigs: matchedValidations,
      router,
      reports,
      steps,
      nextAction
    };

    const methodologyStages = buildMethodologyStages(pipeline, config);
    const finalConfigState = buildFinalConfigState(pipeline);

    return {
      ...pipeline,
      finalConfigState,
      methodologyStages,
      suggestedStageKey: getSuggestedStageKey(methodologyStages)
    };
  }).sort((left: any, right: any) => String(right.trainingYear || '').localeCompare(String(left.trainingYear || '')));

  return {
    generatedAt: new Date().toISOString(),
    meta: {
      dbConnected: dbSummary.connected,
      dbWarning: dbSummary.warning,
      trainingConfigCount: pipelines.length
    },
    data: pipelines
  };
}
