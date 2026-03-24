import * as path from 'path';

type JsonObject = Record<string, any>;
type RouterLayer = 'monthly_guard' | 'weekly_guard' | 'daily_router' | 'loss_recheck';
type RouterActionType = 'trade' | 'reduce' | 'stop';

interface StrategySnapshotRow {
  readonly rank?: number;
  readonly strategyName?: string;
  readonly name?: string;
}

interface TrainingConfigLike {
  readonly name?: string;
  readonly symbol?: string;
  readonly trainId?: string;
  readonly trainingMeta?: {
    readonly trainId?: string;
  };
  readonly market?: {
    readonly symbol?: string;
  };
  readonly regimeRouting?: {
    readonly routerConfigPath?: string;
    readonly policyCatalogPath?: string;
  };
}

interface RouterStrategyRef {
  readonly strategyName: string;
  readonly shortLabel: string;
  readonly role?: string;
}

interface RouterRule {
  readonly id: string;
  readonly layer: RouterLayer;
  readonly priority: number;
  readonly when?: JsonObject;
  readonly action: {
    readonly type: RouterActionType;
    readonly riskCap?: number;
    readonly riskMultiplier?: number;
    readonly strategyKey?: string;
  };
  readonly rationale?: string;
}

interface RouterConfigLike {
  readonly symbol?: string;
  readonly trainId?: string;
  readonly trainingMeta?: {
    readonly trainId?: string;
  };
  readonly routerVersion?: string;
  readonly executionModel?: {
    readonly precedence?: readonly string[];
    readonly defaultFallback?: {
      readonly action?: 'reduce' | 'trade';
      readonly riskMultiplier?: number;
      readonly strategyKey?: string;
    };
  };
  readonly strategyCatalog?: Record<string, RouterStrategyRef>;
  readonly rules?: readonly RouterRule[];
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function sanitizeToken(value: unknown, fallback = 'run'): string {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

  return normalized || fallback;
}

export function buildDefaultRouterConfigKey(trainingConfigKey: string): string {
  const baseName = path.basename(String(trainingConfigKey || ''), '.json');
  return `configs/generated/regime-routing/${baseName}_router.json`;
}

export function buildDefaultPolicyConfigKey(routerConfigKey: string): string {
  return String(routerConfigKey).replace(/\.json$/i, '.policy.json');
}

export function buildRelativeConfigRef(fromConfigKey: string, targetConfigKey: string): string {
  return toPosix(path.posix.relative(path.posix.dirname(String(fromConfigKey)), String(targetConfigKey)));
}

export function resolveRelativeConfigRef(baseConfigKey: string, targetRef: string): string {
  return toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(String(baseConfigKey || '')), String(targetRef || ''))));
}

export function buildStrategyCatalogFromSnapshot(snapshotContent: JsonObject | null | undefined): Record<string, RouterStrategyRef> {
  const strategyBlock = snapshotContent?.['strategy'] as JsonObject | undefined;
  const explicitStrategies = Array.isArray(strategyBlock?.['explicitStrategies'])
    ? strategyBlock?.['explicitStrategies']
    : [];
  const fallbackStrategies = Array.isArray(snapshotContent?.['strategies'])
    ? snapshotContent?.['strategies']
    : [];
  const sourceStrategies = (explicitStrategies.length > 0 ? explicitStrategies : fallbackStrategies) as readonly StrategySnapshotRow[];

  return sourceStrategies.slice(0, 10).reduce((accumulator, strategy, index) => {
    const key = `rank${index + 1}`;
    const strategyName = String(strategy?.name || strategy?.strategyName || `Strategy ${index + 1}`);
    accumulator[key] = {
      strategyName,
      shortLabel: `TOP${index + 1}`,
      role: index === 0 ? 'default-fallback' : 'candidate'
    };
    return accumulator;
  }, {} as Record<string, RouterStrategyRef>);
}

