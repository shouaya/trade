import {
  buildPeriodFeatures,
  detectDailyFeatureBucket,
  detectMonthlyFeatureBucket,
  detectWeeklyFeatureBucket,
  getIsoWeekKey,
  getJstDayKey,
  getJstMonthKey,
  type PeriodFeature
} from '../services/rolling-features';

export interface UtKlineSeedRow {
  readonly open_time: number;
  readonly bid_open: number;
  readonly bid_high: number;
  readonly bid_low: number;
  readonly bid_close: number;
  readonly ask_open: number;
  readonly ask_high: number;
  readonly ask_low: number;
  readonly ask_close: number;
  readonly volume: number;
  readonly symbol: string;
  readonly interval_type: string;
}

export interface MarketFeatureScenario {
  readonly key: string;
  readonly description: string;
  readonly symbol: string;
  readonly intervalType: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly klines: readonly UtKlineSeedRow[];
}

export interface ScenarioCoverage {
  readonly dailyBuckets: readonly string[];
  readonly weeklyBuckets: readonly string[];
  readonly monthlyBuckets: readonly string[];
}

type RegimeTemplateKey = 'range-low-vol' | 'range-mid-vol' | 'strong-trend' | 'crash-trend' | 'mixed-trend';

interface RegimeBlock {
  readonly startDate: string;
  readonly days: number;
  readonly template: RegimeTemplateKey;
  readonly startPrice: number;
}

const DEFAULT_SYMBOL = 'BTCJPY';
const DEFAULT_INTERVAL = '1min';
const SPREAD = 0.2;

const REGIME_CLOSE_MULTIPLIERS: Record<RegimeTemplateKey, readonly number[]> = {
  'range-low-vol': [1.0004, 1.001, 0.9996, 1.0008, 1.0002, 1.0009, 1.0001, 1.0005],
  'range-mid-vol': [1.01, 0.995, 1.015, 0.992, 1.013, 0.994, 1.012, 1.014],
  'strong-trend': [1.008, 1.016, 1.024, 1.035, 1.046, 1.058, 1.07, 1.082],
  'crash-trend': [0.992, 0.983, 0.972, 0.96, 0.948, 0.938, 0.928, 0.918],
  'mixed-trend': [1.025, 0.99, 1.032, 0.984, 1.028, 0.992, 1.021, 1.019]
};

const REGIME_HIGH_PAD: Record<RegimeTemplateKey, number> = {
  'range-low-vol': 0.0015,
  'range-mid-vol': 0.005,
  'strong-trend': 0.004,
  'crash-trend': 0.0035,
  'mixed-trend': 0.012
};

const REGIME_LOW_PAD: Record<RegimeTemplateKey, number> = {
  'range-low-vol': 0.0015,
  'range-mid-vol': 0.0055,
  'strong-trend': 0.002,
  'crash-trend': 0.004,
  'mixed-trend': 0.014
};

function roundPrice(value: number): number {
  return Number(value.toFixed(8));
}

function toUtcMs(dateText: string, dayOffset: number, minuteOffset: number): number {
  const base = new Date(`${dateText}T00:00:00.000Z`);
  return base.getTime() + (dayOffset * 24 * 60 * 60 * 1000) + (minuteOffset * 60 * 1000);
}

function buildDayRows(
  startDate: string,
  dayOffset: number,
  template: RegimeTemplateKey,
  startPrice: number,
  symbol: string,
  intervalType: string
): {
  readonly rows: readonly UtKlineSeedRow[];
  readonly endPrice: number;
} {
  const multipliers = REGIME_CLOSE_MULTIPLIERS[template];
  const highPad = REGIME_HIGH_PAD[template];
  const lowPad = REGIME_LOW_PAD[template];
  const rows: UtKlineSeedRow[] = [];
  let previousClose = startPrice;

  multipliers.forEach((multiplier, index) => {
    const open = previousClose;
    const close = startPrice * multiplier;
    const high = Math.max(open, close) * (1 + highPad);
    const low = Math.min(open, close) * (1 - lowPad);

    rows.push({
      open_time: toUtcMs(startDate, dayOffset, index),
      bid_open: roundPrice(open - (SPREAD / 2)),
      bid_high: roundPrice(high - (SPREAD / 2)),
      bid_low: roundPrice(low - (SPREAD / 2)),
      bid_close: roundPrice(close - (SPREAD / 2)),
      ask_open: roundPrice(open + (SPREAD / 2)),
      ask_high: roundPrice(high + (SPREAD / 2)),
      ask_low: roundPrice(low + (SPREAD / 2)),
      ask_close: roundPrice(close + (SPREAD / 2)),
      volume: 1,
      symbol,
      interval_type: intervalType
    });

    previousClose = close;
  });

  return {
    rows,
    endPrice: previousClose
  };
}

