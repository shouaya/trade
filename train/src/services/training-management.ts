export const DEFAULT_TRAINING_SYMBOL = 'BTCJPY';
export const DEFAULT_TRAINING_RUN_TAG = 'V7_HF_RSI_MACD_TP_ATR';
export const DEFAULT_TRADING_SCHEDULE = '* 12-18 * * 1-5';
export const DEFAULT_VALIDATION_PROFILE = 'rolling-window';

export const VALIDATION_PROFILE_OPTIONS = [
  { value: 'rolling-window', label: 'Rolling 主验证', hint: 'Recommended' },
  { value: 'custom-range', label: '自定义区间', hint: 'Manual' }
] as const;

export const TRAINING_GUIDE_RECOMMENDATIONS = [
  '首次训练建议从 BTCJPY + 1min 开始，先验证主链路是否跑通。',
  'Top N 建议先固定为 10，先看候选池质量，再考虑扩容。',
  'lotSize 建议先固定 0.008，避免一次改太多维度。',
  'maxHoldMinutes 建议先用 6 到 8 分钟，控制高频策略持仓时长。',
  '默认手续费档案已经切到 GMO 取引所レバレッジ 2倍；交易手续费记为 0，但保留 0.04%/日持仓费和 0.5% 强平费元数据。',
  '如果只是第一次创建配置，router 路径可以先留空，等训练和 validation 跑通后再补。',
  '默认直接走 rolling-window，把主链路对齐到持续滚动验证。',
  'custom-range 只用于补充复验，不再作为主链路默认方案。',
  '年度模板已经退出主链路，不再作为默认生成方案。'
] as const;

export const TRAINING_GUIDE_OPTIONS = {
  trainingYears: ['2024', '2025', '2026'],
  symbols: [DEFAULT_TRAINING_SYMBOL],
  intervalTypes: ['1min', '5min', '15min', '1h'],
  strategyTypes: ['rsi_macd'],
  topNValues: ['5', '10', '20', '30'],
  lotSizes: ['0.004', '0.008', '0.01', '0.02'],
  holdMinValues: ['4', '6', '8', '10', '12'],
  holdMaxValues: ['6', '8', '10', '12', '15'],
  tradingSchedules: [
    DEFAULT_TRADING_SCHEDULE,
    '* 0-23 * * 1-5',
    '* 8-16 * * 1-5',
    '* 12-20 * * 1-5'
  ]
} as const;

export const GMO_LEVERAGE_2X_FEE_MODEL = {
  venueCode: 'GMOCOIN',
  market: 'exchange-leverage',
  productCode: 'BTC_JPY',
  commissionRate: 0,
  apiFeeRate: 0,
  makerRate: 0,
  takerRate: 0,
  basis: 'notional',
  chargeOnEntry: true,
  chargeOnExit: true,
  leverageMultiplier: 2,
  dailyLeverageRate: 0.0004,
  liquidationFeeRate: 0.005,
  forcedCloseFeeRate: 0.005,
  settlementHourJst: 6,
  referenceUrl: 'https://coin.z.com/jp/corp/guide/fees/',
  notes: 'GMO 取引所レバレッジ 2倍 API。BTC/JPY 交易手续费免费，API 手续费免费，建玉管理费 0.04%/日，ロスカット手数料 0.5%。'
} as const;

type JsonObject = Record<string, unknown>;

export interface TrainingGuideDraft {
  readonly year: string;
  readonly symbol: string;
  readonly runTag: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly intervalType: string;
  readonly topN: number;
  readonly strategyTypes: string;
  readonly lotSize: string;
  readonly maxHoldMin: string;
  readonly maxHoldMax: string;
  readonly tradingSchedule: string;
  readonly tableName: string;
  readonly routerConfigPath: string;
  readonly validationProfile: string;
  readonly validationStartDate: string;
  readonly validationEndDate: string;
  readonly configKey: string;
}

export interface TrainingGuidePreview {
  readonly content: JsonObject;
  readonly configKey: string;
  readonly recommendedTableName: string;
}