function buildRouterVersion(symbol: string, trainingConfig: TrainingConfigLike, trainId: string, previousRouter: RouterConfigLike | null): string {
  const previousVersion = String(previousRouter?.routerVersion || '').trim();
  const previousTrainId = String(previousRouter?.trainId || previousRouter?.trainingMeta?.trainId || '').trim();
  if (previousVersion && (!trainId || previousTrainId === trainId)) {
    return previousVersion;
  }
  if (previousVersion) {
    const match = previousVersion.match(/_v(\d+)$/i);
    if (match) {
      const nextVersion = Number(match[1] || '1') + 1;
      return previousVersion.replace(/_v\d+$/i, `_v${nextVersion}`);
    }
    return `${previousVersion}_v2`;
  }

  const runTag = sanitizeToken(String(trainingConfig.name || '').replace(/^\d{4}_/i, '').replace(new RegExp(`^${symbol}_`, 'i'), ''), 'rolling');
  return `${symbol.toLowerCase()}_${runTag}_${sanitizeToken(trainId || 'router')}`;
}

function pruneRules(rules: readonly RouterRule[] | undefined, strategyCatalog: Record<string, RouterStrategyRef>): readonly RouterRule[] {
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules
    .filter((rule) => {
      const strategyKey = String(rule?.action?.strategyKey || '').trim();
      return !strategyKey || Boolean(strategyCatalog[strategyKey]);
    })
    .map((rule, index) => ({
      ...rule,
      priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : index + 1
    }));
}

function summarizeConditionValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join('/') : null;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as JsonObject)
      .filter(([, entryValue]) => entryValue != null)
      .map(([key, entryValue]) => `${key}:${entryValue}`);
    return entries.length > 0 ? entries.join(', ') : null;
  }

  return value == null || value === '' ? null : String(value);
}

function buildFeatureSummary(when: JsonObject | undefined): string {
  if (!when || typeof when !== 'object') {
    return 'fallback';
  }

  const segments = Object.entries(when)
    .map(([key, value]) => {
      const summary = summarizeConditionValue(value);
      return summary ? `${key}=${summary}` : null;
    })
    .filter(Boolean);

  return segments.length > 0 ? segments.join(' | ') : 'fallback';
}

function buildEventSegment(rule: RouterRule): string {
  const when = rule.when && typeof rule.when === 'object' ? rule.when : {};
  const featureBucket = Array.isArray(when['featureBucket']) && when['featureBucket'].length > 0
    ? when['featureBucket'].join('/')
    : Array.isArray(when['previousDayFeatureBucket']) && when['previousDayFeatureBucket'].length > 0
      ? `prev:${when['previousDayFeatureBucket'].join('/')}`
      : null;

  if (featureBucket) {
    return featureBucket;
  }

  return rule.layer === 'loss_recheck'
    ? 'loss-feedback'
    : rule.layer;
}

