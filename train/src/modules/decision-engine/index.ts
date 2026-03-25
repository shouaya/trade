type JsonObject = Record<string, any>;

export type RollingRouterAction = 'trade' | 'reduce' | 'stop';

export interface RouterDecisionConfig {
  readonly periodAction: {
    readonly stopAtOrBelowPnl: number;
    readonly reduceBelowPnl: number;
    readonly reduceRisk: number;
    readonly tradeRisk: number;
  };
  readonly dailyAction: {
    readonly stopAtOrBelowBestPnl: number;
    readonly minEdgeVsWeekBaseAbsolute: number;
    readonly minEdgeVsWeekBaseRatio: number;
    readonly reduceRisk: number;
    readonly tradeRisk: number;
    readonly preferWeekBaseOnReduce: boolean;
  };
  readonly aggregateAction: {
    readonly stopShareThreshold: number;
    readonly reduceShareThreshold: number;
    readonly normalizeStopToReduceForNonLossCheck: boolean;
    readonly minimumReducedRisk: number;
  };
  readonly lossRecheckAction: {
    readonly stopAtOrBelowCurrentPnl: number;
    readonly reduceAtOrBelowCurrentPnl: number;
    readonly reduceRisk: number;
    readonly tradeRisk: number;
  };
}

export interface DecisionFeatureEngineeringConfig {
  readonly openingWindowMinutes: number;
  readonly volBaselineLookbackPeriods: number;
  readonly routerSplit: {
    readonly enabled: boolean;
    readonly minSamplesPerBranch: number;
    readonly metrics: readonly string[];
  };
  readonly routerDecision: RouterDecisionConfig;
}

export interface DailyDecisionInput {
  readonly bestPnl: number;
  readonly weekBasePnl: number;
  readonly bestStrategyName: string | null;
  readonly weekBaseStrategyName: string | null;
  readonly monthPrimaryStrategyName: string | null;
}

export interface DailyDecisionResult {
  readonly actionType: RollingRouterAction;
  readonly riskMultiplier: number;
  readonly selectedStrategyName: string | null;
}

export interface AggregateActionInput {
  readonly layer: 'monthly_guard' | 'weekly_guard' | 'daily_router' | 'loss_recheck';
  readonly stopShare: number;
  readonly reduceShare: number;
  readonly averageRisk: number;
}

const DEFAULT_ROUTER_SPLIT_METRICS = [
  'trendEfficiency',
  'volExpansionRatio',
  'openingImpulse',
  'reversalStrength',
  'positiveStrategyRatio',
  'bestVsMedianGap',
  'monthlyWeeklyAlignment',
  'weeklyDailyAlignment'
] as const;

export const DEFAULT_FEATURE_ENGINEERING_CONFIG: DecisionFeatureEngineeringConfig = {
  openingWindowMinutes: 60,
  volBaselineLookbackPeriods: 8,
  routerSplit: {
    enabled: true,
    minSamplesPerBranch: 2,
    metrics: [...DEFAULT_ROUTER_SPLIT_METRICS]
  },
  routerDecision: {
    periodAction: {
      stopAtOrBelowPnl: -500,
      reduceBelowPnl: 0,
      reduceRisk: 0.85,
      tradeRisk: 1
    },
    dailyAction: {
      stopAtOrBelowBestPnl: -200,
      minEdgeVsWeekBaseAbsolute: 0,
      minEdgeVsWeekBaseRatio: 1,
      reduceRisk: 0.85,
      tradeRisk: 1,
      preferWeekBaseOnReduce: false
    },
    aggregateAction: {
      stopShareThreshold: 0.67,
      reduceShareThreshold: 0.67,
      normalizeStopToReduceForNonLossCheck: false,
      minimumReducedRisk: 0.25
    },
    lossRecheckAction: {
      stopAtOrBelowCurrentPnl: -200,
      reduceAtOrBelowCurrentPnl: 0,
      reduceRisk: 0.85,
      tradeRisk: 1
    }
  }
};

function requireObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is required`);
  }
  return value as JsonObject;
}

function requireFiniteNumber(value: unknown, label: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be a finite number`);
  }
  return numeric;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return numeric;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const normalized = value.map((item) => String(item || '').trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error(`${label} must contain at least one non-empty string`);
  }
  return normalized;
}

