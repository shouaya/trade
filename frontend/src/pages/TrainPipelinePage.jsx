import { useEffect, useState } from 'react';
import { trainConfigsAPI, trainPipelineAPI, trainRunRequestsAPI } from '../api/api';
import './TrainPipelinePage.css';

const statusLabelMap = {
  done: '已完成',
  partial: '部分完成',
  todo: '待执行',
  running: '执行中',
};

const configTypeOptions = [
  { value: 'training', label: 'Training' },
];

const DEFAULT_TRAINING_RUN_TAG = 'V7_HF_RSI_MACD_TP_ATR';
const DEFAULT_VALIDATION_PROFILE = 'rolling-window';
const ROUTER_LAYER_KEYS = ['monthly_guard', 'weekly_guard', 'daily_router', 'loss_recheck'];
const ROUTER_ACTION_TYPES = ['trade', 'reduce', 'stop'];

const EMPTY_TRAINING_GUIDE_META = {
  recommendations: [],
  options: {
    trainingYears: [],
    symbols: [],
    intervalTypes: [],
    strategyTypes: [],
    topNValues: [],
    lotSizes: [],
    holdMinValues: [],
    holdMaxValues: [],
    tradingSchedules: []
  },
  validationProfiles: []
};

const EMPTY_TRAINING_GUIDE_DRAFT = {
  year: '',
  symbol: '',
  runTag: '',
  startDate: '',
  endDate: '',
  intervalType: '',
  topN: 10,
  strategyTypes: '',
  lotSize: '',
  maxHoldMin: '',
  maxHoldMax: '',
  tradingSchedule: '',
  tableName: '',
  routerConfigPath: '',
  validationProfile: DEFAULT_VALIDATION_PROFILE,
  validationStartDate: '',
  validationEndDate: '',
  configKey: ''
};

function normalizeValidationProfile(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'rolling-window' || normalized === 'custom-range') {
    return normalized;
  }
  return DEFAULT_VALIDATION_PROFILE;
}

function getValidationProfileLabel(value) {
  switch (normalizeValidationProfile(value)) {
    case 'rolling-window':
      return 'Rolling 主验证';
    case 'custom-range':
      return '自定义区间';
    default:
      return 'Rolling 主验证';
  }
}

function getValidationProfileTone(value) {
  switch (normalizeValidationProfile(value)) {
    case 'rolling-window':
      return 'done';
    case 'custom-range':
      return 'partial';
    default:
      return 'todo';
  }
}

function safeParseJsonText(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringifyPrettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function formatDateTime(value) {
  if (!value) {
    return 'n/a';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatCompactNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 'n/a';
  }

  return numeric.toFixed(digits);
}

function summarizeRuleBuckets(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '未生成';
  }

  return items
    .slice(0, 4)
    .map((item) => {
      const whenValue = item?.rule?.when || item?.when;
      return buildRouterPolicyFeatureSummary(whenValue);
    })
    .filter(Boolean)
    .join(' · ');
}

function getLayerLabel(layerKey) {
  switch (String(layerKey || '')) {
    case 'monthly_guard':
      return 'Monthly';
    case 'weekly_guard':
      return 'Weekly';
    case 'daily_router':
      return 'Daily';
    case 'loss_recheck':
      return 'Loss';
    default:
      return layerKey || 'Layer';
  }
}

function normalizeStrategyCatalog(strategyCatalog) {
  return isPlainObject(strategyCatalog) ? strategyCatalog : {};
}

function normalizeRouterLayer(layerKey) {
  return ROUTER_LAYER_KEYS.includes(String(layerKey || ''))
    ? String(layerKey)
    : 'monthly_guard';
}

function getRouterRuleFeatureBucket(rule) {
  const when = isPlainObject(rule?.when) ? rule.when : {};
  const featureBucket = Array.isArray(when.featureBucket)
    ? when.featureBucket[0]
    : when.featureBucket;
  const previousDayFeatureBucket = Array.isArray(when.previousDayFeatureBucket)
    ? when.previousDayFeatureBucket[0]
    : when.previousDayFeatureBucket;

  return String(featureBucket || previousDayFeatureBucket || '').trim();
}

function setRouterRuleFeatureBucket(whenValue, featureBucket) {
  const nextWhen = isPlainObject(whenValue) ? { ...whenValue } : {};
  delete nextWhen.featureBucket;
  delete nextWhen.previousDayFeatureBucket;

  const normalized = String(featureBucket || '').trim();
  if (normalized) {
    nextWhen.featureBucket = [normalized];
  }

  return Object.keys(nextWhen).length > 0 ? nextWhen : undefined;
}

