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
const DEFAULT_VALIDATION_PROFILE = 'future-window';

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
  if (normalized === 'future-window' || normalized === 'rolling-window' || normalized === 'custom-range') {
    return normalized;
  }
  return DEFAULT_VALIDATION_PROFILE;
}

function getValidationProfileLabel(value) {
  switch (normalizeValidationProfile(value)) {
    case 'future-window':
      return '未来期主验证';
    case 'rolling-window':
      return 'Rolling 强化验证';
    case 'custom-range':
      return '自定义区间';
    default:
      return '未来期主验证';
  }
}

function getValidationProfileTone(value) {
  switch (normalizeValidationProfile(value)) {
    case 'future-window':
      return 'done';
    case 'rolling-window':
      return 'partial';
    case 'custom-range':
      return 'todo';
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
    case 'future-window':
      return 1;
    case 'rolling-window':
      return 2;
    case 'custom-range':
      return 3;
    case 'legacy-annual':
      return 4;
    default:
      return 9;
  }
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

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (error) {
    console.error('复制失败:', error);
    return false;
  }
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

function CommandBlock({ commands }) {
  const [copied, setCopied] = useState('');

  const copyCommand = async (command) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
      window.setTimeout(() => setCopied(''), 1500);
    } catch (error) {
      console.error('复制命令失败:', error);
    }
  };

  return (
    <div className="command-list">
      {commands.map((command) => (
        <div key={command} className="command-card">
          <pre>{command}</pre>
          <button type="button" onClick={() => copyCommand(command)}>
            {copied === command ? '已复制' : '复制命令'}
          </button>
        </div>
      ))}
    </div>
  );
}

function getNextActionButtonLabel(nextActionKey) {
  switch (nextActionKey) {
    case 'run-training':
      return '执行阶段 3：训练候选池';
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
    detail: '先完成训练候选池，再生成最终策略 config。',
    status: 'todo',
    canExport: false,
    requestId: null
  };
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
  onCopyCommand,
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
          <div className="next-action-buttons">
            <button
              type="button"
              className="pipeline-refresh-button next-action-primary"
              onClick={() => void onRunAction(pipeline)}
            >
              {getNextActionButtonLabel(pipeline.nextAction.key)}
            </button>
            {!!pipeline.nextAction.commands?.length && (
              <button
                type="button"
                className="next-action-secondary"
                onClick={() => void onCopyCommand(pipeline)}
              >
                复制命令
              </button>
            )}
          </div>
          {feedback && (
            <div className="next-action-feedback">
              {feedback}
            </div>
          )}
          <CommandBlock commands={pipeline.nextAction.commands || []} />
        </div>
      )}
    </div>
  );
}