export function cloneDefaultFeatureEngineeringConfig(): DecisionFeatureEngineeringConfig {
  return JSON.parse(JSON.stringify(DEFAULT_FEATURE_ENGINEERING_CONFIG)) as DecisionFeatureEngineeringConfig;
}

export function getRouterDecisionConfig(featureEngineering: JsonObject | null | undefined): RouterDecisionConfig {
  const payload = requireObject(featureEngineering, 'featureEngineering');
  const routerDecision = requireObject(payload['routerDecision'], 'featureEngineering.routerDecision');
  const periodAction = requireObject(routerDecision['periodAction'], 'featureEngineering.routerDecision.periodAction');
  const dailyAction = requireObject(routerDecision['dailyAction'], 'featureEngineering.routerDecision.dailyAction');
  const aggregateAction = requireObject(routerDecision['aggregateAction'], 'featureEngineering.routerDecision.aggregateAction');
  const lossRecheckAction = requireObject(routerDecision['lossRecheckAction'], 'featureEngineering.routerDecision.lossRecheckAction');

  return {
    periodAction: {
      stopAtOrBelowPnl: requireFiniteNumber(periodAction['stopAtOrBelowPnl'], 'featureEngineering.routerDecision.periodAction.stopAtOrBelowPnl'),
      reduceBelowPnl: requireFiniteNumber(periodAction['reduceBelowPnl'], 'featureEngineering.routerDecision.periodAction.reduceBelowPnl'),
      reduceRisk: requireFiniteNumber(periodAction['reduceRisk'], 'featureEngineering.routerDecision.periodAction.reduceRisk'),
      tradeRisk: requireFiniteNumber(periodAction['tradeRisk'], 'featureEngineering.routerDecision.periodAction.tradeRisk')
    },
    dailyAction: {
      stopAtOrBelowBestPnl: requireFiniteNumber(dailyAction['stopAtOrBelowBestPnl'], 'featureEngineering.routerDecision.dailyAction.stopAtOrBelowBestPnl'),
      minEdgeVsWeekBaseAbsolute: requireFiniteNumber(dailyAction['minEdgeVsWeekBaseAbsolute'], 'featureEngineering.routerDecision.dailyAction.minEdgeVsWeekBaseAbsolute'),
      minEdgeVsWeekBaseRatio: requireFiniteNumber(dailyAction['minEdgeVsWeekBaseRatio'], 'featureEngineering.routerDecision.dailyAction.minEdgeVsWeekBaseRatio'),
      reduceRisk: requireFiniteNumber(dailyAction['reduceRisk'], 'featureEngineering.routerDecision.dailyAction.reduceRisk'),
      tradeRisk: requireFiniteNumber(dailyAction['tradeRisk'], 'featureEngineering.routerDecision.dailyAction.tradeRisk'),
      preferWeekBaseOnReduce: requireBoolean(dailyAction['preferWeekBaseOnReduce'], 'featureEngineering.routerDecision.dailyAction.preferWeekBaseOnReduce')
    },
    aggregateAction: {
      stopShareThreshold: requireFiniteNumber(aggregateAction['stopShareThreshold'], 'featureEngineering.routerDecision.aggregateAction.stopShareThreshold'),
      reduceShareThreshold: requireFiniteNumber(aggregateAction['reduceShareThreshold'], 'featureEngineering.routerDecision.aggregateAction.reduceShareThreshold'),
      normalizeStopToReduceForNonLossCheck: requireBoolean(
        aggregateAction['normalizeStopToReduceForNonLossCheck'],
        'featureEngineering.routerDecision.aggregateAction.normalizeStopToReduceForNonLossCheck'
      ),
      minimumReducedRisk: requireFiniteNumber(aggregateAction['minimumReducedRisk'], 'featureEngineering.routerDecision.aggregateAction.minimumReducedRisk')
    },
    lossRecheckAction: {
      stopAtOrBelowCurrentPnl: requireFiniteNumber(
        lossRecheckAction['stopAtOrBelowCurrentPnl'],
        'featureEngineering.routerDecision.lossRecheckAction.stopAtOrBelowCurrentPnl'
      ),
      reduceAtOrBelowCurrentPnl: requireFiniteNumber(
        lossRecheckAction['reduceAtOrBelowCurrentPnl'],
        'featureEngineering.routerDecision.lossRecheckAction.reduceAtOrBelowCurrentPnl'
      ),
      reduceRisk: requireFiniteNumber(lossRecheckAction['reduceRisk'], 'featureEngineering.routerDecision.lossRecheckAction.reduceRisk'),
      tradeRisk: requireFiniteNumber(lossRecheckAction['tradeRisk'], 'featureEngineering.routerDecision.lossRecheckAction.tradeRisk')
    }
  };
}

