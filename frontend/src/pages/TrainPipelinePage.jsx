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

const DEFAULT_TRAINING_SYMBOL = 'BTCJPY';
const DEFAULT_TRAINING_RUN_TAG = 'V7_HF_RSI_MACD_TP_ATR';
const DEFAULT_TRADING_SCHEDULE = '* 12-18 * * 1-5';
const TRAINING_YEAR_OPTIONS = ['2024', '2025', '2026'];
const TRAINING_SYMBOL_OPTIONS = [DEFAULT_TRAINING_SYMBOL];
const INTERVAL_OPTIONS = ['1min', '5min', '15min', '1h'];
const STRATEGY_TYPE_OPTIONS = ['rsi_macd'];
const TOP_N_OPTIONS = ['5', '10', '20', '30'];
const LOT_SIZE_OPTIONS = ['0.004', '0.008', '0.01', '0.02'];
const HOLD_MIN_OPTIONS = ['4', '6', '8', '10', '12'];
const HOLD_MAX_OPTIONS = ['6', '8', '10', '12', '15'];
const TRADING_SCHEDULE_OPTIONS = [
  DEFAULT_TRADING_SCHEDULE,
  '* 0-23 * * 1-5',
  '* 8-16 * * 1-5',
  '* 12-20 * * 1-5'
];
const VALIDATION_PROFILE_OPTIONS = [
  { value: 'future-window', label: '未来期窗口', hint: 'Recommended' },
  { value: 'custom-range', label: '自定义区间', hint: 'Manual' },
  { value: 'annual-template', label: '年度模板', hint: 'Legacy' }
];
const VALIDATION_TIME_RANGES = {
  '2024': {
    startTimeMs: 1704067200000,
    endTimeMs: 1735689540000,
    startIso: '2024-01-01T00:00:00.000Z',
    endIso: '2024-12-31T23:59:00.000Z'
  },
  '2026': {
    startTimeMs: 1767225600000,
    endTimeMs: 1773964740000,
    startIso: '2026-01-01T00:00:00.000Z',
    endIso: '2026-03-19T23:59:00.000Z'
  }
};
const TRAINING_GUIDE_RECOMMENDATIONS = [
  '首次训练建议从 BTCJPY + 1min 开始，先验证主链路是否跑通。',
  'Top N 建议先固定为 10，先看候选池质量，再考虑扩容。',
  'lotSize 建议先固定 0.008，避免一次改太多维度。',
  'maxHoldMinutes 建议先用 6 到 8 分钟，控制高频策略持仓时长。',
  '如果只是第一次创建配置，router 路径可以先留空，等训练和 validation 跑通后再补。',
  '默认验证方案改为 future-window，优先检查训练结束后的未来区间是否能泛化。',
  '年度验证不再是默认主链路，只保留为兼容模板。'
];

function buildDefaultTrainingTemplate() {
  const currentYear = new Date().getFullYear();
  const normalizedRunTag = DEFAULT_TRAINING_RUN_TAG.toLowerCase();
  return {
    name: `${currentYear}_${DEFAULT_TRAINING_SYMBOL}_${DEFAULT_TRAINING_RUN_TAG}`,
    description: `${currentYear} ${DEFAULT_TRAINING_SYMBOL} ${DEFAULT_TRAINING_RUN_TAG.replace(/_/g, ' ')}`,
    timeRange: {
      startTimeMs: Date.UTC(currentYear, 0, 1, 0, 0, 0),
      endTimeMs: Date.UTC(currentYear, 11, 31, 23, 59, 0),
      startIso: `${currentYear}-01-01T00:00:00.000Z`,
      endIso: `${currentYear}-12-31T23:59:00.000Z`
    },
    market: {
      symbol: DEFAULT_TRAINING_SYMBOL,
      intervalType: '1min'
    },
    database: {
      tableName: `${DEFAULT_TRAINING_SYMBOL.toLowerCase()}_${normalizedRunTag}_train_${currentYear}`,
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
        tradingSchedule: DEFAULT_TRADING_SCHEDULE,
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
      strategyNamePrefix: `${currentYear}-${DEFAULT_TRAINING_SYMBOL}-${DEFAULT_TRAINING_RUN_TAG.replace(/_/g, '-')}-`,
      descriptionPrefix: `${currentYear} ${DEFAULT_TRAINING_SYMBOL} ${DEFAULT_TRAINING_RUN_TAG.replace(/_/g, ' ')}`
    }
  };
}