export interface TrainingGuideBootstrap {
  readonly configKey: string;
  readonly content: JsonObject;
  readonly draft: TrainingGuideDraft;
  readonly recommendations: readonly string[];
  readonly options: typeof TRAINING_GUIDE_OPTIONS;
  readonly validationProfiles: typeof VALIDATION_PROFILE_OPTIONS;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function formatDateInput(value: unknown, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toISOString().slice(0, 10);
}

function parseDateInputToUtcMs(dateInput: string, endOfDay = false): number | null {
  const match = String(dateInput || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText] = match;
  return Date.UTC(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    0
  );
}

function parseDateInputToIso(dateInput: string, endOfDay = false): string | null {
  const utcMs = parseDateInputToUtcMs(dateInput, endOfDay);
  return utcMs == null ? null : new Date(utcMs).toISOString();
}

function addUtcDays(dateInput: string, days: number): string | null {
  const utcMs = parseDateInputToUtcMs(dateInput, false);
  if (utcMs == null) {
    return null;
  }

  return new Date(utcMs + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function sanitizeToken(value: unknown, fallback = 'run'): string {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}

function formatDisplayTag(value: unknown): string {
  return sanitizeToken(value, DEFAULT_TRAINING_RUN_TAG).toUpperCase();
}

function formatSlugTag(value: unknown): string {
  return sanitizeToken(value, DEFAULT_TRAINING_RUN_TAG).toLowerCase();
}

function splitStrategyTypes(value: unknown): readonly string[] {
  const items = String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? Array.from(new Set(items)) : ['rsi_macd'];
}

export function normalizeValidationProfile(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  return VALIDATION_PROFILE_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : DEFAULT_VALIDATION_PROFILE;
}

export function inferTrainingRunTag(config: unknown): string {
  const parsed = asObject(config);
  const rawName = String(parsed['name'] || '');
  const tokens = rawName.split('_').filter(Boolean);
  const market = asObject(parsed['market']);
  const symbol = String(market['symbol'] || DEFAULT_TRAINING_SYMBOL).toUpperCase();

  if (tokens[0] && /^\d{4}$/.test(tokens[0])) {
    tokens.shift();
  }

  if (tokens[0] && tokens[0].toUpperCase() === symbol) {
    tokens.shift();
  }

  return tokens.join('_') || DEFAULT_TRAINING_RUN_TAG;
}

export function buildDefaultTrainingTemplate(now = new Date()): JsonObject {
  const currentYear = now.getUTCFullYear();
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
        feeModel: { ...GMO_LEVERAGE_2X_FEE_MODEL }
      }
    },
    output: {
      topN: 10,
      strategyNamePrefix: `${currentYear}-${DEFAULT_TRAINING_SYMBOL}-${DEFAULT_TRAINING_RUN_TAG.replace(/_/g, '-')}-`,
      descriptionPrefix: `${currentYear} ${DEFAULT_TRAINING_SYMBOL} ${DEFAULT_TRAINING_RUN_TAG.replace(/_/g, ' ')}`
    }
  };
}