export function getDecisionFeatureEngineeringConfig(featureEngineering: JsonObject | null | undefined): DecisionFeatureEngineeringConfig {
  const payload = requireObject(featureEngineering, 'featureEngineering');
  const routerSplit = requireObject(payload['routerSplit'], 'featureEngineering.routerSplit');
  return {
    openingWindowMinutes: requirePositiveInteger(payload['openingWindowMinutes'], 'featureEngineering.openingWindowMinutes'),
    volBaselineLookbackPeriods: requirePositiveInteger(payload['volBaselineLookbackPeriods'], 'featureEngineering.volBaselineLookbackPeriods'),
    routerSplit: {
      enabled: requireBoolean(routerSplit['enabled'], 'featureEngineering.routerSplit.enabled'),
      minSamplesPerBranch: requirePositiveInteger(routerSplit['minSamplesPerBranch'], 'featureEngineering.routerSplit.minSamplesPerBranch'),
      metrics: requireStringArray(routerSplit['metrics'], 'featureEngineering.routerSplit.metrics')
    },
    routerDecision: getRouterDecisionConfig(payload)
  };
}

export function choosePeriodAction(
  bestPnl: number,
  config: RouterDecisionConfig
): { readonly type: RollingRouterAction; readonly risk: number } {
  if (bestPnl <= config.periodAction.stopAtOrBelowPnl) {
    return { type: 'stop', risk: 0 };
  }
  if (bestPnl < config.periodAction.reduceBelowPnl) {
    return { type: 'reduce', risk: config.periodAction.reduceRisk };
  }
  return { type: 'trade', risk: config.periodAction.tradeRisk };
}

export function decideDailyAction(
  input: DailyDecisionInput,
  config: RouterDecisionConfig
): DailyDecisionResult {
  if (input.bestPnl <= config.dailyAction.stopAtOrBelowBestPnl) {
    return {
      actionType: 'stop',
      riskMultiplier: 0,
      selectedStrategyName: null
    };
  }

  const absolutePassed = input.bestPnl > (input.weekBasePnl + config.dailyAction.minEdgeVsWeekBaseAbsolute);
  const ratioPassed = input.bestPnl >= (input.weekBasePnl * config.dailyAction.minEdgeVsWeekBaseRatio);

  if (!absolutePassed || !ratioPassed) {
    return {
      actionType: 'reduce',
      riskMultiplier: config.dailyAction.reduceRisk,
      selectedStrategyName: config.dailyAction.preferWeekBaseOnReduce
        ? (input.weekBaseStrategyName ?? input.bestStrategyName ?? input.monthPrimaryStrategyName)
        : (input.bestStrategyName ?? input.weekBaseStrategyName ?? input.monthPrimaryStrategyName)
    };
  }

  return {
    actionType: 'trade',
    riskMultiplier: config.dailyAction.tradeRisk,
    selectedStrategyName: input.bestStrategyName ?? input.weekBaseStrategyName ?? input.monthPrimaryStrategyName
  };
}

export function summarizeAggregateAction(
  input: AggregateActionInput,
  config: RouterDecisionConfig
): { readonly actionType: RollingRouterAction; readonly averageRisk: number } {
  const actionType: RollingRouterAction = input.stopShare >= config.aggregateAction.stopShareThreshold
    ? 'stop'
    : input.reduceShare >= config.aggregateAction.reduceShareThreshold
      ? 'reduce'
      : 'trade';

  if (
    input.layer !== 'loss_recheck'
    && actionType === 'stop'
    && config.aggregateAction.normalizeStopToReduceForNonLossCheck
  ) {
    return {
      actionType: 'reduce',
      averageRisk: Math.max(input.averageRisk, config.aggregateAction.minimumReducedRisk)
    };
  }

  return {
    actionType,
    averageRisk: input.averageRisk
  };
}
