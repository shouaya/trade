import * as fs from 'fs';
import * as path from 'path';

export type RouterPolicyLayer = 'monthly_guard' | 'weekly_guard' | 'daily_router';
export type RouterPolicyActionType = 'trade' | 'reduce' | 'stop';

interface RouterStrategyRefLike {
  readonly strategyName: string;
  readonly shortLabel: string;
}

interface RouterRuleLike {
  readonly id: string;
  readonly layer: RouterPolicyLayer;
  readonly action: {
    readonly type: RouterPolicyActionType;
    readonly strategyKey?: string;
  };
}

interface RouterConfigLike {
  readonly symbol: string;
  readonly routerVersion: string;
  readonly policyCatalogPath?: string;
  readonly strategyCatalog: Record<string, RouterStrategyRefLike>;
  readonly executionModel?: {
    readonly defaultFallback?: {
      readonly action: 'reduce' | 'trade';
      readonly riskMultiplier: number;
      readonly strategyKey: string;
    };
  };
  readonly rules: readonly RouterRuleLike[];
}

interface RouterPolicyCatalogSource {
  readonly routerConfigPath: string;
  readonly markdownPath?: string;
  readonly notes?: readonly string[];
}

interface RouterPolicyCatalogStrategy {
  readonly strategyKey: string;
  readonly strategyLabel: string;
  readonly strategyName: string;
}

interface RouterPolicyCatalogEntry {
  readonly eventSegment: string;
  readonly layer: RouterPolicyLayer;
  readonly ruleId: string;
  readonly featureSummary: string;
  readonly actionType: RouterPolicyActionType;
  readonly riskCap?: number;
  readonly riskMultiplier?: number;
  readonly strategy?: RouterPolicyCatalogStrategy;
  readonly rationale?: string;
}

export interface RouterPolicyCatalog {
  readonly symbol: string;
  readonly routerVersion: string;
  readonly catalogVersion: string;
  readonly generatedDate: string;
  readonly source: RouterPolicyCatalogSource;
  readonly defaultFallback?: {
    readonly action: 'reduce' | 'trade';
    readonly riskMultiplier: number;
    readonly strategy: RouterPolicyCatalogStrategy;
  };
  readonly eventSegments: readonly RouterPolicyCatalogEntry[];
  readonly dailyGuards: readonly RouterPolicyCatalogEntry[];
}

interface RouterPolicyCatalogLoadRefs {
  readonly baseFilePath: string;
  readonly routerConfigPath: string | undefined;
  readonly policyCatalogPath: string | undefined;
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function resolvePathFromFile(baseFilePath: string, targetPath: string): string {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }
  return path.resolve(path.dirname(baseFilePath), targetPath);
}

function strategyText(strategy: RouterPolicyCatalogEntry['strategy'] | undefined): string {
  return strategy?.strategyLabel ?? '-';
}

function validateEntry(
  entry: RouterPolicyCatalogEntry,
  routerConfig: RouterConfigLike,
  ruleMap: ReadonlyMap<string, RouterRuleLike>
): void {
  const routerRule = ruleMap.get(entry.ruleId);
  if (!routerRule) {
    throw new Error(`policy catalog rule missing in router config: ${entry.ruleId}`);
  }
  if (routerRule.layer !== entry.layer) {
    throw new Error(`policy catalog layer mismatch for ${entry.ruleId}`);
  }
  if (routerRule.action.type !== entry.actionType) {
    throw new Error(`policy catalog action mismatch for ${entry.ruleId}`);
  }

  const expectedStrategyKey = routerRule.action.strategyKey;
  const catalogStrategyKey = entry.strategy?.strategyKey;
  if ((expectedStrategyKey ?? null) !== (catalogStrategyKey ?? null)) {
    throw new Error(`policy catalog strategy mismatch for ${entry.ruleId}`);
  }

  if (!catalogStrategyKey) {
    return;
  }

  const strategyRef = routerConfig.strategyCatalog[catalogStrategyKey];
  if (!strategyRef) {
    throw new Error(`policy catalog strategy missing in router config: ${catalogStrategyKey}`);
  }
  if (strategyRef.shortLabel !== entry.strategy?.strategyLabel || strategyRef.strategyName !== entry.strategy?.strategyName) {
    throw new Error(`policy catalog strategy detail mismatch for ${entry.ruleId}`);
  }
}