function normalizeNumericValue(value) {
  if (value === '' || value == null) {
    return undefined;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function createRouterRuleId(layerKey) {
  return `${normalizeRouterLayer(layerKey)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRouterRule(rule, index) {
  const baseRule = isPlainObject(rule) ? rule : {};
  const layer = normalizeRouterLayer(baseRule.layer);
  const action = isPlainObject(baseRule.action) ? baseRule.action : {};
  const actionType = ROUTER_ACTION_TYPES.includes(String(action.type || ''))
    ? String(action.type)
    : 'trade';
  const strategyKey = String(action.strategyKey || '').trim();
  const riskCap = normalizeNumericValue(action.riskCap);
  const riskMultiplier = normalizeNumericValue(action.riskMultiplier);
  const nextWhen = setRouterRuleFeatureBucket(baseRule.when, getRouterRuleFeatureBucket(baseRule));

  return {
    ...baseRule,
    id: String(baseRule.id || createRouterRuleId(layer)),
    layer,
    priority: index + 1,
    ...(nextWhen ? { when: nextWhen } : {}),
    ...(!nextWhen && 'when' in baseRule ? { when: undefined } : {}),
    action: {
      type: actionType,
      ...(actionType !== 'stop' && strategyKey ? { strategyKey } : {}),
      ...(actionType !== 'stop' && riskCap != null ? { riskCap } : {}),
      ...(actionType !== 'stop' && riskMultiplier != null ? { riskMultiplier } : {})
    },
    ...(baseRule.rationale ? { rationale: String(baseRule.rationale) } : {})
  };
}

function normalizeRouterContent(routerContent) {
  const content = isPlainObject(routerContent) ? routerContent : {};
  const executionModel = isPlainObject(content.executionModel) ? content.executionModel : {};
  const defaultFallbackSource = isPlainObject(executionModel.defaultFallback) ? executionModel.defaultFallback : {};
  const defaultFallback = {
    action: defaultFallbackSource.action === 'reduce' ? 'reduce' : 'trade',
    riskMultiplier: normalizeNumericValue(defaultFallbackSource.riskMultiplier) ?? 1,
    ...(String(defaultFallbackSource.strategyKey || '').trim()
      ? { strategyKey: String(defaultFallbackSource.strategyKey).trim() }
      : {})
  };

  return {
    ...content,
    strategyCatalog: normalizeStrategyCatalog(content.strategyCatalog),
    executionModel: {
      ...executionModel,
      precedence: Array.isArray(executionModel.precedence) && executionModel.precedence.length > 0
        ? executionModel.precedence
        : ROUTER_LAYER_KEYS,
      defaultFallback
    },
    rules: Array.isArray(content.rules)
      ? content.rules.map((rule, index) => normalizeRouterRule(rule, index))
      : []
  };
}

function summarizeConditionValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join('/') : null;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue != null)
      .map(([key, entryValue]) => `${key}:${entryValue}`);
    return entries.length > 0 ? entries.join(', ') : null;
  }

  return value == null || value === '' ? null : String(value);
}

function buildRouterPolicyFeatureSummary(whenValue) {
  if (!isPlainObject(whenValue)) {
    return 'fallback';
  }

  const segments = Object.entries(whenValue)
    .map(([key, value]) => {
      const summary = summarizeConditionValue(value);
      return summary ? `${key}=${summary}` : null;
    })
    .filter(Boolean);

  return segments.length > 0 ? segments.join(' | ') : 'fallback';
}

function buildRouterPolicyEventSegment(rule) {
  const when = isPlainObject(rule?.when) ? rule.when : {};
  const featureBucket = Array.isArray(when.featureBucket) && when.featureBucket.length > 0
    ? when.featureBucket.join('/')
    : Array.isArray(when.previousDayFeatureBucket) && when.previousDayFeatureBucket.length > 0
      ? `prev:${when.previousDayFeatureBucket.join('/')}`
      : null;

  if (featureBucket) {
    return featureBucket;
  }

  return rule?.layer === 'loss_recheck'
    ? 'loss-feedback'
    : normalizeRouterLayer(rule?.layer);
}

function buildPolicyContentFromRouter(routerContent, routerConfigKey) {
  const normalizedRouter = normalizeRouterContent(routerContent);
  const strategyCatalog = normalizedRouter.strategyCatalog;
  const defaultFallback = normalizedRouter.executionModel?.defaultFallback;
  const defaultStrategy = defaultFallback?.strategyKey
    ? strategyCatalog[defaultFallback.strategyKey]
    : null;

  const entries = normalizedRouter.rules.map((rule) => {
    const strategyKey = String(rule?.action?.strategyKey || '').trim();
    const strategyRef = strategyKey ? strategyCatalog[strategyKey] : null;
    return {
      eventSegment: buildRouterPolicyEventSegment(rule),
      layer: normalizeRouterLayer(rule.layer),
      ruleId: String(rule.id || ''),
      featureSummary: buildRouterPolicyFeatureSummary(rule.when),
      actionType: rule.action?.type || 'trade',
      ...(rule.action?.riskCap != null ? { riskCap: Number(rule.action.riskCap) } : {}),
      ...(rule.action?.riskMultiplier != null ? { riskMultiplier: Number(rule.action.riskMultiplier) } : {}),
      ...(strategyRef && strategyKey
        ? {
            strategy: {
              strategyKey,
              strategyLabel: strategyRef.shortLabel,
              strategyName: strategyRef.strategyName
            }
          }
        : {}),
      ...(rule.rationale ? { rationale: String(rule.rationale) } : {})
    };
  });

  return {
    symbol: String(normalizedRouter.symbol || 'BTCJPY').toUpperCase(),
    routerVersion: String(normalizedRouter.routerVersion || 'router_v1'),
    catalogVersion: `${String(normalizedRouter.routerVersion || 'router_v1')}_policy_v1`,
    generatedDate: new Date().toISOString(),
    source: {
      routerConfigPath: String(routerConfigKey || 'router.json').split('/').pop(),
      notes: ['Synced from Router Studio form editor']
    },
    ...(defaultFallback && defaultStrategy
      ? {
          defaultFallback: {
            action: defaultFallback.action,
            riskMultiplier: Number(defaultFallback.riskMultiplier ?? 1),
            strategy: {
              strategyKey: defaultFallback.strategyKey,
              strategyLabel: defaultStrategy.shortLabel,
              strategyName: defaultStrategy.strategyName
            }
          }
        }
      : {}),
    eventSegments: entries.filter((entry) => entry.layer === 'monthly_guard' || entry.layer === 'weekly_guard'),
    dailyGuards: entries.filter((entry) => entry.layer === 'daily_router' || entry.layer === 'loss_recheck')
  };
}

function updateRouterRules(routerContent, updater) {
  const normalizedRouter = normalizeRouterContent(routerContent);
  const nextRules = updater(normalizedRouter.rules.map((rule) => ({ ...rule })));
  return {
    ...normalizedRouter,
    rules: (Array.isArray(nextRules) ? nextRules : normalizedRouter.rules)
      .map((rule, index) => normalizeRouterRule(rule, index))
  };
}

function buildLayerEditorGroups(rules) {
  const entries = (Array.isArray(rules) ? rules : []).map((rule, index) => ({
    index,
    rule,
    layerKey: normalizeRouterLayer(rule?.layer)
  }));

  return ROUTER_LAYER_KEYS.map((layerKey) => ({
    layerKey,
    label: getLayerLabel(layerKey),
    items: entries.filter((entry) => entry.layerKey === layerKey)
  }));
}

function createEmptyRouterRule(layerKey) {
  return normalizeRouterRule({
    id: createRouterRuleId(layerKey),
    layer: normalizeRouterLayer(layerKey),
    when: {
      featureBucket: ['neutral']
    },
    action: {
      type: layerKey === 'loss_recheck' ? 'reduce' : 'trade',
      riskMultiplier: layerKey === 'monthly_guard' || layerKey === 'weekly_guard' ? 1 : 0.5
    },
    rationale: ''
  }, 0);
}

function buildLayerRuleGroups(items) {
  const groups = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const layerKey = String(item?.layerKey || item?.layer || '');
    const bucket = groups.get(layerKey) || [];
    bucket.push(item);
    groups.set(layerKey, bucket);
  });

  return ['monthly_guard', 'weekly_guard', 'daily_router', 'loss_recheck']
    .filter((layerKey) => groups.has(layerKey))
    .map((layerKey) => ({
      layerKey,
      label: getLayerLabel(layerKey),
      items: groups.get(layerKey) || []
    }));
}

function RollingPackagePanel({ snapshot }) {
  const [expandedMonths, setExpandedMonths] = useState({});
  const monthlyPools = snapshot?.rollingPlan?.monthlyPools || [];
  const normalizedRules = snapshot?.rollingPlan?.normalizedRules || [];
  const monthlyRuleCount = normalizedRules.filter((item) => item.layerKey === 'monthly_guard').length;
  const weeklyRuleCount = normalizedRules.filter((item) => item.layerKey === 'weekly_guard').length;
  const dailyRuleCount = normalizedRules.filter((item) => item.layerKey === 'daily_router').length;
  const lossRuleCount = normalizedRules.filter((item) => item.layerKey === 'loss_recheck').length;

  if (!snapshot) {
    return (
      <div className="results-panel-card">
        <span>Rolling Package</span>
        <strong>尚未生成</strong>
        <em>等待 generate-validation 完成后再查看月线 / 周线 / 日线细节。</em>
      </div>
    );
  }

  return (
    <div className="results-panel-card">
      <span>Rolling Package</span>
      <strong>{monthlyPools.length} 个月度池</strong>
      <em>{snapshot.path || 'n/a'}</em>
      <div className="results-inline-list">
        <div className="results-inline-item">
          <span>Monthly</span>
          <strong>{monthlyRuleCount} rules</strong>
          <em>{summarizeRuleBuckets(normalizedRules.filter((item) => item.layerKey === 'monthly_guard'))}</em>
        </div>
        <div className="results-inline-item">
          <span>Weekly</span>
          <strong>{weeklyRuleCount} rules</strong>
          <em>{summarizeRuleBuckets(normalizedRules.filter((item) => item.layerKey === 'weekly_guard'))}</em>
        </div>
        <div className="results-inline-item">
          <span>Daily</span>
          <strong>{dailyRuleCount} rules</strong>
          <em>{summarizeRuleBuckets(normalizedRules.filter((item) => item.layerKey === 'daily_router'))}</em>
        </div>
        <div className="results-inline-item">
          <span>Loss</span>
          <strong>{lossRuleCount} rules</strong>
          <em>{summarizeRuleBuckets(normalizedRules.filter((item) => item.layerKey === 'loss_recheck'))}</em>
        </div>
      </div>
      <div className="results-report-list">
        {monthlyPools.slice(0, 6).map((item) => (
          <div key={item.month} className="results-report-row done">
            <span>{item.month}</span>
            <strong>{item.selectedStrategyName || 'stop / reduce'}</strong>
            <em>
              {item.featureBucket || 'n/a'}
              {' · '}
              {item.actionType || 'trade'}
              {' · '}
              risk {item.riskCap == null ? 'n/a' : formatCompactNumber(item.riskCap, 2)}
            </em>
            <button
              type="button"
              className="results-inline-toggle"
              onClick={() => setExpandedMonths((current) => ({
                ...current,
                [item.month]: !current[item.month]
              }))}
            >
              {expandedMonths[item.month] ? '收起 Top Strategies' : '展开 Top Strategies'}
            </button>
            {expandedMonths[item.month] && (
              <div className="results-detail-list">
                {(item.topStrategies || []).map((strategy) => (
                  <div key={`${item.month}-${strategy.strategyName}-${strategy.rank}`} className="results-detail-row">
                    <strong>#{strategy.rank || 'n/a'} {strategy.strategyName || 'strategy'}</strong>
                    <em>
                      pnl {strategy.totalPnl == null ? 'n/a' : formatCompactNumber(strategy.totalPnl, 2)}
                      {' · '}
                      score {strategy.score == null ? 'n/a' : formatCompactNumber(strategy.score, 2)}
                    </em>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {monthlyPools.length === 0 && (
          <div className="results-report-row todo">
            <span>Monthly Pools</span>
            <strong>未落库</strong>
            <em>当前 snapshot 里还没有月度候选池细节。</em>
          </div>
        )}
      </div>
    </div>
  );
}

function RouterLayerPreview({ title, rules }) {
  const groups = buildLayerRuleGroups(rules);

  return (
    <div className="router-layer-preview">
      <div className="section-title">{title}</div>
      {groups.length === 0 ? (
        <div className="results-report-row todo">
          <span>Rules</span>
          <strong>未生成</strong>
          <em>当前没有可读的 layer 规则。</em>
        </div>
      ) : (
        <div className="router-layer-grid">
          {groups.map((group) => (
            <div key={group.layerKey} className="results-report-row done">
              <span>{group.label}</span>
              <strong>{group.items.length} rules</strong>
              <em>{summarizeRuleBuckets(group.items)}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRange(timeRange) {
  if (!timeRange?.startIso || !timeRange?.endIso) {
    return '时间范围未知';
  }

  return `${timeRange.startIso.slice(0, 10)} -> ${timeRange.endIso.slice(0, 10)}`;
}

function formatStageList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return ['待补充'];
  }

  return items.filter(Boolean);
}

function buildSelectOptions(currentValue, presetOptions) {
  const current = String(currentValue || '').trim();
  const seen = new Set();
  const options = [];

  [...presetOptions, current].forEach((item) => {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    options.push(value);
  });

  return options;
}

function buildMethodologyStages(pipeline) {
  return Array.isArray(pipeline?.methodologyStages) ? pipeline.methodologyStages : [];
}

function getSuggestedStageKey(stages) {
  const runningStage = stages.find((stage) => stage.status === 'running');
  if (runningStage) {
    return runningStage.key;
  }

  const pendingStage = stages.find((stage) => stage.status !== 'done');
  if (pendingStage) {
    return pendingStage.key;
  }

  return stages[stages.length - 1]?.key || '';
}

function getStatusClass(status) {
  switch (status) {
    case 'done':
      return 'done';
    case 'running':
      return 'running';
    case 'partial':
      return 'partial';
    default:
      return 'todo';
  }
}

function getSummaryMetricTone(completed, total) {
  if (!total) {
    return 'todo';
  }
  if (completed >= total) {
    return 'done';
  }
  if (completed > 0) {
    return 'partial';
  }
  return 'todo';
}

function getRequestStatusText(status) {
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
      return status;
  }
}

function isActiveRequestStatus(status) {
  return status === 'queued'
    || status === 'exporting'
    || status === 'running'
    || status === 'cancelling';
}

function getValidationProfilePriority(profile) {
  switch (normalizeValidationProfile(profile)) {
    case 'rolling-window':
      return 1;
    case 'custom-range':
      return 2;
    default:
      return 9;
  }
}

function getConfigStatusText(status) {
  switch (status) {
    case 'active':
      return '当前版本';
    case 'archived':
      return '历史版本';
    case 'draft':
      return '草稿';
    default:
      return status || 'unknown';
  }
}

function formatConfigVersion(config) {
  return `v${Number(config?.versionNo || 1)}`;
}

function findConfigVersionByKey(configHistoryByKey, configKey) {
  if (!configKey) {
    return null;
  }

  const items = configHistoryByKey[configKey];
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  return items.find((item) => item.status === 'active') || items[0] || null;
}

function getHashQueryParams() {
  if (typeof window === 'undefined') {
    return new URLSearchParams();
  }

  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  return new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : '');
}

function updateHashQuery(updates) {
  if (typeof window === 'undefined') {
    return;
  }

  const hash = window.location.hash || '#/train-pipeline';
  const queryIndex = hash.indexOf('?');
  const base = queryIndex >= 0 ? hash.slice(0, queryIndex) : hash;
  const params = getHashQueryParams();

  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  });

  const next = params.toString();
  window.history.replaceState(null, '', next ? `${base}?${next}` : base);
}

function ValidationList({ items, onViewRequest }) {
  if (!items.length) {
    return <div className="pipeline-empty">还没有匹配到 validation config。</div>;
  }

  return (
    <div className="validation-list">
      {items.map((item) => (
        <div key={item.path} className="validation-item">
          <div className="validation-item-head">
            <span className="validation-target">{item.targetLabel}</span>
            <div className="validation-item-statuses">
              <span className={`validation-chip ${getValidationProfileTone(item.validationProfile)}`}>
                {getValidationProfileLabel(item.validationProfile)}
              </span>
              {item.latestRequest && (
                <span className={`request-status-chip ${item.latestRequest.status}`}>
                  {getRequestStatusText(item.latestRequest.status)}
                </span>
              )}
              <span className={`validation-chip ${item.latestRun ? 'done' : 'todo'}`}>
                {item.latestRun ? '已落库' : '未执行'}
              </span>
            </div>
          </div>
          <div className="validation-path">{item.path}</div>
          <div className="validation-meta">
            {item.resultGroup}
            {item.latestRequest ? ` · queue ${formatDateTime(item.latestRequest.createdAt)}` : ''}
            {item.latestRun ? ` · latest ${formatDateTime(item.latestRun.latestAt)}` : ''}
          </div>
          {item.latestRequest && (
            <div className="validation-item-actions">
              <button type="button" onClick={() => onViewRequest(item.latestRequest.id)}>查看请求</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GuidanceBlock({ commands }) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return null;
  }

  return (
    <div className="command-list">
      {commands.map((command) => (
        <div key={command} className="command-card">
          <pre>{command}</pre>
        </div>
      ))}
    </div>
  );
}

function isUiRunnableAction(actionKey) {
  return actionKey === 'run-training'
    || actionKey === 'generate-validation'
    || actionKey === 'prepare-validation'
    || actionKey === 'run-validation'
    || actionKey === 'waiting-generate-validation'
    || actionKey === 'waiting-validation'
    || actionKey === 'cost-sensitivity'
    || actionKey === 'feature-causality'
    || actionKey === 'router-validate'
    || actionKey === 'goal-tracking';
}

function getNextActionButtonLabel(nextActionKey) {
  switch (nextActionKey) {
    case 'run-training':
      return '启动自动训练链路';
    case 'run-validation':
      return '执行阶段 8：运行 Validation';
    case 'generate-validation':
      return '执行阶段 8：生成最终配置';
    case 'prepare-validation':
      return '执行阶段 8：补齐 Validation';
    case 'waiting-generate-validation':
      return '刷新最终配置状态';
    case 'waiting-validation':
      return '刷新 Validation 状态';
    case 'cost-sensitivity':
      return '执行阶段 8：成本敏感度';
    case 'feature-causality':
      return '执行阶段 1：结构诊断';
    case 'build-router':
      return '执行阶段 7：生成 Router';
    case 'router-validate':
      return '执行阶段 8：Router 验证';
    case 'review':
      return '执行阶段 9：进入复盘';
    default:
      return '下一步';
  }
}

function getFinalConfigState(pipeline) {
  return pipeline?.finalConfigState || {
    title: '尚未生成',
    detail: '先完成训练候选池，再生成 rolling package。',
    status: 'todo',
    canExport: false,
    requestId: null
  };
}

function ResultsOverview({ pipelines, meta }) {
  const total = pipelines.length;
  const running = pipelines.filter((pipeline) => {
    const validationRunning = (pipeline.validationConfigs || []).some((item) => isActiveRequestStatus(item.latestRequest?.status));
    return isActiveRequestStatus(pipeline.latestRequest?.status)
      || isActiveRequestStatus(pipeline.latestGenerateValidationRequest?.status)
      || validationRunning;
  }).length;
  const trained = pipelines.filter((pipeline) => Boolean(pipeline.trainingRun)).length;
  const validationDone = pipelines.filter((pipeline) => (pipeline.validationConfigs || []).some((item) => Boolean(item.latestRun))).length;
  const routerReady = pipelines.filter((pipeline) => Boolean(pipeline.router?.routerPath && pipeline.router?.policyPath)).length;
  const reportReady = pipelines.filter((pipeline) => {
    const reports = pipeline.reports || {};
    return Boolean(reports.featureCausality || reports.costSensitivity || reports.routerValidation || reports.goalTracking);
  }).length;

  const cards = [
    {
      label: 'Training Configs',
      value: total,
      detail: meta?.dbConnected ? '配置库在线' : '仅文件态汇总',
      tone: total > 0 ? 'done' : 'todo'
    },
    {
      label: 'Active Runs',
      value: running,
      detail: running > 0 ? '队列中仍有任务执行' : '当前没有活跃执行',
      tone: running > 0 ? 'running' : 'todo'
    },
    {
      label: 'Training Ready',
      value: `${trained}/${total || 0}`,
      detail: '候选池已落库的训练任务',
      tone: getSummaryMetricTone(trained, total)
    },
    {
      label: 'Validation Ready',
      value: `${validationDone}/${total || 0}`,
      detail: '至少完成一轮 validation 的任务',
      tone: getSummaryMetricTone(validationDone, total)
    },
    {
      label: 'Reports Ready',
      value: `${reportReady}/${total || 0}`,
      detail: '已有审计或验证报告',
      tone: getSummaryMetricTone(reportReady, total)
    },
    {
      label: 'Router Ready',
      value: `${routerReady}/${total || 0}`,
      detail: 'router 与 policy 已配齐',
      tone: getSummaryMetricTone(routerReady, total)
    }
  ];

  return (
    <section className="results-overview">
      <div className="config-studio-head">
        <div>
          <div className="hero-kicker">Result Overview</div>
          <h2>训练总览</h2>
          <p>把当前训练、验证、报告与 router 产物收成一屏，先看全局状态再下钻到单条 pipeline。</p>
        </div>
      </div>
      <div className="results-overview-grid">
        {cards.map((card) => (
          <div key={card.label} className={`results-overview-card ${card.tone}`}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <em>{card.detail}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function PipelineResultsPanel({ pipeline, onViewRequest, onOpenRouterStudio }) {
  const validationItems = pipeline.validationConfigs || [];
  const completedValidations = validationItems.filter((item) => item.latestRun);
  const pendingValidations = validationItems.filter((item) => !item.latestRun);
  const latestValidation = completedValidations
    .sort((left, right) => new Date(right.latestRun?.latestAt || 0).getTime() - new Date(left.latestRun?.latestAt || 0).getTime())[0] || null;
  const reportEntries = [
    {
      key: 'feature-causality',
      label: '因果特征审计',
      data: pipeline.reports?.featureCausality
    },
    {
      key: 'cost-sensitivity',
      label: '成本敏感度',
      data: pipeline.reports?.costSensitivity
    },
    {
      key: 'router-validation',
      label: 'Router 验证',
      data: pipeline.reports?.routerValidation
    },
    {
      key: 'goal-tracking',
      label: '目标达成追踪',
      data: pipeline.reports?.goalTracking
    },
    {
      key: 'ai-summary',
      label: 'AI 总结',
      data: pipeline.reports?.aiSummary
    }
  ];

  return (
    <div className="pipeline-results-grid">
      <div className="results-panel-card">
        <span>训练结果</span>
        <strong>{pipeline.trainingRun ? `${pipeline.trainingRun.strategyCount} strategies` : '尚未落库'}</strong>
        <em>
          {pipeline.trainingRun
            ? `best score ${formatCompactNumber(pipeline.trainingRun.bestScore, 4)} · best pnl ${formatCompactNumber(pipeline.trainingRun.bestTotalPnl)}`
            : '先完成训练候选池'}
        </em>
        <div className="results-inline-list">
          <div className="results-inline-item">
            <span>Run ID</span>
            <strong>{pipeline.trainingRun?.runId || 'n/a'}</strong>
          </div>
          <div className="results-inline-item">
            <span>Updated</span>
            <strong>{formatDateTime(pipeline.trainingRun?.latestAt)}</strong>
          </div>
        </div>
      </div>

      <div className="results-panel-card">
        <span>Validation</span>
        <strong>{completedValidations.length}/{validationItems.length || 0} 已完成</strong>
        <em>
          {latestValidation
            ? `latest ${latestValidation.targetLabel} · ${formatDateTime(latestValidation.latestRun?.latestAt)}`
            : pendingValidations.length > 0
              ? '已有 validation config，等待执行'
              : '还没有派生 validation config'}
        </em>
        <div className="results-chip-list">
          {validationItems.length === 0 ? (
            <div className="results-chip todo">未生成</div>
          ) : validationItems.map((item) => (
            <button
              key={item.path}
              type="button"
              className={`results-chip ${item.latestRun ? 'done' : isActiveRequestStatus(item.latestRequest?.status) ? 'running' : 'todo'}`}
              onClick={() => item.latestRequest && onViewRequest(item.latestRequest.id)}
            >
              {item.targetLabel}
            </button>
          ))}
        </div>
      </div>

      <div className="results-panel-card">
        <span>Reports</span>
        <strong>{reportEntries.filter((item) => item.data).length}/{reportEntries.length} 已产出</strong>
        <div className="results-report-list">
          {reportEntries.map((item) => (
            <div key={item.key} className={`results-report-row ${item.data ? 'done' : 'todo'}`}>
              <span>{item.label}</span>
              <strong>{item.data ? '已生成' : '未生成'}</strong>
              <em>{item.data?.path || '等待执行'}</em>
              {item.data?.preview && (
                <pre className="results-report-preview">{item.data.preview}</pre>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="results-panel-card">
        <span>Artifacts</span>
        <strong>{pipeline.router?.routerPath ? 'Router 已接入' : '等待 Router'}</strong>
        <div className="results-report-list">
          <div className={`results-report-row ${pipeline.topStrategySnapshot ? 'done' : 'todo'}`}>
            <span>Rolling Package</span>
            <strong>{pipeline.topStrategySnapshot ? '已生成' : '未生成'}</strong>
            <em>{pipeline.topStrategySnapshot?.path || '等待 generate-validation'}</em>
          </div>
          <div className={`results-report-row ${pipeline.router?.routerPath ? 'partial' : 'todo'}`}>
            <span>Router</span>
            <strong>{pipeline.router?.routerPath ? '已配置' : '未配置'}</strong>
            <em>{pipeline.router?.routerPath || '等待人工整理'}</em>
          </div>
          <div className={`results-report-row ${pipeline.router?.policyPath ? 'done' : 'todo'}`}>
            <span>Policy</span>
            <strong>{pipeline.router?.policyPath ? '已生成' : '未生成'}</strong>
            <em>{pipeline.router?.policyPath || '等待 policy catalog'}</em>
          </div>
        </div>
        <button type="button" className="summary-box-action" onClick={() => onOpenRouterStudio(pipeline)}>
          {pipeline.router?.routerPath ? '编辑 Router' : '配置 Router'}
        </button>
      </div>

      <RollingPackagePanel snapshot={pipeline.topStrategySnapshot} />
    </div>
  );
}

function RouterStudioPanel({
  open,
  saving,
  error,
  data,
  routerText,
  policyText,
  onClose,
  onRouterTextChange,
  onPolicyTextChange,
  onSyncPolicyFromRouter,
  onDefaultFallbackChange,
  onRuleChange,
  onAddRule,
  onRemoveRule,
  onSave
}) {
  if (!open) {
    return null;
  }

  const parsedRouter = safeParseJsonText(routerText);
  const parsedPolicy = safeParseJsonText(policyText);
  const routerContent = isPlainObject(parsedRouter) ? normalizeRouterContent(parsedRouter) : null;
  const routerRules = Array.isArray(routerContent?.rules) ? routerContent.rules : [];
  const strategyCatalog = normalizeStrategyCatalog(routerContent?.strategyCatalog);
  const strategyOptions = Object.entries(strategyCatalog).map(([strategyKey, strategy]) => ({
    strategyKey,
    label: `${strategy?.shortLabel || strategyKey} · ${strategy?.strategyName || 'strategy'}`
  }));
  const defaultFallback = routerContent?.executionModel?.defaultFallback || {
    action: 'trade',
    riskMultiplier: 1,
    strategyKey: ''
  };
  const layerEditorGroups = buildLayerEditorGroups(routerRules);
  const policyEventSegments = Array.isArray(parsedPolicy?.eventSegments) ? parsedPolicy.eventSegments : [];
  const policyDailyGuards = Array.isArray(parsedPolicy?.dailyGuards) ? parsedPolicy.dailyGuards : [];
  const policyRules = [
    ...policyEventSegments.map((item) => ({
      layerKey: item?.layer || 'monthly_guard',
      featureBucket: item?.eventSegment || item?.featureSummary || null,
      ruleId: item?.ruleId || null
    })),
    ...policyDailyGuards.map((item) => ({
      layerKey: item?.layer || 'daily_router',
      featureBucket: item?.eventSegment || item?.featureSummary || null,
      ruleId: item?.ruleId || null
    }))
  ];

  return (
    <section className="editor-panel">
      <div className="editor-panel-head">
        <div>
          <div className="hero-kicker">Router Studio</div>
          <h2>Router / Policy 配置</h2>
          <p>系统会先按 rolling 结果自动维护 router / policy；这里保留为人工覆写入口。</p>
        </div>
        <button type="button" className="editor-close" onClick={onClose}>关闭</button>
      </div>

      <div className="router-studio-meta">
        <div className="summary-box">
          <span>Training Config</span>
          <strong>{data?.trainingConfigKey || 'n/a'}</strong>
          <em>{data?.snapshotReady ? `rolling package ${data.snapshotConfigKey}` : '还没有 rolling package snapshot'}</em>
        </div>
        <div className="summary-box">
          <span>Router Config</span>
          <strong>{data?.routerConfigKey || 'n/a'}</strong>
          <em>保存后会自动回写 training config 的 regimeRouting.routerConfigPath</em>
        </div>
        <div className="summary-box">
          <span>Policy Catalog</span>
          <strong>{data?.policyConfigKey || 'n/a'}</strong>
          <em>保存后会自动回写 training config 的 regimeRouting.policyCatalogPath</em>
        </div>
      </div>

      {error && <div className="pipeline-error">{error}</div>}

      <div className="router-studio-grid">
        <RouterLayerPreview title="Router Layers" rules={routerRules} />
        <RouterLayerPreview title="Policy Layers" rules={policyRules} />
      </div>

      {!routerContent && (
        <div className="pipeline-warning">
          Router JSON 当前不是合法对象，分层表单暂时不可用。先修复 JSON，或者重新载入当前 pipeline 的 Router Studio。
        </div>
      )}

      {routerContent && (
        <div className="router-editor-stack">
          <div className="router-fallback-card">
            <div className="section-title">Execution Fallback</div>
            <div className="router-rule-grid compact">
              <label className="router-rule-field">
                <span>Action</span>
                <select
                  value={defaultFallback.action || 'trade'}
                  onChange={(event) => onDefaultFallbackChange('action', event.target.value)}
                >
                  <option value="trade">trade</option>
                  <option value="reduce">reduce</option>
                </select>
              </label>
              <label className="router-rule-field">
                <span>Risk Multiplier</span>
                <input
                  type="number"
                  step="0.1"
                  value={defaultFallback.riskMultiplier ?? 1}
                  onChange={(event) => onDefaultFallbackChange('riskMultiplier', event.target.value)}
                />
              </label>
              <label className="router-rule-field">
                <span>Strategy</span>
                <select
                  value={defaultFallback.strategyKey || ''}
                  onChange={(event) => onDefaultFallbackChange('strategyKey', event.target.value)}
                >
                  <option value="">未指定</option>
                  {strategyOptions.map((item) => (
                    <option key={item.strategyKey} value={item.strategyKey}>{item.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {layerEditorGroups.map((group) => (
            <div key={group.layerKey} className="router-rule-layer-card">
              <div className="router-rule-layer-head">
                <div>
                  <div className="section-title">{group.label}</div>
                  <strong>{group.items.length} rules</strong>
                </div>
                <button type="button" className="summary-box-action" onClick={() => onAddRule(group.layerKey)}>
                  新增 {group.label} Rule
                </button>
              </div>

              {group.items.length === 0 ? (
                <div className="results-report-row todo">
                  <span>{group.label}</span>
                  <strong>暂无规则</strong>
                  <em>可以直接新增一条，或者在下方 JSON 区手工补充。</em>
                </div>
              ) : (
                <div className="router-rule-list">
                  {group.items.map(({ index, rule }) => (
                    <div key={`${group.layerKey}-${rule.id}-${index}`} className="router-rule-card">
                      <div className="router-rule-card-head">
                        <strong>{rule.id || `rule-${index + 1}`}</strong>
                        <button type="button" className="router-rule-remove" onClick={() => onRemoveRule(index)}>
                          删除
                        </button>
                      </div>
                      <em>{buildRouterPolicyFeatureSummary(rule.when)}</em>
                      <div className="router-rule-grid">
                        <label className="router-rule-field">
                          <span>Rule ID</span>
                          <input
                            value={rule.id || ''}
                            onChange={(event) => onRuleChange(index, 'id', event.target.value)}
                          />
                        </label>
                        <label className="router-rule-field">
                          <span>Layer</span>
                          <select
                            value={normalizeRouterLayer(rule.layer)}
                            onChange={(event) => onRuleChange(index, 'layer', event.target.value)}
                          >
                            {ROUTER_LAYER_KEYS.map((layerKey) => (
                              <option key={layerKey} value={layerKey}>{getLayerLabel(layerKey)}</option>
                            ))}
                          </select>
                        </label>
                        <label className="router-rule-field">
                          <span>Feature Bucket</span>
                          <input
                            value={getRouterRuleFeatureBucket(rule)}
                            onChange={(event) => onRuleChange(index, 'featureBucket', event.target.value)}
                          />
                        </label>
                        <label className="router-rule-field">
                          <span>Action</span>
                          <select
                            value={rule.action?.type || 'trade'}
                            onChange={(event) => onRuleChange(index, 'actionType', event.target.value)}
                          >
                            {ROUTER_ACTION_TYPES.map((actionType) => (
                              <option key={actionType} value={actionType}>{actionType}</option>
                            ))}
                          </select>
                        </label>
                        <label className="router-rule-field">
                          <span>Risk Cap</span>
                          <input
                            type="number"
                            step="0.1"
                            value={rule.action?.riskCap ?? ''}
                            disabled={rule.action?.type === 'stop'}
                            onChange={(event) => onRuleChange(index, 'riskCap', event.target.value)}
                          />
                        </label>
                        <label className="router-rule-field">
                          <span>Risk Multiplier</span>
                          <input
                            type="number"
                            step="0.1"
                            value={rule.action?.riskMultiplier ?? ''}
                            disabled={rule.action?.type === 'stop'}
                            onChange={(event) => onRuleChange(index, 'riskMultiplier', event.target.value)}
                          />
                        </label>
                        <label className="router-rule-field">
                          <span>Strategy</span>
                          <select
                            value={rule.action?.strategyKey || ''}
                            disabled={rule.action?.type === 'stop'}
                            onChange={(event) => onRuleChange(index, 'strategyKey', event.target.value)}
                          >
                            <option value="">未指定</option>
                            {strategyOptions.map((item) => (
                              <option key={item.strategyKey} value={item.strategyKey}>{item.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="router-rule-field router-rule-field-wide">
                          <span>Rationale</span>
                          <input
                            value={rule.rationale || ''}
                            onChange={(event) => onRuleChange(index, 'rationale', event.target.value)}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="router-studio-grid">
        <label className="editor-textarea-wrap">
          <span>Router JSON</span>
          <textarea value={routerText} onChange={(event) => onRouterTextChange(event.target.value)} spellCheck="false" />
        </label>
        <label className="editor-textarea-wrap">
          <span>Policy JSON</span>
          <textarea value={policyText} onChange={(event) => onPolicyTextChange(event.target.value)} spellCheck="false" />
        </label>
      </div>

      <div className="editor-actions">
        <button type="button" className="summary-box-action" onClick={onSyncPolicyFromRouter} disabled={saving}>
          从 Router 重建 Policy
        </button>
        <button type="button" className="pipeline-refresh-button" onClick={onSave} disabled={saving}>
          {saving ? '保存中...' : '保存 Router Artifacts'}
        </button>
      </div>
    </section>
  );
}

function MethodologyStageOverview({ stages, selectedStageKey, onSelect }) {
  return (
    <div className="methodology-overview">
      {stages.map((stage) => {
        const isSelected = selectedStageKey === stage.key;
        return (
          <button
            key={stage.key}
            type="button"
            className={`methodology-stage-tile ${getStatusClass(stage.status)} ${isSelected ? 'selected' : ''}`}
            onClick={() => onSelect(stage.key)}
          >
            <span>{stage.label}</span>
            <strong>{stage.title}</strong>
            <em>{statusLabelMap[stage.status] || stage.status}</em>
          </button>
        );
      })}
    </div>
  );
}

function MethodologyStageFocus({
  stage,
  pipeline,
  showAction,
  onRunAction,
  feedback
}) {
  if (!stage) {
    return null;
  }

  const inputs = formatStageList(stage.inputs);
  const outputs = formatStageList(stage.outputs);
  const gates = formatStageList(stage.gates);
  const evidence = formatStageList(stage.evidence);

  return (
    <div className={`methodology-stage-focus ${getStatusClass(stage.status)}`}>
      <div className="methodology-stage-focus-head">
        <div>
          <div className="section-title">{stage.label}</div>
          <h3>{stage.title}</h3>
          <p>{stage.summary}</p>
        </div>
        <div className={`methodology-stage-status ${getStatusClass(stage.status)}`}>
          {statusLabelMap[stage.status] || stage.status}
        </div>
      </div>

      <div className="methodology-stage-lists">
        <div className="methodology-stage-list">
          <span>输入</span>
          {inputs.map((item) => (
            <div key={`${stage.key}-input-${item}`} className="methodology-stage-item">{item}</div>
          ))}
        </div>
        <div className="methodology-stage-list">
          <span>输出</span>
          {outputs.map((item) => (
            <div key={`${stage.key}-output-${item}`} className="methodology-stage-item">{item}</div>
          ))}
        </div>
        <div className="methodology-stage-list">
          <span>门槛</span>
          {gates.map((item) => (
            <div key={`${stage.key}-gate-${item}`} className="methodology-stage-item">{item}</div>
          ))}
        </div>
      </div>

      <div className="methodology-stage-evidence">
        <span>当前证据</span>
        {evidence.map((item) => (
          <div key={`${stage.key}-evidence-${item}`} className="methodology-stage-item mono">{item}</div>
        ))}
      </div>

      <div className="methodology-stage-note">{stage.notes}</div>

      {showAction && (
        <div className="next-action-card methodology-action-card">
          <div className="next-action-head">
            <strong>{pipeline.nextAction.title}</strong>
            <span>{pipeline.nextAction.reason}</span>
          </div>
          {isUiRunnableAction(pipeline.nextAction.key) ? (
            <div className="next-action-buttons">
              <button
                type="button"
                className="pipeline-refresh-button next-action-primary"
                onClick={() => void onRunAction(pipeline)}
              >
                {getNextActionButtonLabel(pipeline.nextAction.key)}
              </button>
            </div>
          ) : (
            <div className="next-action-feedback">
              这一步当前还没有接入自动执行，请按下方说明人工处理。
            </div>
          )}
          {feedback && (
            <div className="next-action-feedback">
              {feedback}
            </div>
          )}
          <GuidanceBlock commands={pipeline.nextAction.commands || []} />
        </div>
      )}
    </div>
  );
}

function ConfigStudio({
  configs,
  configHistoryByKey,
  latestRequestByConfigId,
  filterType,
  onFilterChange,
  onBootstrap,
  onCreate,
  onEdit,
  onExport,
  onClear,
  onRun,
  onOpenHistory,
  actionMessage
}) {
  return (
    <section className="config-studio">
      <div className="config-studio-head">
        <div>
          <div className="hero-kicker">Config Studio</div>
          <h2>配置库</h2>
          <p>这里只维护单一主配置 `training config`。训练完成后会派生 rolling candidate/mapping package，validation 也从它继续生成。</p>
        </div>
        <div className="config-studio-actions">
          <select value={filterType} onChange={(event) => onFilterChange(event.target.value)}>
            {configTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button type="button" onClick={onBootstrap}>
            初始化默认配置
          </button>
          <button type="button" className="pipeline-refresh-button" onClick={onCreate}>
            新建配置
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="config-message">
          <div>{actionMessage.text}</div>
        </div>
      )}

      <div className="config-list">
        {configs.length === 0 ? (
          <div className="pipeline-empty">
            <div>当前筛选下没有配置。</div>
            <button type="button" className="pipeline-refresh-button" onClick={onBootstrap}>
              一键初始化默认 Training Config
            </button>
          </div>
        ) : (
          configs.map((config) => (
            <div key={config.id} className="config-row">
              <div className="config-row-main">
                <div className="config-row-top">
                  <span className="config-type-chip">training</span>
                  <span className={`config-version-chip ${config.status || 'active'}`}>
                    {formatConfigVersion(config)} · {getConfigStatusText(config.status)}
                  </span>
                  {config.symbol && <span className="pipeline-symbol">{config.symbol}</span>}
                  {config.trainingYear && <span className="pipeline-year">{config.trainingYear}</span>}
                  {latestRequestByConfigId[config.id] && (
                    <span className={`request-status-chip ${latestRequestByConfigId[config.id].status}`}>
                      {getRequestStatusText(latestRequestByConfigId[config.id].status)}
                    </span>
                  )}
                </div>
                <strong>{config.configName || config.fileName}</strong>
                <div className="config-key">{config.configKey}</div>
                <div className="config-meta">
                  {config.resultGroup || 'no result_group'}
                  {' · '}
                  {`${(configHistoryByKey[config.configKey] || []).length || 1} versions`}
                  {' · '}
                  updated {formatDateTime(config.updatedAt)}
                  {latestRequestByConfigId[config.id]
                    ? ` · last queue ${formatDateTime(latestRequestByConfigId[config.id].createdAt)}`
                    : ''}
                </div>
              </div>
              <div className="config-row-actions">
                <button type="button" onClick={() => onRun(config.id)}>
                  启动训练
                </button>
                <button type="button" onClick={() => onOpenHistory(config.configKey)}>
                  查看历史
                </button>
                <button type="button" onClick={() => onClear(config)}>
                  清除数据
                </button>
                <button type="button" onClick={() => onEdit(config.id)}>编辑</button>
                <button type="button" onClick={() => onExport(config.id)}>导出</button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ConfigHistoryPanel({
  open,
  configKey,
  items,
  latestRequestByConfigId,
  onClose,
  onEdit,
  onExport
}) {
  if (!open) {
    return null;
  }

  return (
    <section className="editor-panel">
      <div className="editor-panel-head">
        <div>
          <div className="hero-kicker">Version History</div>
          <h2>配置版本历史</h2>
          <p>{configKey || '未选择配置'}</p>
        </div>
        <button type="button" className="editor-close" onClick={onClose}>关闭</button>
      </div>

      <div className="config-list">
        {items.length === 0 ? (
          <div className="pipeline-empty">当前没有可显示的历史版本。</div>
        ) : (
          items.map((config) => (
            <div key={config.id} className="config-row history-row">
              <div className="config-row-main">
                <div className="config-row-top">
                  <span className="config-type-chip">{config.configType}</span>
                  <span className={`config-version-chip ${config.status || 'active'}`}>
                    {formatConfigVersion(config)} · {getConfigStatusText(config.status)}
                  </span>
                  {config.parentConfigId ? (
                    <span className="config-lineage-chip">from #{config.parentConfigId}</span>
                  ) : null}
                  {latestRequestByConfigId[config.id] && (
                    <span className={`request-status-chip ${latestRequestByConfigId[config.id].status}`}>
                      {getRequestStatusText(latestRequestByConfigId[config.id].status)}
                    </span>
                  )}
                </div>
                <strong>{config.configName || config.fileName}</strong>
                <div className="config-key">{config.configKey}</div>
                <div className="config-meta">
                  id {config.id}
                  {' · '}
                  updated {formatDateTime(config.updatedAt)}
                  {config.contentHash ? ` · hash ${String(config.contentHash).slice(0, 10)}` : ''}
                </div>
              </div>
              <div className="config-row-actions">
                <button type="button" onClick={() => onEdit(config.id)}>编辑为新版本</button>
                <button type="button" onClick={() => onExport(config.id)}>导出</button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function QueuePanel({
  requests,
  onSelect,
  onRetry,
  onCancel
}) {
  return (
    <section className="config-studio">
      <div className="config-studio-head">
        <div>
          <div className="hero-kicker">Run Queue</div>
          <h2>最近运行请求</h2>
          <p>这里展示 UI 提交后进入 worker 队列的最近请求状态。</p>
        </div>
      </div>

      <div className="queue-list">
        {requests.length === 0 ? (
          <div className="pipeline-empty">最近还没有运行请求。</div>
        ) : (
          requests.map((request) => (
            <div key={request.requestId} className="queue-row">
              <div className="queue-row-head">
                <strong>{request.configName || request.configKey}</strong>
                <span className={`request-status-chip ${request.status}`}>
                  {getRequestStatusText(request.status)}
                </span>
              </div>
              <div className="config-key">{request.action} · {request.configKey}</div>
              <div className="config-meta">
                created {formatDateTime(request.createdAt)}
                {request.startedAt ? ` · started ${formatDateTime(request.startedAt)}` : ''}
                {request.completedAt ? ` · completed ${formatDateTime(request.completedAt)}` : ''}
              </div>
              <div className="queue-row-actions">
                <button type="button" onClick={() => onSelect(request.id)}>详情</button>
                {(request.status === 'failed' || request.status === 'cancelled' || request.status === 'completed') && (
                  <button type="button" onClick={() => onRetry(request.id)}>重试</button>
                )}
                {(request.status === 'queued' || request.status === 'exporting' || request.status === 'running' || request.status === 'cancelling') && (
                  <button type="button" onClick={() => onCancel(request.id)}>
                    {request.status === 'running' || request.status === 'cancelling' ? '停止' : '取消'}
                  </button>
                )}
              </div>
              {request.errorMessage && (
                <div className="queue-error">{request.errorMessage}</div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function TrainingGuidePanel({
  draft,
  currentConfigKey,
  isNew,
  guideMeta,
  computedPreview,
  onChange
}) {
  const guideOptions = guideMeta?.options || EMPTY_TRAINING_GUIDE_META.options;
  const validationProfiles = guideMeta?.validationProfiles?.length
    ? guideMeta.validationProfiles
    : EMPTY_TRAINING_GUIDE_META.validationProfiles;
  const recommendations = guideMeta?.recommendations?.length
    ? guideMeta.recommendations
    : EMPTY_TRAINING_GUIDE_META.recommendations;
  const computed = computedPreview || { configKey: currentConfigKey, content: { name: '', description: '' }, recommendedTableName: '' };
  const yearOptions = buildSelectOptions(draft.year, guideOptions.trainingYears || []);
  const symbolOptions = buildSelectOptions(draft.symbol, guideOptions.symbols || []);
  const intervalOptions = buildSelectOptions(draft.intervalType, guideOptions.intervalTypes || []);
  const strategyTypeOptions = buildSelectOptions(draft.strategyTypes, guideOptions.strategyTypes || []);
  const topNOptions = buildSelectOptions(draft.topN, guideOptions.topNValues || []);
  const lotSizeOptions = buildSelectOptions(draft.lotSize, guideOptions.lotSizes || []);
  const holdMinOptions = buildSelectOptions(draft.maxHoldMin, guideOptions.holdMinValues || []);
  const holdMaxOptions = buildSelectOptions(draft.maxHoldMax, guideOptions.holdMaxValues || []);
  const tradingScheduleOptions = buildSelectOptions(draft.tradingSchedule, guideOptions.tradingSchedules || []);
  const usesCustomValidationRange = draft.validationProfile === 'custom-range';

  return (
    <div className="training-guide-panel">
      <div className="training-guide-copy">
        <div className="section-title">Quick Start</div>
        <strong>推荐先把这些关键参数定下来</strong>
        <p>
          这层表单会把推荐值同步进下方 JSON，适合第一次创建 training 配置时快速定型。
        </p>
      </div>

      <div className="training-guide-grid">
        <label>
          <span>年份</span>
          <select value={draft.year} onChange={(event) => onChange('year', event.target.value)}>
            {yearOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          <span>交易对</span>
          <select value={draft.symbol} onChange={(event) => onChange('symbol', event.target.value.toUpperCase())}>
            {symbolOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Run Tag</span>
          <input value={draft.runTag} onChange={(event) => onChange('runTag', event.target.value)} placeholder={DEFAULT_TRAINING_RUN_TAG} />
        </label>
        <label>
          <span>Interval</span>
          <select value={draft.intervalType} onChange={(event) => onChange('intervalType', event.target.value)}>
            {intervalOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          <span>开始日期</span>
          <input type="date" value={draft.startDate} onChange={(event) => onChange('startDate', event.target.value)} />
        </label>
        <label>
          <span>结束日期</span>
          <input type="date" value={draft.endDate} onChange={(event) => onChange('endDate', event.target.value)} />
        </label>
        <label>
          <span>Top N</span>
          <select value={String(draft.topN)} onChange={(event) => onChange('topN', event.target.value)}>
            {topNOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          <span>策略类型</span>
          <select value={draft.strategyTypes} onChange={(event) => onChange('strategyTypes', event.target.value)}>
            {strategyTypeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Lot Size</span>
          <select value={String(draft.lotSize)} onChange={(event) => onChange('lotSize', event.target.value)}>
            {lotSizeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Max Hold Min</span>
          <select value={String(draft.maxHoldMin)} onChange={(event) => onChange('maxHoldMin', event.target.value)}>
            {holdMinOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Max Hold Max</span>
          <select value={String(draft.maxHoldMax)} onChange={(event) => onChange('maxHoldMax', event.target.value)}>
            {holdMaxOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="training-guide-span-2">
          <span>Trading Schedule</span>
          <select value={draft.tradingSchedule} onChange={(event) => onChange('tradingSchedule', event.target.value)}>
            {tradingScheduleOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Validation 方案</span>
          <select value={draft.validationProfile} onChange={(event) => onChange('validationProfile', event.target.value)}>
            {validationProfiles.map((option) => (
              <option key={option.value} value={option.value}>{option.label} · {option.hint}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{usesCustomValidationRange ? 'Validation 起点' : 'Rolling 起点'}</span>
          <input
            type="date"
            value={draft.validationStartDate}
            onChange={(event) => onChange('validationStartDate', event.target.value)}
            disabled={!usesCustomValidationRange}
          />
        </label>
        <label>
          <span>{usesCustomValidationRange ? 'Validation 终点' : 'Rolling 终点'}</span>
          <input
            type="date"
            value={draft.validationEndDate}
            onChange={(event) => onChange('validationEndDate', event.target.value)}
            disabled={!usesCustomValidationRange}
          />
        </label>
        <label className="training-guide-span-2">
          <span>结果表名</span>
          <input value={draft.tableName} onChange={(event) => onChange('tableName', event.target.value)} placeholder={computed.recommendedTableName} />
        </label>
        <label className="training-guide-span-2">
          <span>Router 路径</span>
          <input value={draft.routerConfigPath} onChange={(event) => onChange('routerConfigPath', event.target.value)} placeholder="../generated/regime-routing/BTCJPY_dual_year_router_v6.json" />
        </label>
      </div>

      <div className="training-guide-summary">
        <div className="summary-box">
          <span>推荐 Config Key</span>
          <strong>{computed.configKey}</strong>
          <em>{isNew ? '新建时会自动使用这个路径' : `当前保持 ${currentConfigKey}`}</em>
        </div>
        <div className="summary-box">
          <span>推荐 Name</span>
          <strong>{computed.content.name}</strong>
          <em>{computed.content.description}</em>
        </div>
        <div className="summary-box">
          <span>Validation 主线</span>
          <strong>{getValidationProfileLabel(draft.validationProfile)}</strong>
          <em>
            {draft.validationProfile === 'rolling-window'
              ? `把训练区间 ${draft.startDate} -> ${draft.endDate} 拆成月度 rolling 验证窗口`
              : draft.validationProfile === 'custom-range'
                ? `${draft.validationStartDate} -> ${draft.validationEndDate}`
                : `把训练区间 ${draft.startDate} -> ${draft.endDate} 拆成月度 rolling 验证窗口`}
          </em>
        </div>
      </div>

      <div className="training-guide-tips">
        {recommendations.map((tip) => (
          <div key={tip} className="training-guide-tip">{tip}</div>
        ))}
      </div>

      <div className="training-guide-validation-preview">
        <div className="section-title">Validation 派生规则</div>
        <div className="validation-list">
          <div className="validation-item">
            <div className="validation-item-head">
              <span className="validation-target">
                {draft.validationProfile === 'rolling-window'
                  ? 'Rolling 主验证'
                  : draft.validationProfile === 'custom-range'
                    ? '自定义区间'
                    : 'Rolling 主验证'}
              </span>
              <span className="validation-chip todo">由 training config 派生</span>
            </div>
            <div className="validation-path">{computed.configKey}</div>
            <div className="validation-meta">
              {draft.validationProfile === 'rolling-window'
                ? `保存时不会单独创建 validation 草稿，训练启动后会按训练区间 ${draft.startDate} -> ${draft.endDate} 自动拆成月度 rolling 验证窗口。`
                : '保存时不会单独创建 validation 草稿。'}
              {' · '}
              训练启动后会自动串行完成 rolling package、validation 与后续报告任务。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorPanel({
  open,
  saving,
  isNew,
  editorMode,
  editorError,
  configKey,
  configType,
  contentText,
  guideDraft,
  guideMeta,
  guidePreview,
  onClose,
  onSave,
  onModeChange,
  onConfigKeyChange,
  onConfigTypeChange,
  onContentChange,
  onGuideChange
}) {
  if (!open) {
    return null;
  }

  const supportsBasicMode = configType === 'training' && guideDraft;

  return (
    <section className="editor-panel">
      <div className="editor-panel-head">
        <div>
          <div className="hero-kicker">Editor</div>
          <h2>配置编辑器</h2>
        </div>
        <button type="button" className="editor-close" onClick={onClose}>关闭</button>
      </div>

      <div className="editor-form">
        <label>
          <span>Config Key</span>
          <input value={configKey} onChange={(event) => onConfigKeyChange(event.target.value)} placeholder="configs/training/2026_btcjpy_v7_hf_rsi_macd_tp_atr.json" />
        </label>

        <label>
          <span>Config Type</span>
          <input value="training" readOnly disabled />
        </label>

        <div className="editor-mode-row">
          <div className="editor-mode-tabs">
            {supportsBasicMode && (
              <button
                type="button"
                className={`editor-mode-tab ${editorMode === 'basic' ? 'active' : ''}`}
                onClick={() => onModeChange('basic')}
              >
                基础模式
              </button>
            )}
            <button
              type="button"
              className={`editor-mode-tab ${editorMode === 'advanced' ? 'active' : ''}`}
              onClick={() => onModeChange('advanced')}
            >
              高级 JSON
            </button>
          </div>
          <div className="editor-mode-note">
            {supportsBasicMode && editorMode === 'basic'
              ? '先定关键参数，JSON 会自动同步。'
              : '直接编辑完整 JSON，适合补充高级字段。'}
          </div>
        </div>

        {supportsBasicMode && editorMode === 'basic' && (
          <TrainingGuidePanel
            draft={guideDraft}
            currentConfigKey={configKey}
            isNew={isNew}
            guideMeta={guideMeta}
            computedPreview={guidePreview}
            onChange={onGuideChange}
          />
        )}

        {(editorMode === 'advanced' || !supportsBasicMode) && (
          <label className="editor-textarea-wrap">
            <span>JSON Content</span>
            <textarea value={contentText} onChange={(event) => onContentChange(event.target.value)} spellCheck="false" />
          </label>
        )}

        {editorError && <div className="pipeline-error">{editorError}</div>}

        <div className="editor-actions">
          <button type="button" className="pipeline-refresh-button" onClick={onSave} disabled={saving}>
            {saving ? '保存中...' : '保存到数据库'}
          </button>
        </div>
      </div>
    </section>
  );
}

function RequestDetailPanel({ request, onClose }) {
  if (!request) {
    return null;
  }

  return (
    <section className="editor-panel">
      <div className="editor-panel-head">
        <div>
          <div className="hero-kicker">Run Detail</div>
          <h2>运行详情</h2>
        </div>
        <button type="button" className="editor-close" onClick={onClose}>关闭</button>
      </div>

      <div className="request-detail-grid">
        <div className="summary-box">
          <span>Request</span>
          <strong>{request.requestId}</strong>
          <em>{getRequestStatusText(request.status)}</em>
        </div>
        <div className="summary-box">
          <span>Action</span>
          <strong>{request.action}</strong>
          <em>{request.configType}</em>
        </div>
        <div className="summary-box">
          <span>Config</span>
          <strong>{request.configName || request.configKey}</strong>
          <em>{request.configKey}</em>
        </div>
      </div>

      <div className="pipeline-section">
        <div className="section-title">Timestamps</div>
        <div className="request-timeline">
          <div>created: {formatDateTime(request.createdAt)}</div>
          <div>started: {formatDateTime(request.startedAt)}</div>
          <div>completed: {formatDateTime(request.completedAt)}</div>
        </div>
      </div>

      {request.commandText && (
        <div className="pipeline-section">
          <div className="section-title">System Command</div>
          <div className="command-card">
            <pre>{request.commandText}</pre>
          </div>
        </div>
      )}

      {request.exportPath && (
        <div className="pipeline-section">
          <div className="section-title">Runtime Config Path</div>
          <div className="config-key">{request.exportPath}</div>
        </div>
      )}

      {(request.workerPid || request.executionPid) && (
        <div className="pipeline-section">
          <div className="section-title">Process</div>
          <div className="config-key">
            worker_pid={request.workerPid || 'n/a'} · execution_pid={request.executionPid || 'n/a'}
          </div>
        </div>
      )}

      {request.errorMessage && (
        <div className="pipeline-section">
          <div className="section-title">Error</div>
          <div className="queue-error">{request.errorMessage}</div>
        </div>
      )}

      <div className="pipeline-section">
        <div className="section-title">Log Excerpt</div>
        <div className="request-log-card">
          <pre>{request.logExcerpt || '暂无日志'}</pre>
        </div>
      </div>
    </section>
  );
}

function TrainPipelinePage() {
  const [pipelines, setPipelines] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [meta, setMeta] = useState(null);
  const [runRequests, setRunRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [configLoading, setConfigLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(true);
  const [error, setError] = useState('');
  const [configFilter, setConfigFilter] = useState('training');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorIsNew, setEditorIsNew] = useState(false);
  const [editorMode, setEditorMode] = useState('basic');
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [editorConfigKey, setEditorConfigKey] = useState('');
  const [editorConfigType, setEditorConfigType] = useState('training');
  const [editorContentText, setEditorContentText] = useState('{}');
  const [editorGuideDraft, setEditorGuideDraft] = useState(EMPTY_TRAINING_GUIDE_DRAFT);
  const [editorGuideMeta, setEditorGuideMeta] = useState(EMPTY_TRAINING_GUIDE_META);
  const [editorGuidePreview, setEditorGuidePreview] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [nextActionFeedbackByPipelineId, setNextActionFeedbackByPipelineId] = useState({});
  const [selectedStageByPipelineId, setSelectedStageByPipelineId] = useState({});
  const [routerStudioOpen, setRouterStudioOpen] = useState(false);
  const [routerStudioSaving, setRouterStudioSaving] = useState(false);
  const [routerStudioError, setRouterStudioError] = useState('');
  const [routerStudioData, setRouterStudioData] = useState(null);
  const [routerStudioRouterText, setRouterStudioRouterText] = useState('{}');
  const [routerStudioPolicyText, setRouterStudioPolicyText] = useState('{}');
  const [historyConfigKey, setHistoryConfigKey] = useState('');

  const loadPipeline = async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true);
        setError('');
      }
      const response = await trainPipelineAPI.getSummary();
      if (response.success) {
        setPipelines(response.data || []);
        setMeta(response.meta || null);
      } else {
        setError('接口返回失败');
      }
    } catch (apiError) {
      console.error('加载训练 pipeline 失败:', apiError);
      setError(apiError.message || '加载失败');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const loadConfigs = async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setConfigLoading(true);
      }
      const response = await trainConfigsAPI.list({ includeDerived: true, includeHistory: true });
      if (response.success) {
        setConfigs(response.data || []);
      }
    } catch (apiError) {
      console.error('加载配置库失败:', apiError);
    } finally {
      if (!silent) {
        setConfigLoading(false);
      }
    }
  };

  const loadRunRequests = async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setQueueLoading(true);
      }
      const response = await trainRunRequestsAPI.list({ limit: 20 });
      if (response.success) {
        setRunRequests(response.data || []);
      }
    } catch (apiError) {
      console.error('加载运行队列失败:', apiError);
    } finally {
      if (!silent) {
        setQueueLoading(false);
      }
    }
  };

  const refreshAll = async ({ silent = false } = {}) => {
    await Promise.all([
      loadPipeline({ silent }),
      loadConfigs({ silent }),
      loadRunRequests({ silent })
    ]);
  };

  const loadTrainingGuideBootstrap = async () => {
    const response = await trainConfigsAPI.getTrainingGuideBootstrap();
    if (!response.success) {
      throw new Error(response.message || '加载 training guide bootstrap 失败');
    }

    const guideMeta = {
      recommendations: response.data?.recommendations || [],
      options: response.data?.options || EMPTY_TRAINING_GUIDE_META.options,
      validationProfiles: response.data?.validationProfiles || []
    };
    setEditorGuideMeta(guideMeta);
    setEditorGuidePreview({
      configKey: response.data?.configKey || '',
      content: response.data?.content || {},
      recommendedTableName: response.data?.content?.database?.tableName || ''
    });
    setEditorGuideDraft(response.data?.draft || EMPTY_TRAINING_GUIDE_DRAFT);
    return response.data;
  };

  const buildGuideDraftFromApi = async (content, configKey) => {
    const response = await trainConfigsAPI.buildTrainingGuideDraft({
      content,
      configKey
    });
    if (!response.success) {
      throw new Error(response.message || '生成 training guide draft 失败');
    }
    return response.data;
  };

  const previewTrainingConfigFromApi = async (draft, baseConfig) => {
    const response = await trainConfigsAPI.previewTrainingConfig({
      draft,
      baseConfig
    });
    if (!response.success) {
      throw new Error(response.message || '生成 training config preview 失败');
    }

    setEditorGuidePreview(response.data);
    return response.data;
  };

  const openCreateEditor = async () => {
    const bootstrap = await loadTrainingGuideBootstrap();
    const nextConfig = bootstrap?.content || {};
    const nextConfigKey = bootstrap?.configKey || '';
    setEditorOpen(true);
    setEditorIsNew(true);
    setEditorMode('basic');
    setEditorError('');
    setActionMessage(null);
    setEditorConfigType('training');
    setEditorConfigKey(nextConfigKey);
    setEditorContentText(JSON.stringify(nextConfig, null, 2));
    setEditorGuideDraft(bootstrap?.draft || EMPTY_TRAINING_GUIDE_DRAFT);
    updateHashQuery({ configId: 'new' });
  };

  const handleBootstrapDefaultConfig = async () => {
    try {
      const bootstrap = await loadTrainingGuideBootstrap();
      const payload = {
        configKey: bootstrap.configKey,
        configType: 'training',
        content: bootstrap.content
      };
      const response = await trainConfigsAPI.save(payload);
      if (response.success) {
        setActionMessage({
          text: `已初始化默认 training config: ${response.data.configKey}`
        });
        await refreshAll();
      }
    } catch (apiError) {
      console.error('初始化默认配置失败:', apiError);
      setActionMessage({ text: `初始化失败: ${apiError.response?.data?.message || apiError.message}` });
    }
  };

  const openEditEditor = async (id) => {
    try {
      await loadTrainingGuideBootstrap();
      const response = await trainConfigsAPI.getById(id);
      if (response.success) {
        const record = response.data;
        const draft = await buildGuideDraftFromApi(record.content, record.configKey);
        setEditorOpen(true);
        setEditorIsNew(false);
        setEditorMode('basic');
        setEditorError('');
        setActionMessage(null);
        setEditorConfigKey(record.configKey);
        setEditorConfigType('training');
        setEditorContentText(JSON.stringify(record.content, null, 2));
        setEditorGuideDraft(draft);
        setEditorGuidePreview({
          configKey: record.configKey,
          content: record.content,
          recommendedTableName: record.content?.database?.tableName || ''
        });
        updateHashQuery({ configId: record.id });
      }
    } catch (apiError) {
      console.error('加载配置详情失败:', apiError);
      setActionMessage({ text: `加载配置失败: ${apiError.message}` });
    }
  };

  const handleSelectRequest = async (id, { syncHash = true, silent = false } = {}) => {
    try {
      const response = await trainRunRequestsAPI.getById(id);
      if (response.success) {
        setSelectedRequest(response.data);
        if (syncHash) {
          updateHashQuery({ requestId: response.data.id });
        }
      }
    } catch (apiError) {
      if (apiError?.response?.status === 404) {
        setSelectedRequest(null);
        updateHashQuery({ requestId: null });
        if (!silent) {
          setActionMessage({ text: '该运行请求已不存在，已从当前页面清除。' });
        }
        return;
      }

      console.error('加载运行详情失败:', apiError);
      if (!silent) {
        setActionMessage({ text: `加载详情失败: ${apiError.response?.data?.message || apiError.message}` });
      }
    }
  };

  const openRouterStudio = async (pipeline) => {
    try {
      const trainingConfig = configByKey[pipeline?.trainingConfigPath];
      if (!trainingConfig?.id) {
        setActionMessage({ text: '当前 pipeline 还没有找到可编辑的 training config。' });
        return;
      }

      setRouterStudioError('');
      const response = await trainConfigsAPI.getRouterArtifactsBootstrap(trainingConfig.id);
      if (!response.success) {
        throw new Error(response.message || '加载 router bootstrap 失败');
      }

      setRouterStudioData(response.data);
      setRouterStudioRouterText(JSON.stringify(response.data.routerContent || {}, null, 2));
      setRouterStudioPolicyText(JSON.stringify(response.data.policyContent || {}, null, 2));
      setRouterStudioOpen(true);
    } catch (apiError) {
      console.error('加载 router studio 失败:', apiError);
      setActionMessage({ text: `加载 Router Studio 失败: ${apiError.response?.data?.message || apiError.message}` });
    }
  };

  const handleSaveRouterArtifacts = async () => {
    try {
      if (!routerStudioData?.trainingConfigId) {
        return;
      }

      setRouterStudioSaving(true);
      setRouterStudioError('');
      const response = await trainConfigsAPI.saveRouterArtifacts(routerStudioData.trainingConfigId, {
        routerConfigKey: routerStudioData.routerConfigKey,
        policyConfigKey: routerStudioData.policyConfigKey,
        routerContent: routerStudioRouterText,
        policyContent: routerStudioPolicyText
      });

      if (response.success) {
        setActionMessage({
          text: `已保存 Router Artifacts: ${response.data.routerConfigKey} / ${response.data.policyConfigKey}`
        });
        setRouterStudioOpen(false);
        await refreshAll();
      }
    } catch (apiError) {
      console.error('保存 router artifacts 失败:', apiError);
      setRouterStudioError(apiError.response?.data?.message || apiError.message || '保存失败');
    } finally {
      setRouterStudioSaving(false);
    }
  };

  const applyRouterStudioStructuredUpdate = (updater) => {
    const parsedRouter = safeParseJsonText(routerStudioRouterText);
    if (!isPlainObject(parsedRouter)) {
      setRouterStudioError('Router JSON 不是合法对象，请先修复 JSON 后再使用表单编辑。');
      return;
    }

    const nextRouter = normalizeRouterContent(updater(parsedRouter));
    const nextPolicy = buildPolicyContentFromRouter(nextRouter, routerStudioData?.routerConfigKey);
    setRouterStudioRouterText(stringifyPrettyJson(nextRouter));
    setRouterStudioPolicyText(stringifyPrettyJson(nextPolicy));
    setRouterStudioError('');
  };

  const handleRouterStudioSyncPolicy = () => {
    const parsedRouter = safeParseJsonText(routerStudioRouterText);
    if (!isPlainObject(parsedRouter)) {
      setRouterStudioError('Router JSON 不是合法对象，无法自动重建 Policy。');
      return;
    }

    const nextRouter = normalizeRouterContent(parsedRouter);
    const nextPolicy = buildPolicyContentFromRouter(nextRouter, routerStudioData?.routerConfigKey);
    setRouterStudioRouterText(stringifyPrettyJson(nextRouter));
    setRouterStudioPolicyText(stringifyPrettyJson(nextPolicy));
    setRouterStudioError('');
  };

  const handleRouterStudioDefaultFallbackChange = (field, value) => {
    applyRouterStudioStructuredUpdate((currentRouter) => {
      const nextRouter = normalizeRouterContent(currentRouter);
      const currentFallback = isPlainObject(nextRouter.executionModel?.defaultFallback)
        ? nextRouter.executionModel.defaultFallback
        : { action: 'trade', riskMultiplier: 1 };
      const nextFallback = {
        ...currentFallback,
        ...(field === 'action'
          ? { action: value === 'reduce' ? 'reduce' : 'trade' }
          : {}),
        ...(field === 'riskMultiplier'
          ? { riskMultiplier: normalizeNumericValue(value) ?? 1 }
          : {}),
        ...(field === 'strategyKey'
          ? (String(value || '').trim()
            ? { strategyKey: String(value).trim() }
            : { strategyKey: undefined })
          : {})
      };

      return {
        ...nextRouter,
        executionModel: {
          ...(isPlainObject(nextRouter.executionModel) ? nextRouter.executionModel : {}),
          precedence: Array.isArray(nextRouter.executionModel?.precedence) && nextRouter.executionModel.precedence.length > 0
            ? nextRouter.executionModel.precedence
            : ROUTER_LAYER_KEYS,
          defaultFallback: {
            action: nextFallback.action === 'reduce' ? 'reduce' : 'trade',
            riskMultiplier: normalizeNumericValue(nextFallback.riskMultiplier) ?? 1,
            ...(String(nextFallback.strategyKey || '').trim()
              ? { strategyKey: String(nextFallback.strategyKey).trim() }
              : {})
          }
        }
      };
    });
  };

  const handleRouterStudioRuleChange = (index, field, value) => {
    applyRouterStudioStructuredUpdate((currentRouter) => updateRouterRules(currentRouter, (rules) => rules.map((rule, ruleIndex) => {
      if (ruleIndex !== index) {
        return rule;
      }

      const nextRule = {
        ...rule,
        action: isPlainObject(rule.action) ? { ...rule.action } : { type: 'trade' }
      };

      if (field === 'id') {
        nextRule.id = String(value || '').trim() || rule.id;
      } else if (field === 'layer') {
        nextRule.layer = normalizeRouterLayer(value);
      } else if (field === 'featureBucket') {
        const nextWhen = setRouterRuleFeatureBucket(rule.when, value);
        if (nextWhen) {
          nextRule.when = nextWhen;
        } else {
          delete nextRule.when;
        }
      } else if (field === 'actionType') {
        nextRule.action.type = ROUTER_ACTION_TYPES.includes(String(value || '')) ? String(value) : 'trade';
        if (nextRule.action.type === 'stop') {
          delete nextRule.action.strategyKey;
          delete nextRule.action.riskCap;
          delete nextRule.action.riskMultiplier;
        }
      } else if (field === 'riskCap') {
        const nextValue = normalizeNumericValue(value);
        if (nextValue == null) {
          delete nextRule.action.riskCap;
        } else {
          nextRule.action.riskCap = nextValue;
        }
      } else if (field === 'riskMultiplier') {
        const nextValue = normalizeNumericValue(value);
        if (nextValue == null) {
          delete nextRule.action.riskMultiplier;
        } else {
          nextRule.action.riskMultiplier = nextValue;
        }
      } else if (field === 'strategyKey') {
        const nextStrategyKey = String(value || '').trim();
        if (!nextStrategyKey) {
          delete nextRule.action.strategyKey;
        } else {
          nextRule.action.strategyKey = nextStrategyKey;
        }
      } else if (field === 'rationale') {
        nextRule.rationale = String(value || '');
      }

      return nextRule;
    })));
  };

  const handleRouterStudioAddRule = (layerKey) => {
    applyRouterStudioStructuredUpdate((currentRouter) => updateRouterRules(currentRouter, (rules) => {
      const nextRule = createEmptyRouterRule(layerKey);
      const insertIndex = rules.reduce((accumulator, item, itemIndex) => (
        normalizeRouterLayer(item.layer) === normalizeRouterLayer(layerKey)
          ? itemIndex + 1
          : accumulator
      ), rules.length);

      return [
        ...rules.slice(0, insertIndex),
        nextRule,
        ...rules.slice(insertIndex)
      ];
    }));
  };

  const handleRouterStudioRemoveRule = (index) => {
    applyRouterStudioStructuredUpdate((currentRouter) => updateRouterRules(currentRouter, (rules) => (
      rules.filter((_, ruleIndex) => ruleIndex !== index)
    )));
  };

  useEffect(() => {
    void refreshAll();

    const params = getHashQueryParams();
    const configId = params.get('configId');
    const requestId = params.get('requestId');

    if (configId === 'new') {
      openCreateEditor();
    } else if (configId) {
      openEditEditor(configId);
    }

    if (requestId) {
      void handleSelectRequest(requestId);
    }

    const timer = window.setInterval(() => {
      void refreshAll({ silent: true });
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedRequest?.id || !isActiveRequestStatus(selectedRequest.status)) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void handleSelectRequest(selectedRequest.id, { syncHash: false, silent: true });
    }, 2000);

    return () => window.clearInterval(timer);
  }, [selectedRequest?.id, selectedRequest?.status]);

  useEffect(() => {
    if (!editorOpen || editorConfigType !== 'training') {
      return;
    }

    const parsed = safeParseJsonText(editorContentText);
    if (!parsed) {
      return;
    }

    void buildGuideDraftFromApi(parsed, editorConfigKey)
      .then((draft) => setEditorGuideDraft(draft))
      .catch((apiError) => {
        console.error('同步 training guide draft 失败:', apiError);
      });
  }, [editorOpen, editorConfigType, editorConfigKey, editorContentText]);

  const handleSaveConfig = async () => {
    try {
      setEditorSaving(true);
      setEditorError('');
      const response = await trainConfigsAPI.save({
        configKey: editorConfigKey,
        configType: editorConfigType,
        content: editorContentText
      });

      if (response.success) {
        const messageText = `已保存到数据库: ${response.data.configKey}`;
        setActionMessage({ text: messageText });
        await refreshAll();
        setEditorOpen(false);
        updateHashQuery({ configId: null });
      }
    } catch (apiError) {
      console.error('保存配置失败:', apiError);
      setEditorError(apiError.response?.data?.message || apiError.message || '保存失败');
    } finally {
      setEditorSaving(false);
    }
  };

  const handleEditorConfigTypeChange = (value) => {
    setEditorConfigType('training');
    setEditorMode('basic');
    void value;
  };

  const handleGuideChange = async (field, value) => {
    const normalizedValue = field === 'validationProfile'
      ? normalizeValidationProfile(value)
      : value;
    const nextDraft = {
      ...editorGuideDraft,
      [field]: normalizedValue
    };

    if (field === 'startDate' || field === 'endDate') {
      if (nextDraft.validationProfile !== 'custom-range') {
        nextDraft.validationStartDate = nextDraft.startDate;
        nextDraft.validationEndDate = nextDraft.endDate;
      }
    } else if (field === 'validationProfile' && normalizedValue !== 'custom-range') {
      nextDraft.validationStartDate = nextDraft.startDate;
      nextDraft.validationEndDate = nextDraft.endDate;
    }

    setEditorGuideDraft(nextDraft);

    const parsed = safeParseJsonText(editorContentText);
    try {
      const preview = await previewTrainingConfigFromApi(
        nextDraft,
        parsed && typeof parsed === 'object'
          ? parsed
          : (editorGuidePreview?.content && typeof editorGuidePreview.content === 'object' ? editorGuidePreview.content : {})
      );
      setEditorContentText(JSON.stringify(preview.content, null, 2));

      if (editorIsNew) {
        setEditorConfigKey(preview.configKey);
      }
    } catch (apiError) {
      console.error('预览 training config 失败:', apiError);
      setEditorError(apiError.response?.data?.message || apiError.message || '预览配置失败');
    }
  };

  const handleExportConfig = async (id) => {
    try {
      const response = await trainConfigsAPI.exportConfig(id);
      if (response.success) {
        setActionMessage({
          text: `已导出到 ${response.data.exportedPath}`
        });
        await refreshAll();
      }
    } catch (apiError) {
      console.error('导出配置失败:', apiError);
      setActionMessage({ text: `导出失败: ${apiError.response?.data?.message || apiError.message}` });
    }
  };

  const handleClearConfigResults = async (config) => {
    if (!config?.id) {
      return;
    }

    const confirmText = config.configType === 'training'
      ? `确认删除 ${config.configName || config.configKey} 的训练数据吗？这会一并删除本次训练关联的 trades、tasks、strategies、train_configs、train_run_requests、回测结果、validation / top snapshot / router / policy 派生产物与自动生成报告。`
      : `确认清除 ${config.configName || config.configKey} 的验证结果吗？这会删除该 validation 的落库结果。`;

    if (typeof window !== 'undefined' && !window.confirm(confirmText)) {
      return;
    }

    try {
      const response = await trainConfigsAPI.clearResults(config.id);
      if (response.success) {
        const deletedFiles = Array.isArray(response.data?.deletedFiles) ? response.data.deletedFiles.length : 0;
        const deletedGroups = Array.isArray(response.data?.clearedResultGroups) ? response.data.clearedResultGroups.length : 0;
        const deletedReportFiles = Array.isArray(response.data?.deletedReportFiles) ? response.data.deletedReportFiles.length : 0;
        const deletedRequestRows = Number(response.data?.deletedRequestRows || 0);
        const deletedTaskRows = Number(response.data?.deletedTaskRows || 0);
        const deletedTradeRows = Number(response.data?.deletedTradeRows || 0);
        const deletedStrategyRows = Number(response.data?.deletedStrategyRows || 0);
        const deletedRegistryRows = Number(response.data?.deletedRegistryRows || 0);
        setActionMessage({
          text: `已删除 ${deletedGroups} 个结果分组、${response.data?.deletedBacktestRows || 0} 条回测结果、${deletedTradeRows} 条 trades、${deletedTaskRows} 条 tasks、${deletedStrategyRows} 条 strategies、${deletedRegistryRows} 条 train_configs、${deletedRequestRows} 条 train_run_requests${deletedFiles > 0 ? `，并清理 ${deletedFiles} 个派生配置文件` : ''}${deletedReportFiles > 0 ? `、${deletedReportFiles} 个自动生成报告` : ''}`
        });
        await refreshAll();
      }
    } catch (apiError) {
      console.error('清除训练结果失败:', apiError);
      setActionMessage({ text: `清除失败: ${apiError.response?.data?.message || apiError.message}` });
    }
  };

  const handleRunConfig = async (id, action = null) => {
    try {
      const response = await trainRunRequestsAPI.create({
        configId: id,
        requestedBy: 'ui',
        ...(action ? { action } : {})
      });

      if (response.success) {
        const request = response.data;
        const actionLabel = request.action === 'generate-validation'
          ? '生成 Validation'
          : request.action === 'build-router'
            ? '维护 Router / Policy'
          : request.action === 'validate'
            ? '验证'
            : request.action === 'feature-causality'
              ? '因果特征审计'
              : request.action === 'cost-sensitivity'
                ? '成本敏感度'
                : request.action === 'router-validate'
                  ? 'Router 验证'
                  : request.action === 'goal-tracking'
                    ? '目标达成追踪'
                  : '训练';
        setActionMessage({
          text: request.action === 'train'
            ? `${actionLabel} 主链路已加入队列: ${request.requestId} (${getRequestStatusText(request.status)})，后续步骤将自动串行执行`
            : request.action === 'build-router'
              ? `${actionLabel} 已加入队列: ${request.requestId} (${getRequestStatusText(request.status)})，完成后会自动刷新 pipeline`
              : `${actionLabel} 已加入队列: ${request.requestId} (${getRequestStatusText(request.status)})`
        });
        await refreshAll();
        await handleSelectRequest(request.id);
      }
    } catch (apiError) {
      console.error('提交运行请求失败:', apiError);
      setActionMessage({ text: `提交失败: ${apiError.response?.data?.message || apiError.message}` });
    }
  };

  const handleRetryRequest = async (id) => {
    try {
      const response = await trainRunRequestsAPI.retry(id, { requestedBy: 'ui' });
      if (response.success) {
        setActionMessage({
          text: `已重新入队: ${response.data.requestId} (${getRequestStatusText(response.data.status)})`
        });
        await refreshAll();
        await handleSelectRequest(response.data.id);
      }
    } catch (apiError) {
      console.error('重试运行请求失败:', apiError);
      setActionMessage({ text: `重试失败: ${apiError.response?.data?.message || apiError.message}` });
    }
  };

  const handleCancelRequest = async (id) => {
    try {
      const response = await trainRunRequestsAPI.cancel(id);
      if (response.success) {
        setActionMessage({
          text: `已取消请求: ${response.data.requestId}`
        });
        await refreshAll();
        await handleSelectRequest(response.data.id);
      }
    } catch (apiError) {
      console.error('取消运行请求失败:', apiError);
      setActionMessage({ text: `取消失败: ${apiError.response?.data?.message || apiError.message}` });
    }
  };

  const activeConfigs = configs.filter((item) => item.status === 'active');
  const filteredConfigs = activeConfigs.filter((item) => item.configType === configFilter);

  const latestRequestByConfigId = runRequests.reduce((accumulator, request) => {
    if (!(request.configId in accumulator)) {
      accumulator[request.configId] = request;
    }
    return accumulator;
  }, Object.create(null));

  const latestRequestByConfigKey = runRequests.reduce((accumulator, request) => {
    if (!(request.configKey in accumulator)) {
      accumulator[request.configKey] = request;
    }
    return accumulator;
  }, Object.create(null));

  const configByKey = activeConfigs.reduce((accumulator, config) => {
    accumulator[config.configKey] = config;
    return accumulator;
  }, Object.create(null));

  const configHistoryByKey = configs.reduce((accumulator, config) => {
    if (!accumulator[config.configKey]) {
      accumulator[config.configKey] = [];
    }
    accumulator[config.configKey].push(config);
    return accumulator;
  }, Object.create(null));

  Object.values(configHistoryByKey).forEach((items) => {
    items.sort((left, right) => Number(right.versionNo || 1) - Number(left.versionNo || 1));
  });

  const selectedHistoryItems = historyConfigKey ? (configHistoryByKey[historyConfigKey] || []) : [];

  const handlePipelineNextAction = async (pipeline) => {
    const actionKey = pipeline?.nextAction?.key;
    setNextActionFeedbackByPipelineId((current) => ({
      ...current,
      [pipeline.id]: ''
    }));

    if (actionKey === 'run-training') {
      const trainingConfig = configByKey[pipeline.trainingConfigPath];
      if (trainingConfig?.id) {
        await handleRunConfig(trainingConfig.id);
        setNextActionFeedbackByPipelineId((current) => ({
          ...current,
          [pipeline.id]: '训练主链路已加入队列，后续会自动接续生成 validation、执行验证并补报告。'
        }));
        return;
      }
    }

    if (actionKey === 'run-validation') {
      const pendingValidation = (pipeline.validationConfigs || [])
        .filter((item) => !item.latestRun && !isActiveRequestStatus(item.latestRequest?.status))
        .sort((left, right) => getValidationProfilePriority(left.validationProfile) - getValidationProfilePriority(right.validationProfile))[0];
      const validationConfig = pendingValidation ? configByKey[pendingValidation.path] : null;
      if (validationConfig?.id) {
        await handleRunConfig(validationConfig.id);
        setNextActionFeedbackByPipelineId((current) => ({
          ...current,
          [pipeline.id]: 'Validation 请求已加入队列。'
        }));
        return;
      }
    }

    if (actionKey === 'generate-validation' || actionKey === 'prepare-validation') {
      const trainingConfig = configByKey[pipeline.trainingConfigPath];
      if (trainingConfig?.id) {
        await handleRunConfig(trainingConfig.id, 'generate-validation');
        setNextActionFeedbackByPipelineId((current) => ({
          ...current,
          [pipeline.id]: 'Validation 生成任务已加入队列。'
        }));
        return;
      }
    }

    if (actionKey === 'feature-causality') {
      const trainingConfig = configByKey[pipeline.trainingConfigPath];
      if (trainingConfig?.id) {
        await handleRunConfig(trainingConfig.id, 'feature-causality');
        setNextActionFeedbackByPipelineId((current) => ({
          ...current,
          [pipeline.id]: '因果特征审计任务已加入队列。'
        }));
        return;
      }
    }

    if (actionKey === 'build-router') {
      const trainingConfig = configByKey[pipeline.trainingConfigPath];
      if (trainingConfig?.id) {
        await handleRunConfig(trainingConfig.id, 'build-router');
        setNextActionFeedbackByPipelineId((current) => ({
          ...current,
          [pipeline.id]: 'Router / policy 维护任务已加入队列。'
        }));
        return;
      }
    }

    if (actionKey === 'waiting-generate-validation' || actionKey === 'waiting-validation') {
      await refreshAll();
      setNextActionFeedbackByPipelineId((current) => ({
        ...current,
        [pipeline.id]: '已刷新当前执行状态。'
      }));
      return;
    }

    if (actionKey === 'cost-sensitivity' || actionKey === 'router-validate') {
      const latestValidation = (pipeline.validationConfigs || [])
        .filter((item) => item.latestRun)
        .sort((left, right) => new Date(right.latestRun?.latestAt || 0).getTime() - new Date(left.latestRun?.latestAt || 0).getTime())[0];
      const validationConfig = latestValidation ? configByKey[latestValidation.path] : null;

      if (validationConfig?.id) {
        await handleRunConfig(validationConfig.id, actionKey);
        setNextActionFeedbackByPipelineId((current) => ({
          ...current,
          [pipeline.id]: actionKey === 'cost-sensitivity'
            ? '成本敏感度任务已加入队列。'
            : 'Router 验证任务已加入队列。'
        }));
        return;
      }
    }

    const unsupportedMessage = actionKey === 'review'
        ? '这一步是结果复盘阶段，当前以看板汇总和人工判断为主。'
        : '当前步骤暂未接入自动执行，请根据页面说明继续。';

    setActionMessage({ text: unsupportedMessage });
    setNextActionFeedbackByPipelineId((current) => ({
      ...current,
      [pipeline.id]: unsupportedMessage
    }));
  };

  return (
    <div className="train-pipeline-page">
      <div className="train-pipeline-hero">
        <div>
          <div className="hero-kicker">Train Pipeline</div>
          <h1>方法论训练看板</h1>
          <p>
            按 `train/METHODOLOGY.md` 的标准执行流程组织训练 UI，围绕阶段推进、证据门槛和直接执行动作来管理每次训练。
          </p>
        </div>
        <div className="hero-actions">
          <div className={`db-chip ${meta?.dbConnected ? 'online' : 'offline'}`}>
            {meta?.dbConnected ? 'DB 已连接' : '仅文件态'}
          </div>
          <button type="button" className="pipeline-refresh-button" onClick={() => void refreshAll()}>
            刷新看板
          </button>
        </div>
      </div>

      <ConfigStudio
        configs={filteredConfigs}
        configHistoryByKey={configHistoryByKey}
        latestRequestByConfigId={latestRequestByConfigId}
        filterType={configFilter}
        onFilterChange={setConfigFilter}
        onBootstrap={handleBootstrapDefaultConfig}
        onCreate={openCreateEditor}
        onEdit={openEditEditor}
        onExport={handleExportConfig}
        onClear={handleClearConfigResults}
        onRun={handleRunConfig}
        onOpenHistory={setHistoryConfigKey}
        actionMessage={actionMessage}
      />

      <ResultsOverview pipelines={pipelines} meta={meta} />

      <QueuePanel
        requests={runRequests}
        onSelect={handleSelectRequest}
        onRetry={handleRetryRequest}
        onCancel={handleCancelRequest}
      />

      <EditorPanel
        open={editorOpen}
        isNew={editorIsNew}
        editorMode={editorMode}
        saving={editorSaving}
        editorError={editorError}
        configKey={editorConfigKey}
        configType={editorConfigType}
        contentText={editorContentText}
        guideDraft={editorGuideDraft}
        guideMeta={editorGuideMeta}
        guidePreview={editorGuidePreview}
        onClose={() => {
          setEditorOpen(false);
          updateHashQuery({ configId: null });
        }}
        onSave={handleSaveConfig}
        onModeChange={setEditorMode}
        onConfigKeyChange={setEditorConfigKey}
        onConfigTypeChange={handleEditorConfigTypeChange}
        onContentChange={setEditorContentText}
        onGuideChange={handleGuideChange}
      />

      <RouterStudioPanel
        open={routerStudioOpen}
        saving={routerStudioSaving}
        error={routerStudioError}
        data={routerStudioData}
        routerText={routerStudioRouterText}
        policyText={routerStudioPolicyText}
        onClose={() => setRouterStudioOpen(false)}
        onRouterTextChange={setRouterStudioRouterText}
        onPolicyTextChange={setRouterStudioPolicyText}
        onSyncPolicyFromRouter={handleRouterStudioSyncPolicy}
        onDefaultFallbackChange={handleRouterStudioDefaultFallbackChange}
        onRuleChange={handleRouterStudioRuleChange}
        onAddRule={handleRouterStudioAddRule}
        onRemoveRule={handleRouterStudioRemoveRule}
        onSave={handleSaveRouterArtifacts}
      />

      <ConfigHistoryPanel
        open={Boolean(historyConfigKey)}
        configKey={historyConfigKey}
        items={selectedHistoryItems}
        latestRequestByConfigId={latestRequestByConfigId}
        onClose={() => setHistoryConfigKey('')}
        onEdit={openEditEditor}
        onExport={handleExportConfig}
      />

      <RequestDetailPanel
        request={selectedRequest}
        onClose={() => {
          setSelectedRequest(null);
          updateHashQuery({ requestId: null });
        }}
      />

      {meta?.dbWarning && (
        <div className="pipeline-warning">
          数据库状态不可用，当前只展示文件系统推断结果: {meta.dbWarning}
        </div>
      )}

      {error && (
        <div className="pipeline-error">
          加载失败: {error}
        </div>
      )}

      {loading || configLoading || queueLoading ? (
        <div className="pipeline-loading">正在汇总训练流程...</div>
      ) : pipelines.length === 0 ? (
        <div className="pipeline-empty">
          <div>当前没有找到 training config。</div>
          <button type="button" className="pipeline-refresh-button" onClick={() => void handleBootstrapDefaultConfig()}>
            初始化默认 Training Config
          </button>
        </div>
      ) : (
        <div className="pipeline-grid">
          {pipelines.map((pipeline) => {
            const latestTrainingRequest = pipeline.latestRequest || latestRequestByConfigKey[pipeline.trainingConfigPath] || null;
            const trainingConfigRecord = configByKey[pipeline.trainingConfigPath] || null;
            const routerConfigRecord = findConfigVersionByKey(configHistoryByKey, pipeline.router?.routerPath);
            const policyConfigRecord = findConfigVersionByKey(configHistoryByKey, pipeline.router?.policyPath);
            const finalConfigState = getFinalConfigState(pipeline);
            const methodologyStages = buildMethodologyStages(pipeline);
            const suggestedStageKey = pipeline.suggestedStageKey || getSuggestedStageKey(methodologyStages);
            const selectedStageKey = selectedStageByPipelineId[pipeline.id] || suggestedStageKey;
            const focusStage = methodologyStages.find((stage) => stage.key === selectedStageKey) || methodologyStages[0];
            const focusOwnsAction = Boolean(focusStage?.actionKeys?.includes(pipeline.nextAction?.key));

            return (
              <section key={pipeline.id} className="pipeline-card">
                <div className="pipeline-card-head">
                  <div>
                    <div className="pipeline-badges">
                      <span className="pipeline-symbol">{pipeline.symbol}</span>
                      <span className="pipeline-year">{pipeline.trainingYear || 'Run'}</span>
                      <span className="pipeline-topn">Top {pipeline.topN}</span>
                      {latestTrainingRequest && (
                        <span className={`request-status-chip ${latestTrainingRequest.status}`}>
                          {getRequestStatusText(latestTrainingRequest.status)}
                        </span>
                      )}
                      {focusStage && (
                        <span className={`methodology-current-chip ${getStatusClass(focusStage.status)}`}>
                          {focusStage.label} · {focusStage.title}
                        </span>
                      )}
                    </div>
                    <h2>{pipeline.name}</h2>
                    <p>{pipeline.description || '未填写描述'}</p>
                  </div>
                  <div className="pipeline-side-meta">
                    <div>{formatRange(pipeline.timeRange)}</div>
                    <div>{pipeline.resultGroup}</div>
                  </div>
                </div>

                <div className="pipeline-summary-row">
                  <div className="summary-box">
                    <span>任务边界</span>
                    <strong>{pipeline.trainingConfigPath}</strong>
                    <em>{formatRange(pipeline.timeRange)} · updated {formatDateTime(pipeline.configUpdatedAt)}</em>
                    <div className="summary-box-chips">
                      {trainingConfigRecord ? (
                        <span className={`config-version-chip ${trainingConfigRecord.status || 'active'}`}>
                          training {formatConfigVersion(trainingConfigRecord)}
                        </span>
                      ) : null}
                    </div>
                    {trainingConfigRecord?.id && pipeline.trainingRun && (
                      <button
                        type="button"
                        className="summary-box-action"
                        onClick={() => handleClearConfigResults(trainingConfigRecord)}
                      >
                        删除训练数据
                      </button>
                    )}
                  </div>
                  <div className="summary-box">
                    <span>候选池</span>
                    <strong>{pipeline.trainingRun ? pipeline.trainingRun.runId : '尚未执行'}</strong>
                    <em>
                      {pipeline.trainingRun
                        ? `${pipeline.trainingRun.strategyCount} strategies · ${formatDateTime(pipeline.trainingRun.latestAt)}`
                        : '等待训练落库'}
                    </em>
                  </div>
                  <div className="summary-box">
                    <span>当前阶段</span>
                    <strong>
                      {focusStage ? `${focusStage.label} ${focusStage.title}` : '暂无阶段'}
                    </strong>
                    <em>
                      {focusStage
                        ? `${statusLabelMap[focusStage.status] || focusStage.status} · 对齐方法论主线`
                        : '等待识别'}
                    </em>
                    {latestTrainingRequest && (
                      <button type="button" className="summary-box-action" onClick={() => handleSelectRequest(latestTrainingRequest.id)}>
                        查看最新请求
                      </button>
                    )}
                  </div>
                  <div className="summary-box">
                    <span>关键产物</span>
                    <strong>{pipeline.router?.routerPath || finalConfigState.title}</strong>
                    <em>
                      {pipeline.router?.policyPath
                        ? `policy ${pipeline.router.policyPath}`
                        : finalConfigState.detail}
                    </em>
                    <div className="summary-box-chips">
                      {routerConfigRecord ? (
                        <span className={`config-version-chip ${routerConfigRecord.status || 'active'}`}>
                          router {formatConfigVersion(routerConfigRecord)}
                        </span>
                      ) : null}
                      {policyConfigRecord ? (
                        <span className={`config-version-chip ${policyConfigRecord.status || 'active'}`}>
                          policy {formatConfigVersion(policyConfigRecord)}
                        </span>
                      ) : null}
                    </div>
                    {finalConfigState.requestId && !pipeline.router?.policyPath && (
                      <button
                        type="button"
                        className="summary-box-action"
                        onClick={() => handleSelectRequest(finalConfigState.requestId)}
                      >
                        查看生成请求
                      </button>
                    )}
                    {finalConfigState.canExport && pipeline.topStrategySnapshot?.path && configByKey[pipeline.topStrategySnapshot.path]?.id && (
                      <button
                        type="button"
                        className="summary-box-action"
                        onClick={() => handleExportConfig(configByKey[pipeline.topStrategySnapshot.path].id)}
                      >
                        导出最终配置
                      </button>
                    )}
                  </div>
                </div>

                <div className="pipeline-section">
                  <div className="section-title">Result Console</div>
                  <PipelineResultsPanel
                    pipeline={pipeline}
                    onViewRequest={handleSelectRequest}
                    onOpenRouterStudio={openRouterStudio}
                  />
                </div>

                <div className="pipeline-section">
                  <div className="section-title">Methodology Flow</div>
                  <MethodologyStageOverview
                    stages={methodologyStages}
                    selectedStageKey={selectedStageKey}
                    onSelect={(stageKey) => setSelectedStageByPipelineId((current) => ({
                      ...current,
                      [pipeline.id]: stageKey
                    }))}
                  />
                </div>

                <div className="pipeline-section">
                  <div className="section-title">当前阶段说明</div>
                  <MethodologyStageFocus
                    stage={focusStage}
                    pipeline={pipeline}
                    showAction={focusOwnsAction}
                    onRunAction={handlePipelineNextAction}
                    feedback={nextActionFeedbackByPipelineId[pipeline.id]}
                  />
                  {!focusOwnsAction && (
                    <div className="next-action-card methodology-deviation-card">
                      <div className="next-action-head">
                        <strong>系统可执行动作</strong>
                        <span>
                          当前 worker 仍可直接执行「{pipeline.nextAction.title}」，但按 `METHODOLOGY` 建议先补齐所选阶段的证据与门槛。
                        </span>
                      </div>
                      {isUiRunnableAction(pipeline.nextAction.key) ? (
                        <div className="next-action-buttons">
                          <button
                            type="button"
                            className="pipeline-refresh-button next-action-primary"
                            onClick={() => void handlePipelineNextAction(pipeline)}
                          >
                            {getNextActionButtonLabel(pipeline.nextAction.key)}
                          </button>
                        </div>
                      ) : (
                        <div className="next-action-feedback">
                          这一步当前还没有接入自动执行，请根据下方说明继续处理。
                        </div>
                      )}
                      <GuidanceBlock commands={pipeline.nextAction.commands || []} />
                    </div>
                  )}
                </div>

                <div className="pipeline-section">
                  <div className="section-title">Validation</div>
                  <ValidationList items={pipeline.validationConfigs || []} onViewRequest={handleSelectRequest} />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default TrainPipelinePage;