function ConfigStudio({
  configs,
  latestRequestByConfigId,
  filterType,
  onFilterChange,
  onBootstrap,
  onCreate,
  onEdit,
  onExport,
  onClear,
  onRun,
  actionMessage
}) {
  return (
    <section className="config-studio">
      <div className="config-studio-head">
        <div>
          <div className="hero-kicker">Config Studio</div>
          <h2>配置库</h2>
          <p>这里只维护单一主配置 `training config`。训练完成后会派生最终策略 config，validation 也从它继续生成。</p>
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
          {actionMessage.command && (
            <button type="button" onClick={() => copyText(actionMessage.command)}>
              复制命令
            </button>
          )}
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
          <span>Validation 起点</span>
          <input
            type="date"
            value={draft.validationStartDate}
            onChange={(event) => onChange('validationStartDate', event.target.value)}
            disabled={!usesCustomValidationRange}
          />
        </label>
        <label>
          <span>Validation 终点</span>
          <input
            type="date"
            value={draft.validationEndDate}
            onChange={(event) => onChange('validationEndDate', event.target.value)}
            disabled={false}
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
            {draft.validationProfile === 'future-window'
              ? `从 ${draft.validationStartDate} 开始，覆盖到 ${draft.validationEndDate}`
              : draft.validationProfile === 'rolling-window'
                ? `把 ${draft.validationStartDate} -> ${draft.validationEndDate} 拆成月度 rolling 验证窗口`
              : draft.validationProfile === 'custom-range'
                ? `${draft.validationStartDate} -> ${draft.validationEndDate}`
                : '按所选区间生成验证配置'}
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
                {draft.validationProfile === 'future-window'
                  ? '未来期主验证'
                  : draft.validationProfile === 'rolling-window'
                    ? 'Rolling 强化验证'
                  : draft.validationProfile === 'custom-range'
                    ? '自定义区间'
                    : '未来期主验证'}
              </span>
              <span className="validation-chip todo">由 training config 派生</span>
            </div>
            <div className="validation-path">{computed.configKey}</div>
            <div className="validation-meta">
              保存时不会单独创建 validation 草稿。
              {' · '}
              训练完成后通过 pipeline 的“下一步”生成最终策略 config 与可运行 validation。
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
          <div className="section-title">Command</div>
          <div className="command-card">
            <pre>{request.commandText}</pre>
            <button type="button" onClick={() => copyText(request.commandText)}>复制命令</button>
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
      const response = await trainConfigsAPI.list({ includeDerived: true });
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
      console.error('加载运行详情失败:', apiError);
      if (!silent) {
        setActionMessage({ text: `加载详情失败: ${apiError.response?.data?.message || apiError.message}` });
      }
    }
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
    const nextDraft = {
      ...editorGuideDraft,
      [field]: value
    };

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
          text: `已导出到 ${response.data.exportedPath}`,
          command: response.data.runCommand || ''
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
      ? `确认清除 ${config.configName || config.configKey} 的训练结果吗？这会删除训练结果，并清掉关联的 top snapshot / validation 派生产物。`
      : `确认清除 ${config.configName || config.configKey} 的验证结果吗？这会删除该 validation 的落库结果。`;

    if (typeof window !== 'undefined' && !window.confirm(confirmText)) {
      return;
    }

    try {
      const response = await trainConfigsAPI.clearResults(config.id);
      if (response.success) {
        const deletedFiles = Array.isArray(response.data?.deletedFiles) ? response.data.deletedFiles.length : 0;
        const deletedGroups = Array.isArray(response.data?.clearedResultGroups) ? response.data.clearedResultGroups.length : 0;
        setActionMessage({
          text: `已清除 ${deletedGroups} 个结果分组，删除 ${response.data?.deletedBacktestRows || 0} 条回测结果${deletedFiles > 0 ? `，并清理 ${deletedFiles} 个历史遗留导出文件` : ''}`
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
        const actionLabel = action === 'generate-validation'
          ? '生成 Future Validation'
          : request.action === 'validate'
            ? '验证'
            : '训练';
        setActionMessage({
          text: `${actionLabel} 已加入队列: ${request.requestId} (${getRequestStatusText(request.status)})`
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

  const filteredConfigs = configs.filter((item) => item.configType === configFilter);

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

  const configByKey = configs.reduce((accumulator, config) => {
    accumulator[config.configKey] = config;
    return accumulator;
  }, Object.create(null));

  const handleCopyNextCommand = async (pipeline) => {
    const firstCommand = pipeline?.nextAction?.commands?.[0];
    if (!firstCommand) {
      setActionMessage({ text: '当前步骤还没有可复制的命令。' });
      setNextActionFeedbackByPipelineId((current) => ({
        ...current,
        [pipeline?.id || 'unknown']: '当前步骤还没有可复制的命令。'
      }));
      return;
    }

    const copied = await copyText(firstCommand);
    const feedbackText = copied
      ? `已复制下一步命令，请到终端执行: ${pipeline.nextAction.title}`
      : '浏览器未完成复制，请直接使用下方命令卡片中的命令。';

    setActionMessage({
      text: feedbackText,
      command: firstCommand
    });
    setNextActionFeedbackByPipelineId((current) => ({
      ...current,
      [pipeline.id]: feedbackText
    }));
  };

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
          [pipeline.id]: '训练请求已加入队列。'
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

    if (actionKey === 'generate-validation') {
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

    if (actionKey === 'waiting-generate-validation' || actionKey === 'waiting-validation') {
      await refreshAll();
      setNextActionFeedbackByPipelineId((current) => ({
        ...current,
        [pipeline.id]: '已刷新当前执行状态。'
      }));
      return;
    }

    await handleCopyNextCommand(pipeline);
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
        latestRequestByConfigId={latestRequestByConfigId}
        filterType={configFilter}
        onFilterChange={setConfigFilter}
        onBootstrap={handleBootstrapDefaultConfig}
        onCreate={openCreateEditor}
        onEdit={openEditEditor}
        onExport={handleExportConfig}
        onClear={handleClearConfigResults}
        onRun={handleRunConfig}
        actionMessage={actionMessage}
      />

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
                    {trainingConfigRecord?.id && (
                      <button
                        type="button"
                        className="summary-box-action"
                        onClick={() => handleClearConfigResults(trainingConfigRecord)}
                      >
                        清除训练数据
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
                    onCopyCommand={handleCopyNextCommand}
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
                      <div className="next-action-buttons">
                        <button
                          type="button"
                          className="pipeline-refresh-button next-action-primary"
                          onClick={() => void handlePipelineNextAction(pipeline)}
                        >
                          {getNextActionButtonLabel(pipeline.nextAction.key)}
                        </button>
                        {!!pipeline.nextAction.commands?.length && (
                          <button
                            type="button"
                            className="next-action-secondary"
                            onClick={() => void handleCopyNextCommand(pipeline)}
                          >
                            复制命令
                          </button>
                        )}
                      </div>
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