export function validateRouterPolicyCatalog(catalog: RouterPolicyCatalog, routerConfig: RouterConfigLike): void {
  if (catalog.symbol.toUpperCase() !== routerConfig.symbol.toUpperCase()) {
    throw new Error(`policy catalog symbol mismatch: ${catalog.symbol} vs ${routerConfig.symbol}`);
  }
  if (catalog.routerVersion !== routerConfig.routerVersion) {
    throw new Error(`policy catalog routerVersion mismatch: ${catalog.routerVersion} vs ${routerConfig.routerVersion}`);
  }

  const ruleMap = new Map(routerConfig.rules.map((rule) => [rule.id, rule] as const));
  for (const entry of catalog.eventSegments) {
    validateEntry(entry, routerConfig, ruleMap);
  }
  for (const entry of catalog.dailyGuards) {
    validateEntry(entry, routerConfig, ruleMap);
  }

  const fallback = catalog.defaultFallback;
  if (!fallback) {
    return;
  }

  const routerFallback = routerConfig.executionModel?.defaultFallback;
  if (!routerFallback) {
    throw new Error('policy catalog defines defaultFallback but router config does not');
  }
  if (fallback.action !== routerFallback.action || fallback.riskMultiplier !== routerFallback.riskMultiplier) {
    throw new Error('policy catalog defaultFallback mismatch');
  }

  const strategyRef = routerConfig.strategyCatalog[routerFallback.strategyKey];
  if (!strategyRef) {
    throw new Error(`policy catalog defaultFallback strategy missing: ${routerFallback.strategyKey}`);
  }
  if (
    fallback.strategy.strategyKey !== routerFallback.strategyKey
    || fallback.strategy.strategyLabel !== strategyRef.shortLabel
    || fallback.strategy.strategyName !== strategyRef.strategyName
  ) {
    throw new Error('policy catalog defaultFallback strategy detail mismatch');
  }
}

export function loadRouterPolicyCatalogByPath(policyCatalogPath: string): RouterPolicyCatalog {
  return loadJson<RouterPolicyCatalog>(policyCatalogPath);
}

export function loadRouterPolicyCatalogByRouterConfig(
  routerConfigPath: string,
  routerConfig: RouterConfigLike
): RouterPolicyCatalog | null {
  if (!routerConfig.policyCatalogPath) {
    return null;
  }

  const resolvedCatalogPath = resolvePathFromFile(routerConfigPath, routerConfig.policyCatalogPath);
  const catalog = loadRouterPolicyCatalogByPath(resolvedCatalogPath);
  validateRouterPolicyCatalog(catalog, routerConfig);
  return catalog;
}

export function loadRouterPolicyCatalogFromRefs(refs: RouterPolicyCatalogLoadRefs): RouterPolicyCatalog | null {
  if (refs.policyCatalogPath) {
    return loadRouterPolicyCatalogByPath(resolvePathFromFile(refs.baseFilePath, refs.policyCatalogPath));
  }

  if (!refs.routerConfigPath) {
    return null;
  }

  const resolvedRouterConfigPath = resolvePathFromFile(refs.baseFilePath, refs.routerConfigPath);
  const routerConfig = loadJson<RouterConfigLike>(resolvedRouterConfigPath);
  return loadRouterPolicyCatalogByRouterConfig(resolvedRouterConfigPath, routerConfig);
}

export function summarizePolicyCatalog(catalog: RouterPolicyCatalog): readonly string[] {
  const stopCount = catalog.eventSegments.filter((entry) => entry.actionType === 'stop').length
    + catalog.dailyGuards.filter((entry) => entry.actionType === 'stop').length;
  const reduceCount = catalog.eventSegments.filter((entry) => entry.actionType === 'reduce').length
    + catalog.dailyGuards.filter((entry) => entry.actionType === 'reduce').length;

  return [
    `事件段策略: ${catalog.eventSegments.length}`,
    `日级保护: ${catalog.dailyGuards.length}`,
    `停做规则: ${stopCount}`,
    `减仓规则: ${reduceCount}`
  ];
}

function renderEntryRow(entry: RouterPolicyCatalogEntry): string {
  const actionValue = entry.actionType === 'stop'
    ? 'stop'
    : `${entry.actionType} (${entry.riskCap ?? entry.riskMultiplier ?? 1})`;
  return `| ${entry.eventSegment} | ${entry.featureSummary} | ${entry.ruleId} | ${actionValue} | ${strategyText(entry.strategy)} |`;
}

export function renderPolicyCatalogMarkdown(catalog: RouterPolicyCatalog): string {
  const eventRows = catalog.eventSegments.map(renderEntryRow).join('\n');
  const dayRows = catalog.dailyGuards.map((entry) => {
    const actionValue = entry.actionType === 'stop'
      ? 'stop'
      : `${entry.actionType} (${entry.riskMultiplier ?? entry.riskCap ?? 1})`;
    return `| ${entry.eventSegment} | ${entry.ruleId} | ${actionValue} |`;
  }).join('\n');

  return `## Policy Catalog

- Catalog version: \`${catalog.catalogVersion}\`
- Generated date: \`${catalog.generatedDate}\`
- Event segments: \`${catalog.eventSegments.length}\`
- Daily guards: \`${catalog.dailyGuards.length}\`

### Event Segment -> Policy

| Event Segment | Feature Signature | Router Rule | Action | Strategy |
| --- | --- | --- | --- | --- |
${eventRows}

### Daily Guards

| Daily Event | Router Rule | Action |
| --- | --- | --- |
${dayRows}
`;
}