function safeParseJsonText(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sanitizeToken(value, fallback = 'run') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}

function formatDisplayTag(value) {
  return sanitizeToken(value, DEFAULT_TRAINING_RUN_TAG).toUpperCase();
}

function formatSlugTag(value) {
  return sanitizeToken(value, DEFAULT_TRAINING_RUN_TAG).toLowerCase();
}

function formatDateInput(value, fallback) {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toISOString().slice(0, 10);
}

function parseDateInputToUtcMs(dateInput, endOfDay = false) {
  const match = String(dateInput || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    0
  );
}

function parseDateInputToIso(dateInput, endOfDay = false) {
  const utcMs = parseDateInputToUtcMs(dateInput, endOfDay);
  return utcMs == null ? null : new Date(utcMs).toISOString();
}

function addUtcDays(dateInput, days) {
  const utcMs = parseDateInputToUtcMs(dateInput, false);
  if (utcMs == null) {
    return null;
  }

  return new Date(utcMs + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function splitStrategyTypes(value) {
  const items = String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? Array.from(new Set(items)) : ['rsi_macd'];
}

function inferTrainingRunTag(config) {
  const rawName = String(config?.name || '');
  const tokens = rawName.split('_').filter(Boolean);
  const symbol = String(config?.market?.symbol || DEFAULT_TRAINING_SYMBOL).toUpperCase();

  if (tokens[0] && /^\d{4}$/.test(tokens[0])) {
    tokens.shift();
  }

  if (tokens[0] && tokens[0].toUpperCase() === symbol) {
    tokens.shift();
  }

  return tokens.join('_') || DEFAULT_TRAINING_RUN_TAG;
}

function getFileBaseName(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const normalized = text.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function getYearFromConfig(config, fallbackName) {
  const baseYear = String(fallbackName || '').match(/^(\d{4})_/);
  if (baseYear) {
    return baseYear[1];
  }

  const startIso = config?.timeRange?.startIso;
  if (startIso) {
    const year = new Date(startIso).getUTCFullYear();
    if (!Number.isNaN(year)) {
      return String(year);
    }
  }

  const startMs = config?.timeRange?.startTimeMs;
  if (startMs != null) {
    const year = new Date(Number(startMs)).getUTCFullYear();
    if (!Number.isNaN(year)) {
      return String(year);
    }
  }

  return null;
}

function buildTrainingGuideDraft(content, configKey) {
  const currentYear = new Date().getFullYear();
  const parsed = content && typeof content === 'object' ? content : buildDefaultTrainingTemplate();
  const startDate = formatDateInput(parsed?.timeRange?.startIso || parsed?.timeRange?.startTimeMs, `${currentYear}-01-01`);
  const endDate = formatDateInput(parsed?.timeRange?.endIso || parsed?.timeRange?.endTimeMs, `${currentYear}-12-31`);
  const year = String(startDate).slice(0, 4) || String(currentYear);
  const holdMinutes = Array.isArray(parsed?.strategy?.parameters?.risk?.maxHoldMinutes)
    ? parsed.strategy.parameters.risk.maxHoldMinutes
    : [6, 8];
  const validationPlan = parsed?.validationPlan && typeof parsed.validationPlan === 'object'
    ? parsed.validationPlan
    : {};
  const validationProfile = String(validationPlan.profile || 'future-window');
  const customRange = validationPlan.customRange && typeof validationPlan.customRange === 'object'
    ? validationPlan.customRange
    : {};
  const futureValidationStartDate = addUtcDays(endDate, 1) || `${currentYear + 1}-01-01`;
  const fallbackValidationEndDate = new Date().toISOString().slice(0, 10);

  return {
    year,
    symbol: String(parsed?.market?.symbol || DEFAULT_TRAINING_SYMBOL).toUpperCase(),
    runTag: inferTrainingRunTag(parsed),
    startDate,
    endDate,
    intervalType: String(parsed?.market?.intervalType || '1min'),
    topN: Number(parsed?.output?.topN || 10),
    strategyTypes: Array.isArray(parsed?.strategy?.types) && parsed.strategy.types.length > 0
      ? parsed.strategy.types.join(', ')
      : 'rsi_macd',
    lotSize: String(parsed?.strategy?.parameters?.risk?.lotSize?.[0] ?? 0.008),
    maxHoldMin: String(holdMinutes[0] ?? 6),
    maxHoldMax: String(holdMinutes[holdMinutes.length - 1] ?? 8),
    tradingSchedule: String(parsed?.strategy?.parameters?.tradingSchedule || DEFAULT_TRADING_SCHEDULE),
    tableName: String(parsed?.database?.tableName || ''),
    routerConfigPath: String(parsed?.regimeRouting?.routerConfigPath || ''),
    validationProfile,
    validationStartDate: formatDateInput(customRange.startIso || futureValidationStartDate, futureValidationStartDate),
    validationEndDate: formatDateInput(customRange.endIso || fallbackValidationEndDate, fallbackValidationEndDate),
    configKey: String(configKey || '')
  };
}

function buildTrainingConfigFromGuide(draft, baseConfig) {
  const year = String(draft?.year || new Date().getFullYear()).slice(0, 4);
  const symbol = String(draft?.symbol || DEFAULT_TRAINING_SYMBOL).toUpperCase();
  const runTagDisplay = formatDisplayTag(draft?.runTag);
  const runTagSlug = formatSlugTag(draft?.runTag);
  const startDate = draft?.startDate || `${year}-01-01`;
  const endDate = draft?.endDate || `${year}-12-31`;
  const startTimeMs = parseDateInputToUtcMs(startDate, false) ?? Date.UTC(Number(year), 0, 1, 0, 0, 0);
  const endTimeMs = parseDateInputToUtcMs(endDate, true) ?? Date.UTC(Number(year), 11, 31, 23, 59, 0);
  const startIso = parseDateInputToIso(startDate, false) ?? new Date(startTimeMs).toISOString();
  const endIso = parseDateInputToIso(endDate, true) ?? new Date(endTimeMs).toISOString();
  const intervalType = String(draft?.intervalType || '1min');
  const topN = Math.max(1, Number(draft?.topN || 10));
  const strategyTypes = splitStrategyTypes(draft?.strategyTypes);
  const lotSize = Number(draft?.lotSize || 0.008);
  const maxHoldMin = Number(draft?.maxHoldMin || 6);
  const maxHoldMax = Number(draft?.maxHoldMax || maxHoldMin || 8);
  const tableName = String(draft?.tableName || `${symbol.toLowerCase()}_${runTagSlug}_train_${year}`);
  const routerConfigPath = String(draft?.routerConfigPath || '').trim();
  const validationProfile = String(draft?.validationProfile || 'future-window');
  const validationStartDate = String(draft?.validationStartDate || addUtcDays(endDate, 1) || `${Number(year) + 1}-01-01`);
  const validationEndDate = String(draft?.validationEndDate || new Date().toISOString().slice(0, 10));
  const configKey = `configs/training/${year}_${symbol.toLowerCase()}_${runTagSlug}.json`;
  const descriptionLabel = `${year} ${symbol} ${runTagDisplay.replace(/_/g, ' ')}`;
  const next = {
    ...(baseConfig && typeof baseConfig === 'object' ? baseConfig : buildDefaultTrainingTemplate()),
    name: `${year}_${symbol}_${runTagDisplay}`,
    description: descriptionLabel,
    timeRange: {
      ...(baseConfig?.timeRange || {}),
      startTimeMs,
      endTimeMs,
      startIso,
      endIso
    },
    market: {
      ...(baseConfig?.market || {}),
      symbol,
      intervalType
    },
    database: {
      ...(baseConfig?.database || {}),
      tableName,
      resetTableBeforeRun: baseConfig?.database?.resetTableBeforeRun ?? true
    },
    strategy: {
      ...(baseConfig?.strategy || {}),
      types: strategyTypes,
      parameters: {
        ...(baseConfig?.strategy?.parameters || {}),
        risk: {
          ...(baseConfig?.strategy?.parameters?.risk || {}),
          lotSize: [lotSize],
          maxHoldMinutes: [Math.min(maxHoldMin, maxHoldMax), Math.max(maxHoldMin, maxHoldMax)]
        },
        tradingSchedule: String(draft?.tradingSchedule || DEFAULT_TRADING_SCHEDULE)
      }
    },
    output: {
      ...(baseConfig?.output || {}),
      topN,
      strategyNamePrefix: `${year}-${symbol}-${runTagDisplay.replace(/_/g, '-')}-`,
      descriptionPrefix: descriptionLabel
    }
  };

  next.validationPlan = {
    profile: validationProfile
  };

  if (validationProfile === 'custom-range') {
    const customStartIso = parseDateInputToIso(validationStartDate, false);
    const customEndIso = parseDateInputToIso(validationEndDate, true);

    next.validationPlan.customRange = {
      startIso: customStartIso,
      endIso: customEndIso,
      startTimeMs: parseDateInputToUtcMs(validationStartDate, false),
      endTimeMs: parseDateInputToUtcMs(validationEndDate, true)
    };
  } else if (next.validationPlan.customRange) {
    delete next.validationPlan.customRange;
  }

  if (routerConfigPath) {
    next.regimeRouting = {
      ...(baseConfig?.regimeRouting || {}),
      routerConfigPath
    };
  } else if (next.regimeRouting) {
    delete next.regimeRouting.routerConfigPath;
    if (Object.keys(next.regimeRouting).length === 0) {
      delete next.regimeRouting;
    }
  }

  return {
    content: next,
    configKey,
    recommendedTableName: tableName
  };
}

function buildCompanionValidationDrafts(trainingConfig, trainingConfigKey) {
  const trainingYear = getYearFromConfig(trainingConfig, getFileBaseName(trainingConfigKey || '')) || '';
  const symbol = String(trainingConfig?.market?.symbol || DEFAULT_TRAINING_SYMBOL).toUpperCase();
  const symbolLower = symbol.toLowerCase();
  const runTagSlug = formatSlugTag(inferTrainingRunTag(trainingConfig));
  const validationPlan = trainingConfig?.validationPlan && typeof trainingConfig.validationPlan === 'object'
    ? trainingConfig.validationPlan
    : {};
  const profile = String(validationPlan.profile || 'future-window');
  const trainingEndDate = formatDateInput(trainingConfig?.timeRange?.endIso || trainingConfig?.timeRange?.endTimeMs, `${trainingYear}-12-31`);
  const defaultFutureStartDate = addUtcDays(trainingEndDate, 1) || `${Number(trainingYear || new Date().getFullYear()) + 1}-01-01`;
  const defaultFutureEndDate = new Date().toISOString().slice(0, 10);

  if (profile === 'annual-template') {
    const targets = Object.keys(VALIDATION_TIME_RANGES).filter((year) => Number(year) > Number(trainingYear || 0));

    return targets.map((targetYear) => {
      const configKey = `configs/validation/${trainingYear}_${symbolLower}_${runTagSlug}_annual_from_${trainingYear}_${targetYear}_validation.json`;
      const descriptionLabel = `${targetYear} ${symbol} annual validation from ${trainingYear}`;

      return {
        configKey,
        configType: 'validation',
        content: {
          name: `${symbol}_ANNUAL_TEMPLATE_FROM_${trainingYear}_${targetYear}_VALIDATION`,
          description: `${symbol} 年度模板验证草稿 - 基于 ${trainingYear} training 配置预生成，兼容旧年度切片`,
          timeRange: VALIDATION_TIME_RANGES[targetYear],
          market: {
            symbol,
            intervalType: trainingConfig?.market?.intervalType || '1min'
          },
          database: {
            tableName: `${symbolLower}_${runTagSlug}_annual_validate_${targetYear}_from_${trainingYear}`,
            resetTableBeforeRun: true
          },
          strategy: {
            types: Array.isArray(trainingConfig?.strategy?.types) && trainingConfig.strategy.types.length > 0
              ? trainingConfig.strategy.types
              : ['rsi_macd'],
            parameters: trainingConfig?.strategy?.parameters || {}
          },
          executor: trainingConfig?.executor || null,
          output: {
            topN: Number(trainingConfig?.output?.topN || 10),
            strategyNamePrefix: `${trainingYear}-${symbol}-ANNUAL-${targetYear}-`,
            descriptionPrefix: descriptionLabel
          },
          sourceTable: trainingConfig?.database?.tableName || null,
          trainConfig: trainingConfigKey,
          draftFromTraining: true,
          validationProfile: 'annual-template',
          validationTarget: {
            label: targetYear,
            startIso: VALIDATION_TIME_RANGES[targetYear].startIso,
            endIso: VALIDATION_TIME_RANGES[targetYear].endIso,
            cutoffDate: VALIDATION_TIME_RANGES[targetYear].endIso.slice(0, 10)
          }
        }
      };
    });
  }

  const customRange = validationPlan.customRange && typeof validationPlan.customRange === 'object'
    ? validationPlan.customRange
    : {};
  const validationStartDate = formatDateInput(customRange.startIso || defaultFutureStartDate, defaultFutureStartDate);
  const validationEndDate = formatDateInput(customRange.endIso || defaultFutureEndDate, defaultFutureEndDate);
  const configKey = profile === 'custom-range'
    ? `configs/validation/${trainingYear}_${symbolLower}_${runTagSlug}_custom_${validationStartDate.replace(/-/g, '_')}_to_${validationEndDate.replace(/-/g, '_')}_validation.json`
    : `configs/validation/${trainingYear}_${symbolLower}_${runTagSlug}_future_from_${trainingYear}_to_${validationEndDate.replace(/-/g, '_')}_validation.json`;
  const descriptionLabel = profile === 'custom-range'
    ? `${symbol} custom validation ${validationStartDate} -> ${validationEndDate}`
    : `${symbol} future validation ${validationStartDate} -> ${validationEndDate}`;

  return [
    {
      configKey,
      configType: 'validation',
      content: {
        name: profile === 'custom-range'
          ? `${symbol}_CUSTOM_RANGE_FROM_${trainingYear}_VALIDATION`
          : `${symbol}_FUTURE_WINDOW_FROM_${trainingYear}_VALIDATION`,
        description: `${descriptionLabel} - 基于 ${trainingYear} training 配置预生成`,
        timeRange: {
          startTimeMs: parseDateInputToUtcMs(validationStartDate, false),
          endTimeMs: parseDateInputToUtcMs(validationEndDate, true),
          startIso: parseDateInputToIso(validationStartDate, false),
          endIso: parseDateInputToIso(validationEndDate, true)
        },
        market: {
          symbol,
          intervalType: trainingConfig?.market?.intervalType || '1min'
        },
        database: {
          tableName: `${symbolLower}_${runTagSlug}_${profile === 'custom-range' ? 'custom' : 'future'}_validate_${validationEndDate.replace(/-/g, '_')}_from_${trainingYear}`,
          resetTableBeforeRun: true
        },
        strategy: {
          types: Array.isArray(trainingConfig?.strategy?.types) && trainingConfig.strategy.types.length > 0
            ? trainingConfig.strategy.types
            : ['rsi_macd'],
          parameters: trainingConfig?.strategy?.parameters || {}
        },
        executor: trainingConfig?.executor || null,
        output: {
          topN: Number(trainingConfig?.output?.topN || 10),
          strategyNamePrefix: `${trainingYear}-${symbol}-${profile === 'custom-range' ? 'CUSTOM' : 'FUTURE'}-`,
          descriptionPrefix: descriptionLabel
        },
        sourceTable: trainingConfig?.database?.tableName || null,
        trainConfig: trainingConfigKey,
        draftFromTraining: true,
        validationProfile: profile,
        validationTarget: {
          label: profile === 'custom-range'
            ? `custom ${validationStartDate} -> ${validationEndDate}`
            : `future ${validationStartDate} -> ${validationEndDate}`,
          startIso: parseDateInputToIso(validationStartDate, false),
          endIso: parseDateInputToIso(validationEndDate, true),
          cutoffDate: validationEndDate
        }
      }
    }
  ];
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

function buildMethodologyStages(pipeline, trainingConfigRecord) {
  const trainingConfig = trainingConfigRecord?.content || {};
  const validations = Array.isArray(pipeline?.validationConfigs) ? pipeline.validationConfigs : [];
  const strategyTypes = Array.isArray(trainingConfig?.strategy?.types) ? trainingConfig.strategy.types : [];
  const holdMinutes = Array.isArray(trainingConfig?.strategy?.parameters?.risk?.maxHoldMinutes)
    ? trainingConfig.strategy.parameters.risk.maxHoldMinutes
    : [];
  const lotSize = trainingConfig?.strategy?.parameters?.risk?.lotSize?.[0];
  const hasTrainingConfig = Boolean(pipeline?.trainingConfigPath);
  const hasValidationConfig = validations.length > 0;
  const hasTrainingRun = Boolean(pipeline?.trainingRun);
  const hasSnapshot = Boolean(pipeline?.topStrategySnapshot);
  const hasAnyValidationRun = validations.some((item) => Boolean(item.latestRun));
  const hasAllValidationRuns = validations.length > 0 && validations.every((item) => Boolean(item.latestRun));
  const hasActiveValidationRequest = validations.some((item) => isActiveRequestStatus(item.latestRequest?.status));
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
    ? validations.map((item) => `${item.targetLabel}:${item.latestRun ? 'done' : (item.latestRequest?.status || 'todo')}`)
    : ['尚未生成 validation config'];

  return [
    {
      key: 'stage-0-boundary',
      label: '阶段 0',
      title: '确认任务边界',
      status: hasTrainingConfig && hasValidationConfig ? 'done' : hasTrainingConfig ? 'partial' : 'todo',
      summary: hasValidationConfig
        ? '训练区间与未来验证区间都已进入配置库，边界清晰。'
        : '已有 training config，但未来 validation 配置还不完整。',
      inputs: ['交易对', '训练区间', '验证区间', '既有 router / report'],
      outputs: [
        pipeline?.trainingConfigPath || '等待 training config',
        hasValidationConfig ? `${validations.length} 份 validation config` : '等待 validation config'
      ],
      gates: ['symbol 明确', '训练期与验证期分离', '命名不混淆旧结果'],
      evidence: [
        pipeline?.symbol || 'UNKNOWN',
        trainingRange,
        hasValidationConfig ? `validation ${validations.length} 份` : '未匹配到 validation'
      ],
      notes: '方法论要求先锁定 symbol、训练期、验证期，再开始推导。',
      actionKeys: ['generate-validation', 'prepare-validation']
    },
    {
      key: 'stage-1-diagnosis',
      label: '阶段 1',
      title: '波动与结构诊断',
      status: hasFeatureCausality ? 'done' : hasTrainingRun || hasSnapshot ? 'partial' : 'todo',
      summary: hasFeatureCausality
        ? '已有结构诊断类报告，可作为阶段 1 的证据入口。'
        : '当前缺少显式结构诊断报告，建议先补一份波动/因果分析。',
      inputs: ['历史数据切片', '好周 / 坏周样本', '高波 / 低波段'],
      outputs: ['波动报告', '周 / 月 / 日结构概览'],
      gates: ['能区分高低波', '能指出典型坏区间', '能解释至少几类结构差异'],
      evidence: hasFeatureCausality
        ? [pipeline.reports.featureCausality.path]
        : hasTrainingRun
          ? ['已有候选池结果，可回填结构诊断报告']
          : ['等待候选池训练后补证据'],
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
      status: trainingRequestRunning ? 'running' : hasTrainingRun ? 'done' : 'todo',
      summary: hasTrainingRun
        ? `候选池已落库，当前记录 ${pipeline.trainingRun.strategyCount} 个策略结果。`
        : trainingRequestRunning
          ? '训练任务正在执行，等待候选池结果落库。'
          : '还没有训练结果，先跑候选池。',
      inputs: ['training config', '参数网格', '目标结果表'],
      outputs: ['backtest_results', '训练期 TopN', 'trades'],
      gates: ['候选池不能过少', '策略之间要有结构差异', '不能所有阶段一起亏'],
      evidence: [
        pipeline?.resultGroup || '未配置结果表',
        hasTrainingRun ? `${pipeline.trainingRun.runId} · ${pipeline.trainingRun.strategyCount} strategies` : '尚未落库',
        pipeline?.latestRequest?.requestId ? `queue ${pipeline.latestRequest.requestId}` : '暂无训练请求'
      ],
      notes: '这一步对应 `METHODOLOGY` 的主入口，训练 UI 的自动执行也从这里开始。',
      actionKeys: ['run-training']
    },
    {
      key: 'stage-4-weekly-base',
      label: '阶段 4',
      title: '构建周级策略映射',
      status: routerReady ? 'done' : hasTrainingRun ? 'partial' : 'todo',
      summary: routerReady
        ? '已存在可执行 router / policy，可视为周级 base policy 已固化。'
        : hasTrainingRun
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
          : '先准备未来期样本，再提炼日级映射。',
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
      key: 'stage-8-future-validation',
      label: '阶段 8',
      title: '未来期验证',
      status: hasActiveValidationRequest
        ? 'running'
        : hasAllValidationRuns && (hasCostSensitivity || hasRouterValidation)
          ? 'done'
          : hasValidationConfig || hasSnapshot
            ? 'partial'
            : 'todo',
      summary: hasAllValidationRuns
        ? `未来期 validation 已完成 ${validations.length} 个目标区间。`
        : hasValidationConfig
          ? 'validation 配置已经就绪，可以直接执行未来期验证。'
          : '先生成最终策略 config 与 validation config，再进入未来期验证。',
      inputs: ['validation config', 'final strategy config', '同版 router'],
      outputs: ['future validation result', 'scorecard', 'cost sensitivity'],
      gates: ['至少和 default/rank1/topN/oracle 对比', '检查摩擦成本', '关注负收益周和坏周解释'],
      evidence: [
        ...validationLabels.slice(0, 3),
        hasCostSensitivity ? pipeline.reports.costSensitivity.path : '尚无成本敏感度报告'
      ],
      notes: '这里才是方法论里的“未来期检验泛化能力”，不是单纯按年度做一个 shortcut。',
      actionKeys: ['generate-validation', 'prepare-validation', 'run-validation', 'cost-sensitivity', 'router-validate']
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
          : '等待未来期验证结果，再决定是否进入迭代。',
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
  switch (String(profile || '')) {
    case 'future-window':
      return 1;
    case 'custom-range':
      return 2;
    case 'annual-template':
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
              <span className={`validation-chip ${item.validationProfile === 'future-window' ? 'done' : 'todo'}`}>
                {item.validationProfile || 'legacy'}
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
      return '执行阶段 8：生成 Future Validation';
    case 'prepare-validation':
      return '执行阶段 8：补齐 Validation';
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
                  synced {formatDateTime(config.syncedAt)}
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
  onChange
}) {
  const computed = buildTrainingConfigFromGuide(draft, buildDefaultTrainingTemplate());
  const yearOptions = buildSelectOptions(draft.year, TRAINING_YEAR_OPTIONS);
  const symbolOptions = buildSelectOptions(draft.symbol, TRAINING_SYMBOL_OPTIONS);
  const intervalOptions = buildSelectOptions(draft.intervalType, INTERVAL_OPTIONS);
  const strategyTypeOptions = buildSelectOptions(draft.strategyTypes, STRATEGY_TYPE_OPTIONS);
  const topNOptions = buildSelectOptions(draft.topN, TOP_N_OPTIONS);
  const lotSizeOptions = buildSelectOptions(draft.lotSize, LOT_SIZE_OPTIONS);
  const holdMinOptions = buildSelectOptions(draft.maxHoldMin, HOLD_MIN_OPTIONS);
  const holdMaxOptions = buildSelectOptions(draft.maxHoldMax, HOLD_MAX_OPTIONS);
  const tradingScheduleOptions = buildSelectOptions(draft.tradingSchedule, TRADING_SCHEDULE_OPTIONS);
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
            {VALIDATION_PROFILE_OPTIONS.map((option) => (
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
            disabled={draft.validationProfile === 'annual-template'}
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
          <strong>
            {draft.validationProfile === 'future-window'
              ? 'Future Window'
              : draft.validationProfile === 'custom-range'
                ? 'Custom Range'
                : 'Annual Template'}
          </strong>
          <em>
            {draft.validationProfile === 'future-window'
              ? `从 ${draft.validationStartDate} 开始，默认观察到 ${draft.validationEndDate}`
              : draft.validationProfile === 'custom-range'
                ? `${draft.validationStartDate} -> ${draft.validationEndDate}`
                : '仅作兼容模板，不再是默认主路径'}
          </em>
        </div>
      </div>

      <div className="training-guide-tips">
        {TRAINING_GUIDE_RECOMMENDATIONS.map((tip) => (
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
                  ? 'Future Window'
                  : draft.validationProfile === 'custom-range'
                    ? 'Custom Range'
                    : 'Annual Template'}
              </span>
              <span className="validation-chip todo">由 training config 派生</span>
            </div>
            <div className="validation-path">{computed.configKey}</div>
            <div className="validation-meta">
              保存时不会单独创建 validation 草稿。
              {' · '}
              训练完成后通过 pipeline 的“下一步”生成可运行 validation。
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
  const [editorConfigKey, setEditorConfigKey] = useState(`configs/training/${new Date().getFullYear()}_btcjpy_v7_hf_rsi_macd_tp_atr.json`);
  const [editorConfigType, setEditorConfigType] = useState('training');
  const [editorContentText, setEditorContentText] = useState(JSON.stringify(buildDefaultTrainingTemplate(), null, 2));
  const [editorGuideDraft, setEditorGuideDraft] = useState(buildTrainingGuideDraft(buildDefaultTrainingTemplate(), `configs/training/${new Date().getFullYear()}_btcjpy_v7_hf_rsi_macd_tp_atr.json`));
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

  const openCreateEditor = () => {
    const nextConfig = buildDefaultTrainingTemplate();
    const nextConfigKey = `configs/training/${new Date().getFullYear()}_btcjpy_v7_hf_rsi_macd_tp_atr.json`;
    setEditorOpen(true);
    setEditorIsNew(true);
    setEditorMode('basic');
    setEditorError('');
    setActionMessage(null);
    setEditorConfigType('training');
    setEditorConfigKey(nextConfigKey);
    setEditorContentText(JSON.stringify(nextConfig, null, 2));
    setEditorGuideDraft(buildTrainingGuideDraft(nextConfig, nextConfigKey));
    updateHashQuery({ configId: 'new' });
  };

  const openEditEditor = async (id) => {
    try {
      const response = await trainConfigsAPI.getById(id);
      if (response.success) {
        const record = response.data;
        setEditorOpen(true);
        setEditorIsNew(false);
        setEditorMode('basic');
        setEditorError('');
        setActionMessage(null);
        setEditorConfigKey(record.configKey);
        setEditorConfigType('training');
        setEditorContentText(JSON.stringify(record.content, null, 2));
        setEditorGuideDraft(buildTrainingGuideDraft(record.content, record.configKey));
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

    setEditorGuideDraft(buildTrainingGuideDraft(parsed, editorConfigKey));
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
    const nextContent = safeParseJsonText(editorContentText);
    const normalized = nextContent && typeof nextContent === 'object' ? nextContent : buildDefaultTrainingTemplate();
    const nextConfigKey = editorIsNew ? `configs/training/${new Date().getFullYear()}_btcjpy_v7_hf_rsi_macd_tp_atr.json` : editorConfigKey;
    setEditorConfigType('training');
    setEditorMode('basic');
    setEditorGuideDraft(buildTrainingGuideDraft(normalized, nextConfigKey));
    if (!nextContent) {
      setEditorContentText(JSON.stringify(normalized, null, 2));
    }
  };

  const handleGuideChange = (field, value) => {
    const nextDraft = {
      ...editorGuideDraft,
      [field]: value
    };

    setEditorGuideDraft(nextDraft);

    const parsed = safeParseJsonText(editorContentText);
    const next = buildTrainingConfigFromGuide(nextDraft, parsed && typeof parsed === 'object' ? parsed : buildDefaultTrainingTemplate());
    setEditorContentText(JSON.stringify(next.content, null, 2));

    if (editorIsNew) {
      setEditorConfigKey(next.configKey);
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
        <div className="pipeline-empty">当前没有找到 training config。</div>
      ) : (
        <div className="pipeline-grid">
          {pipelines.map((pipeline) => {
            const latestTrainingRequest = pipeline.latestRequest || latestRequestByConfigKey[pipeline.trainingConfigPath] || null;
            const trainingConfigRecord = configByKey[pipeline.trainingConfigPath] || null;
            const methodologyStages = buildMethodologyStages(pipeline, trainingConfigRecord);
            const suggestedStageKey = getSuggestedStageKey(methodologyStages);
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
                    <strong>{pipeline.router?.routerPath || pipeline.topStrategySnapshot?.path || '尚未生成'}</strong>
                    <em>
                      {pipeline.router?.policyPath
                        ? `policy ${pipeline.router.policyPath}`
                        : pipeline.topStrategySnapshot
                          ? `final config ${formatDateTime(pipeline.topStrategySnapshot.generatedAt)}`
                          : '等待 router / validation 产物'}
                    </em>
                    {pipeline.topStrategySnapshot?.path && configByKey[pipeline.topStrategySnapshot.path]?.id && (
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
