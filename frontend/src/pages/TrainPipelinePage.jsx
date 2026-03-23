import { useEffect, useState } from 'react';
import { trainConfigsAPI, trainPipelineAPI } from '../api/api';
import './TrainPipelinePage.css';

const statusLabelMap = {
  done: '已完成',
  partial: '部分完成',
  todo: '待执行',
  running: '执行中',
};

const configTypeOptions = [
  { value: 'all', label: '全部配置' },
  { value: 'training', label: 'Training' },
  { value: 'validation', label: 'Validation' },
  { value: 'top-strategies', label: 'Top Snapshot' },
  { value: 'router', label: 'Router' },
];

function buildDefaultTrainingTemplate() {
  const currentYear = new Date().getFullYear();
  return {
    name: `${currentYear}_BTCJPY_NEW_RUN`,
    description: `${currentYear} BTCJPY new run`,
    timeRange: {
      startTimeMs: Date.UTC(currentYear, 0, 1, 0, 0, 0),
      endTimeMs: Date.UTC(currentYear, 11, 31, 23, 59, 0),
      startIso: `${currentYear}-01-01T00:00:00.000Z`,
      endIso: `${currentYear}-12-31T23:59:00.000Z`
    },
    market: {
      symbol: 'BTCJPY',
      intervalType: '1min'
    },
    database: {
      tableName: `btcjpy_new_run_train_${currentYear}`,
      resetTableBeforeRun: true
    },
    strategy: {
      types: ['rsi_macd'],
      parameters: {
        rsi: {
          period: [5, 7],
          oversold: [32, 35],
          overbought: [65, 68]
        },
        macd: {
          fastPeriod: [4, 6],
          slowPeriod: [9, 12],
          signalPeriod: [3, 4],
          histogramThreshold: [0]
        },
        risk: {
          maxPositions: [1],
          lotSize: [0.008],
          maxHoldMinutes: [6, 8]
        },
        atr: {
          slMultiplier: [1.5, 2],
          tpMultiplier: [1, 1.5]
        },
        tradingSchedule: '* 12-18 * * 1-5',
        tradingTimeRestriction: null
      }
    },
    executor: {
      version: 'v3',
      options: {
        enableATRSizing: true,
        feeModel: {
          venueCode: 'GMOCOIN',
          commissionRate: 0.00002,
          basis: 'notional',
          chargeOnEntry: true,
          chargeOnExit: true
        }
      }
    },
    output: {
      topN: 10,
      strategyNamePrefix: `${currentYear}-BTCJPY-NEW-`,
      descriptionPrefix: `${currentYear} BTCJPY new run`
    }
  };
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

function PipelineStep({ step }) {
  const statusClass = getStatusClass(step.status);

  return (
    <div className={`pipeline-step ${statusClass}`}>
      <div className="pipeline-step-dot" />
      <div className="pipeline-step-body">
        <div className="pipeline-step-title">{step.title}</div>
        <div className="pipeline-step-status">{statusLabelMap[step.status] || step.status}</div>
        <div className="pipeline-step-detail">{step.detail}</div>
      </div>
    </div>
  );
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (error) {
    console.error('复制失败:', error);
  }
}

function ValidationList({ items }) {
  if (!items.length) {
    return <div className="pipeline-empty">还没有匹配到 validation config。</div>;
  }

  return (
    <div className="validation-list">
      {items.map((item) => (
        <div key={item.path} className="validation-item">
          <div className="validation-item-head">
            <span className="validation-target">{item.targetLabel}</span>
            <span className={`validation-chip ${item.latestRun ? 'done' : 'todo'}`}>
              {item.latestRun ? '已落库' : '未执行'}
            </span>
          </div>
          <div className="validation-path">{item.path}</div>
          <div className="validation-meta">
            {item.resultGroup}
            {item.latestRun ? ` · latest ${formatDateTime(item.latestRun.latestAt)}` : ''}
          </div>
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

function ConfigStudio({
  configs,
  filterType,
  onFilterChange,
  onCreate,
  onEdit,
  onExport,
  actionMessage
}) {
  return (
    <section className="config-studio">
      <div className="config-studio-head">
        <div>
          <div className="hero-kicker">Config Studio</div>
          <h2>配置库</h2>
          <p>配置优先保存在数据库，需要时再导出到 `train/configs`。</p>
        </div>
        <div className="config-studio-actions">
          <select value={filterType} onChange={(event) => onFilterChange(event.target.value)}>
            {configTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
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
          <div className="pipeline-empty">当前筛选下没有配置。</div>
        ) : (
          configs.map((config) => (
            <div key={config.id} className="config-row">
              <div className="config-row-main">
                <div className="config-row-top">
                  <span className="config-type-chip">{config.configType}</span>
                  {config.symbol && <span className="pipeline-symbol">{config.symbol}</span>}
                  {config.trainingYear && <span className="pipeline-year">{config.trainingYear}</span>}
                </div>
                <strong>{config.configName || config.fileName}</strong>
                <div className="config-key">{config.configKey}</div>
                <div className="config-meta">
                  {config.resultGroup || 'no result_group'}
                  {' · '}
                  synced {formatDateTime(config.syncedAt)}
                </div>
              </div>
              <div className="config-row-actions">
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

function EditorPanel({
  open,
  saving,
  editorError,
  configKey,
  configType,
  contentText,
  onClose,
  onSave,
  onConfigKeyChange,
  onConfigTypeChange,
  onContentChange
}) {
  if (!open) {
    return null;
  }

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
          <input value={configKey} onChange={(event) => onConfigKeyChange(event.target.value)} placeholder="configs/training/2026_btcjpy_new_run.json" />
        </label>

        <label>
          <span>Config Type</span>
          <select value={configType} onChange={(event) => onConfigTypeChange(event.target.value)}>
            {configTypeOptions.filter((option) => option.value !== 'all').map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="editor-textarea-wrap">
          <span>JSON Content</span>
          <textarea value={contentText} onChange={(event) => onContentChange(event.target.value)} spellCheck="false" />
        </label>

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

function TrainPipelinePage() {
  const [pipelines, setPipelines] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [configLoading, setConfigLoading] = useState(true);
  const [error, setError] = useState('');
  const [configFilter, setConfigFilter] = useState('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [editorConfigKey, setEditorConfigKey] = useState(`configs/training/${new Date().getFullYear()}_btcjpy_new_run.json`);
  const [editorConfigType, setEditorConfigType] = useState('training');
  const [editorContentText, setEditorContentText] = useState(JSON.stringify(buildDefaultTrainingTemplate(), null, 2));
  const [actionMessage, setActionMessage] = useState(null);

  const loadPipeline = async () => {
    try {
      setLoading(true);
      setError('');
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
      setLoading(false);
    }
  };

  const loadConfigs = async () => {
    try {
      setConfigLoading(true);
      const response = await trainConfigsAPI.list();
      if (response.success) {
        setConfigs(response.data || []);
      }
    } catch (apiError) {
      console.error('加载配置库失败:', apiError);
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    loadPipeline();
    loadConfigs();
  }, []);

  const openCreateEditor = () => {
    setEditorOpen(true);
    setEditorError('');
    setActionMessage(null);
    setEditorConfigType('training');
    setEditorConfigKey(`configs/training/${new Date().getFullYear()}_btcjpy_new_run.json`);
    setEditorContentText(JSON.stringify(buildDefaultTrainingTemplate(), null, 2));
  };

  const openEditEditor = async (id) => {
    try {
      const response = await trainConfigsAPI.getById(id);
      if (response.success) {
        const record = response.data;
        setEditorOpen(true);
        setEditorError('');
        setActionMessage(null);
        setEditorConfigKey(record.configKey);
        setEditorConfigType(record.configType);
        setEditorContentText(JSON.stringify(record.content, null, 2));
      }
    } catch (apiError) {
      console.error('加载配置详情失败:', apiError);
      setActionMessage({ text: `加载配置失败: ${apiError.message}` });
    }
  };

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
        setActionMessage({ text: `已保存到数据库: ${response.data.configKey}` });
        await Promise.all([loadConfigs(), loadPipeline()]);
        setEditorOpen(false);
      }
    } catch (apiError) {
      console.error('保存配置失败:', apiError);
      setEditorError(apiError.response?.data?.message || apiError.message || '保存失败');
    } finally {
      setEditorSaving(false);
    }
  };

  const handleExportConfig = async (id) => {
    try {
      const response = await trainConfigsAPI.exportConfig(id);
      if (response.success) {
        const exportedPath = response.data.exportedPath;
        setActionMessage({
          text: `已导出到 ${exportedPath}`,
          command: response.data.runCommand || ''
        });
        await Promise.all([loadConfigs(), loadPipeline()]);
      }
    } catch (apiError) {
      console.error('导出配置失败:', apiError);
      setActionMessage({ text: `导出失败: ${apiError.response?.data?.message || apiError.message}` });
    }
  };

  const filteredConfigs = configFilter === 'all'
    ? configs
    : configs.filter((item) => item.configType === configFilter);

  return (
    <div className="train-pipeline-page">
      <div className="train-pipeline-hero">
        <div>
          <div className="hero-kicker">Train Pipeline</div>
          <h1>训练流程看板</h1>
          <p>
            以 training config 为主线，把训练、validation、报告、router 状态串成一条可视化流程。
          </p>
        </div>
        <div className="hero-actions">
          <div className={`db-chip ${meta?.dbConnected ? 'online' : 'offline'}`}>
            {meta?.dbConnected ? 'DB 已连接' : '仅文件态'}
          </div>
          <button type="button" className="pipeline-refresh-button" onClick={loadPipeline}>
            刷新看板
          </button>
        </div>
      </div>

      <ConfigStudio
        configs={filteredConfigs}
        filterType={configFilter}
        onFilterChange={setConfigFilter}
        onCreate={openCreateEditor}
        onEdit={openEditEditor}
        onExport={handleExportConfig}
        actionMessage={actionMessage}
      />

      <EditorPanel
        open={editorOpen}
        saving={editorSaving}
        editorError={editorError}
        configKey={editorConfigKey}
        configType={editorConfigType}
        contentText={editorContentText}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaveConfig}
        onConfigKeyChange={setEditorConfigKey}
        onConfigTypeChange={setEditorConfigType}
        onContentChange={setEditorContentText}
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

      {loading || configLoading ? (
        <div className="pipeline-loading">正在汇总训练流程...</div>
      ) : pipelines.length === 0 ? (
        <div className="pipeline-empty">当前没有找到 training config。</div>
      ) : (
        <div className="pipeline-grid">
          {pipelines.map((pipeline) => (
            <section key={pipeline.id} className="pipeline-card">
              <div className="pipeline-card-head">
                <div>
                  <div className="pipeline-badges">
                    <span className="pipeline-symbol">{pipeline.symbol}</span>
                    <span className="pipeline-year">{pipeline.trainingYear || 'Run'}</span>
                    <span className="pipeline-topn">Top {pipeline.topN}</span>
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
                  <span>Training Config</span>
                  <strong>{pipeline.trainingConfigPath}</strong>
                  <em>updated {formatDateTime(pipeline.configUpdatedAt)}</em>
                </div>
                <div className="summary-box">
                  <span>Latest Training</span>
                  <strong>{pipeline.trainingRun ? pipeline.trainingRun.runId : '尚未执行'}</strong>
                  <em>
                    {pipeline.trainingRun
                      ? `${pipeline.trainingRun.strategyCount} strategies · ${formatDateTime(pipeline.trainingRun.latestAt)}`
                      : '等待训练落库'}
                  </em>
                </div>
                <div className="summary-box">
                  <span>Top Snapshot</span>
                  <strong>{pipeline.topStrategySnapshot ? pipeline.topStrategySnapshot.path : '尚未生成'}</strong>
                  <em>
                    {pipeline.topStrategySnapshot
                      ? `generated ${formatDateTime(pipeline.topStrategySnapshot.generatedAt)}`
                      : '等待导出 Top 策略'}
                  </em>
                </div>
              </div>

              <div className="pipeline-steps">
                {pipeline.steps.map((step) => (
                  <PipelineStep key={step.key} step={step} />
                ))}
              </div>

              <div className="pipeline-section">
                <div className="section-title">Validation</div>
                <ValidationList items={pipeline.validationConfigs || []} />
              </div>

              <div className="pipeline-section">
                <div className="section-title">Next Action</div>
                <div className="next-action-card">
                  <div className="next-action-head">
                    <strong>{pipeline.nextAction.title}</strong>
                    <span>{pipeline.nextAction.reason}</span>
                  </div>
                  <CommandBlock commands={pipeline.nextAction.commands || []} />
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default TrainPipelinePage;