function buildScenarioFromBlocks(
  key: string,
  description: string,
  blocks: readonly RegimeBlock[],
  symbol = DEFAULT_SYMBOL,
  intervalType = DEFAULT_INTERVAL
): MarketFeatureScenario {
  const rows: UtKlineSeedRow[] = [];
  let startTimeMs = 0;
  let endTimeMs = 0;

  for (const block of blocks) {
    let currentPrice = block.startPrice;
    for (let dayIndex = 0; dayIndex < block.days; dayIndex += 1) {
      const built = buildDayRows(block.startDate, dayIndex, block.template, currentPrice, symbol, intervalType);
      rows.push(...built.rows);
      currentPrice = built.endPrice;
    }
  }

  if (rows.length > 0) {
    startTimeMs = rows[0]?.open_time ?? 0;
    endTimeMs = rows[rows.length - 1]?.open_time ?? 0;
  }

  return {
    key,
    description,
    symbol,
    intervalType,
    startTimeMs,
    endTimeMs,
    klines: rows
  };
}

export const MARKET_FEATURE_SCENARIOS: readonly MarketFeatureScenario[] = [
  buildScenarioFromBlocks(
    'range-low-vol',
    '低波动横盘场景，主要覆盖 range-low-vol',
    [{ startDate: '2025-01-02', days: 12, template: 'range-low-vol', startPrice: 100 }]
  ),
  buildScenarioFromBlocks(
    'strong-trend',
    '强趋势上涨场景，主要覆盖 strong-trend',
    [{ startDate: '2025-02-03', days: 12, template: 'strong-trend', startPrice: 120 }]
  ),
  buildScenarioFromBlocks(
    'range-mid-vol',
    '中波动横盘偏震荡场景，主要覆盖 range-mid-vol',
    [{ startDate: '2025-02-24', days: 12, template: 'range-mid-vol', startPrice: 118 }]
  ),
  buildScenarioFromBlocks(
    'crash-trend',
    '单边下跌场景，主要覆盖 crash-trend',
    [{ startDate: '2025-03-03', days: 12, template: 'crash-trend', startPrice: 160 }]
  ),
  buildScenarioFromBlocks(
    'mixed-trend',
    '高波动来回拉扯场景，主要覆盖 mixed-trend',
    [{ startDate: '2025-04-02', days: 12, template: 'mixed-trend', startPrice: 130 }]
  ),
  buildScenarioFromBlocks(
    'rolling-regime-shift',
    '跨月 regime shift，覆盖 rolling 中候选池、周月日映射与 router 的主要路径',
    [
      { startDate: '2025-01-06', days: 10, template: 'range-low-vol', startPrice: 100 },
      { startDate: '2025-02-03', days: 10, template: 'strong-trend', startPrice: 103 },
      { startDate: '2025-03-03', days: 10, template: 'crash-trend', startPrice: 145 },
      { startDate: '2025-04-07', days: 10, template: 'mixed-trend', startPrice: 95 }
    ]
  )
];

export function getMarketFeatureScenario(key: string): MarketFeatureScenario {
  const scenario = MARKET_FEATURE_SCENARIOS.find((item) => item.key === key);
  if (!scenario) {
    throw new Error(`unknown scenario: ${key}`);
  }
  return scenario;
}

export function listMarketFeatureScenarios(): readonly MarketFeatureScenario[] {
  return MARKET_FEATURE_SCENARIOS;
}

export function computeScenarioCoverage(
  scenario: MarketFeatureScenario,
  options: {
    readonly openingWindowCount?: number;
    readonly volBaselineLookback?: number;
  } = {}
): ScenarioCoverage {
  const daily = buildPeriodFeatures(
    scenario.klines,
    getJstDayKey,
    detectDailyFeatureBucket,
    options
  );
  const weekly = buildPeriodFeatures(
    scenario.klines,
    getIsoWeekKey,
    detectWeeklyFeatureBucket,
    options
  );
  const monthly = buildPeriodFeatures(
    scenario.klines,
    getJstMonthKey,
    detectMonthlyFeatureBucket,
    options
  );

  return {
    dailyBuckets: Array.from(new Set(daily.map((item) => item.featureBucket))).sort(),
    weeklyBuckets: Array.from(new Set(weekly.map((item) => item.featureBucket))).sort(),
    monthlyBuckets: Array.from(new Set(monthly.map((item) => item.featureBucket))).sort()
  };
}

export function computeScenarioFeatures(
  scenario: MarketFeatureScenario,
  options: {
    readonly openingWindowCount?: number;
    readonly volBaselineLookback?: number;
  } = {}
): {
  readonly daily: readonly PeriodFeature[];
  readonly weekly: readonly PeriodFeature[];
  readonly monthly: readonly PeriodFeature[];
} {
  return {
    daily: buildPeriodFeatures(scenario.klines, getJstDayKey, detectDailyFeatureBucket, options),
    weekly: buildPeriodFeatures(scenario.klines, getIsoWeekKey, detectWeeklyFeatureBucket, options),
    monthly: buildPeriodFeatures(scenario.klines, getJstMonthKey, detectMonthlyFeatureBucket, options)
  };
}