export function buildTrainingGuideDraft(content: unknown, configKey: string, now = new Date()): TrainingGuideDraft {
  const currentYear = now.getUTCFullYear();
  const parsed = asObject(content);
  const timeRange = asObject(parsed['timeRange']);
  const market = asObject(parsed['market']);
  const strategy = asObject(parsed['strategy']);
  const parameters = asObject(strategy['parameters']);
  const risk = asObject(parameters['risk']);
  const database = asObject(parsed['database']);
  const regimeRouting = asObject(parsed['regimeRouting']);
  const validationPlan = asObject(parsed['validationPlan']);
  const customRange = asObject(validationPlan['customRange']);

  const startDate = formatDateInput(timeRange['startIso'] || timeRange['startTimeMs'], `${currentYear}-01-01`);
  const endDate = formatDateInput(timeRange['endIso'] || timeRange['endTimeMs'], `${currentYear}-12-31`);
  const year = String(startDate).slice(0, 4) || String(currentYear);
  const holdMinutes = Array.isArray(risk['maxHoldMinutes']) ? risk['maxHoldMinutes'] : [6, 8];
  const futureValidationStartDate = addUtcDays(endDate, 1) || `${currentYear + 1}-01-01`;
  const fallbackValidationEndDate = now.toISOString().slice(0, 10);

  return {
    year,
    symbol: String(market['symbol'] || DEFAULT_TRAINING_SYMBOL).toUpperCase(),
    runTag: inferTrainingRunTag(parsed),
    startDate,
    endDate,
    intervalType: String(market['intervalType'] || '1min'),
    topN: Number(asObject(parsed['output'])['topN'] || 10),
    strategyTypes: Array.isArray(strategy['types']) && strategy['types'].length > 0
      ? strategy['types'].join(', ')
      : 'rsi_macd',
    lotSize: String(Array.isArray(risk['lotSize']) ? risk['lotSize'][0] ?? 0.008 : 0.008),
    maxHoldMin: String(holdMinutes[0] ?? 6),
    maxHoldMax: String(holdMinutes[holdMinutes.length - 1] ?? 8),
    tradingSchedule: String(parameters['tradingSchedule'] || DEFAULT_TRADING_SCHEDULE),
    tableName: String(database['tableName'] || ''),
    routerConfigPath: String(regimeRouting['routerConfigPath'] || ''),
    validationProfile: normalizeValidationProfile(validationPlan['profile']),
    validationStartDate: formatDateInput(customRange['startIso'] || futureValidationStartDate, futureValidationStartDate),
    validationEndDate: formatDateInput(customRange['endIso'] || fallbackValidationEndDate, fallbackValidationEndDate),
    configKey: String(configKey || '')
  };
}