export function buildPolicyContent(
  routerContent: JsonObject,
  routerConfigKey: string,
  notes: readonly string[] = []
): JsonObject {
  const strategyCatalog = routerContent?.['strategyCatalog'] && typeof routerContent['strategyCatalog'] === 'object'
    ? routerContent['strategyCatalog'] as Record<string, RouterStrategyRef>
    : {};
  const executionModel = routerContent?.['executionModel'] as JsonObject | undefined;
  const defaultFallback = executionModel?.['defaultFallback'] as JsonObject | undefined;
  const defaultStrategyKey = String(defaultFallback?.['strategyKey'] || '').trim();
  const defaultStrategy = defaultStrategyKey
    ? strategyCatalog[defaultStrategyKey]
    : null;
  const rules = Array.isArray(routerContent?.['rules']) ? routerContent['rules'] as readonly RouterRule[] : [];

  const entries = rules.map((rule) => {
    const strategyKey = String(rule?.action?.strategyKey || '').trim();
    const strategyRef = strategyKey ? strategyCatalog[strategyKey] : null;
    return {
      eventSegment: buildEventSegment(rule),
      layer: rule.layer,
      ruleId: rule.id,
      featureSummary: buildFeatureSummary(rule.when),
      actionType: rule.action.type,
      ...(rule.action.riskCap != null ? { riskCap: Number(rule.action.riskCap) } : {}),
      ...(rule.action.riskMultiplier != null ? { riskMultiplier: Number(rule.action.riskMultiplier) } : {}),
      ...(strategyRef && strategyKey
        ? {
            strategy: {
              strategyKey,
              strategyLabel: strategyRef.shortLabel,
              strategyName: strategyRef.strategyName
            }
          }
        : {}),
      ...(rule.rationale ? { rationale: rule.rationale } : {})
    };
  });

  return {
    symbol: String(routerContent?.['symbol'] || 'BTCJPY').toUpperCase(),
    routerVersion: String(routerContent?.['routerVersion'] || 'router_v1'),
    catalogVersion: `${String(routerContent?.['routerVersion'] || 'router_v1')}_policy_v1`,
    generatedDate: new Date().toISOString(),
    source: {
      routerConfigPath: path.posix.basename(routerConfigKey),
      notes: [
        'Auto-generated from rolling snapshot',
        ...notes
      ]
    },
    ...(defaultFallback && defaultStrategy
      ? {
          defaultFallback: {
            action: defaultFallback['action'],
            riskMultiplier: Number(defaultFallback['riskMultiplier'] ?? 1),
            strategy: {
              strategyKey: defaultStrategyKey,
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

export function buildRollingRouterArtifacts(options: {
  readonly trainingConfig: TrainingConfigLike;
  readonly trainingConfigKey: string;
  readonly snapshotContent: JsonObject;
  readonly previousRouter?: RouterConfigLike | null;
}): {
  readonly routerConfigKey: string;
  readonly policyConfigKey: string;
  readonly routerRelativeRef: string;
  readonly policyRelativeRef: string;
  readonly routerContent: JsonObject;
  readonly policyContent: JsonObject;
} {
  const { trainingConfig, trainingConfigKey, snapshotContent, previousRouter = null } = options;
  const regimeRouting = trainingConfig.regimeRouting;
  const existingRouterRef = String(regimeRouting?.routerConfigPath || '').trim();
  const existingPolicyRef = String(regimeRouting?.policyCatalogPath || '').trim();
  const routerConfigKey = existingRouterRef
    ? resolveRelativeConfigRef(trainingConfigKey, existingRouterRef)
    : buildDefaultRouterConfigKey(trainingConfigKey);
  const policyConfigKey = existingPolicyRef
    ? resolveRelativeConfigRef(trainingConfigKey, existingPolicyRef)
    : buildDefaultPolicyConfigKey(routerConfigKey);

  const symbol = String(trainingConfig.market?.symbol || trainingConfig.symbol || snapshotContent?.['symbol'] || 'BTCJPY').toUpperCase();
  const trainId = String(
    trainingConfig.trainId
    || trainingConfig.trainingMeta?.trainId
    || snapshotContent?.['trainId']
    || (snapshotContent?.['trainingMeta'] as JsonObject | undefined)?.['trainId']
    || ''
  ).trim();
  const strategyCatalog = buildStrategyCatalogFromSnapshot(snapshotContent);
  const strategyKeys = Object.keys(strategyCatalog);
  const previousFallback = previousRouter?.executionModel?.defaultFallback;
  const defaultStrategyKey = previousFallback?.strategyKey && strategyCatalog[previousFallback.strategyKey]
    ? previousFallback.strategyKey
    : (strategyKeys[0] || 'rank1');

  const routerContent = {
    symbol,
    trainId: trainId || undefined,
    trainingMeta: {
      trainId: trainId || undefined,
      trainingConfigKey,
      source: 'rolling-window'
    },
    routerVersion: buildRouterVersion(symbol, trainingConfig, trainId, previousRouter),
    policyCatalogPath: path.posix.basename(policyConfigKey),
    executionModel: {
      precedence: ['monthly_guard', 'weekly_guard', 'daily_router', 'loss_recheck'],
      defaultFallback: {
        action: previousFallback?.action === 'reduce' ? 'reduce' : 'trade',
        riskMultiplier: Number(previousFallback?.riskMultiplier ?? 1),
        strategyKey: defaultStrategyKey
      }
    },
    strategyCatalog,
    rules: pruneRules(previousRouter?.rules, strategyCatalog)
  };

  const policyContent = buildPolicyContent(routerContent, routerConfigKey, previousRouter
    ? ['Compatible rules were carried forward from the previous rolling router']
    : ['Initialized from current Top-N snapshot']);

  return {
    routerConfigKey,
    policyConfigKey,
    routerRelativeRef: buildRelativeConfigRef(trainingConfigKey, routerConfigKey),
    policyRelativeRef: buildRelativeConfigRef(trainingConfigKey, policyConfigKey),
    routerContent,
    policyContent
  };
}