export function buildTrainingConfigFromGuide(draft: Partial<TrainingGuideDraft>, baseConfig: unknown, now = new Date()): TrainingGuidePreview {
  const base = asObject(baseConfig);
  const year = String(draft.year || now.getUTCFullYear()).slice(0, 4);
  const symbol = String(draft.symbol || DEFAULT_TRAINING_SYMBOL).toUpperCase();
  const runTagDisplay = formatDisplayTag(draft.runTag);
  const runTagSlug = formatSlugTag(draft.runTag);
  const startDate = String(draft.startDate || `${year}-01-01`);
  const endDate = String(draft.endDate || `${year}-12-31`);
  const startTimeMs = parseDateInputToUtcMs(startDate, false) ?? Date.UTC(Number(year), 0, 1, 0, 0, 0);
  const endTimeMs = parseDateInputToUtcMs(endDate, true) ?? Date.UTC(Number(year), 11, 31, 23, 59, 0);
  const startIso = parseDateInputToIso(startDate, false) ?? new Date(startTimeMs).toISOString();
  const endIso = parseDateInputToIso(endDate, true) ?? new Date(endTimeMs).toISOString();
  const intervalType = String(draft.intervalType || '1min');
  const topN = Math.max(1, Number(draft.topN || 10));
  const strategyTypes = splitStrategyTypes(draft.strategyTypes);
  const lotSize = Number(draft.lotSize || 0.008);
  const maxHoldMin = Number(draft.maxHoldMin || 6);
  const maxHoldMax = Number(draft.maxHoldMax || maxHoldMin || 8);
  const tableName = String(draft.tableName || `${symbol.toLowerCase()}_${runTagSlug}_train_${year}`);
  const routerConfigPath = String(draft.routerConfigPath || '').trim();
  const validationProfile = normalizeValidationProfile(draft.validationProfile);
  const validationStartDate = String(draft.validationStartDate || addUtcDays(endDate, 1) || `${Number(year) + 1}-01-01`);
  const validationEndDate = String(draft.validationEndDate || now.toISOString().slice(0, 10));
  const configKey = `configs/training/${year}_${symbol.toLowerCase()}_${runTagSlug}.json`;
  const descriptionLabel = `${year} ${symbol} ${runTagDisplay.replace(/_/g, ' ')}`;

  const baseTimeRange = asObject(base['timeRange']);
  const baseMarket = asObject(base['market']);
  const baseDatabase = asObject(base['database']);
  const baseStrategy = asObject(base['strategy']);
  const baseParameters = asObject(baseStrategy['parameters']);
  const baseRisk = asObject(baseParameters['risk']);
  const baseOutput = asObject(base['output']);
  const baseValidationPlan = asObject(base['validationPlan']);
  const baseRegimeRouting = asObject(base['regimeRouting']);

  const next: JsonObject = {
    ...(Object.keys(base).length > 0 ? base : buildDefaultTrainingTemplate(now)),
    name: `${year}_${symbol}_${runTagDisplay}`,
    description: descriptionLabel,
    timeRange: {
      ...baseTimeRange,
      startTimeMs,
      endTimeMs,
      startIso,
      endIso
    },
    market: {
      ...baseMarket,
      symbol,
      intervalType
    },
    database: {
      ...baseDatabase,
      tableName,
      resetTableBeforeRun: baseDatabase['resetTableBeforeRun'] ?? true
    },
    strategy: {
      ...baseStrategy,
      types: strategyTypes,
      parameters: {
        ...baseParameters,
        risk: {
          ...baseRisk,
          lotSize: [lotSize],
          maxHoldMinutes: [Math.min(maxHoldMin, maxHoldMax), Math.max(maxHoldMin, maxHoldMax)]
        },
        tradingSchedule: String(draft.tradingSchedule || DEFAULT_TRADING_SCHEDULE)
      }
    },
    output: {
      ...baseOutput,
      topN,
      strategyNamePrefix: `${year}-${symbol}-${runTagDisplay.replace(/_/g, '-')}-`,
      descriptionPrefix: descriptionLabel
    },
    validationPlan: {
      ...baseValidationPlan,
      profile: validationProfile
    }
  };

  const nextValidationPlan = asObject(next['validationPlan']);
  if (validationProfile === 'custom-range') {
    next['validationPlan'] = {
      ...nextValidationPlan,
      customRange: {
        startIso: parseDateInputToIso(validationStartDate, false),
        endIso: parseDateInputToIso(validationEndDate, true),
        startTimeMs: parseDateInputToUtcMs(validationStartDate, false),
        endTimeMs: parseDateInputToUtcMs(validationEndDate, true)
      }
    };
  } else if ('customRange' in nextValidationPlan) {
    const { customRange: _customRange, ...rest } = nextValidationPlan;
    void _customRange;
    next['validationPlan'] = rest;
  }

  if (routerConfigPath) {
    next['regimeRouting'] = {
      ...baseRegimeRouting,
      routerConfigPath
    };
  } else if (Object.keys(baseRegimeRouting).length > 0) {
    const { routerConfigPath: _routerConfigPath, ...rest } = baseRegimeRouting;
    void _routerConfigPath;
    if (Object.keys(rest).length > 0) {
      next['regimeRouting'] = rest;
    } else {
      delete next['regimeRouting'];
    }
  } else {
    delete next['regimeRouting'];
  }

  return {
    content: next,
    configKey,
    recommendedTableName: tableName
  };
}

export function buildTrainingGuideBootstrap(now = new Date()): TrainingGuideBootstrap {
  const content = buildDefaultTrainingTemplate(now);
  const preview = buildTrainingConfigFromGuide(
    buildTrainingGuideDraft(content, '', now),
    content,
    now
  );

  return {
    configKey: preview.configKey,
    content: preview.content,
    draft: buildTrainingGuideDraft(content, preview.configKey, now),
    recommendations: [...TRAINING_GUIDE_RECOMMENDATIONS],
    options: TRAINING_GUIDE_OPTIONS,
    validationProfiles: VALIDATION_PROFILE_OPTIONS
  };
}
