import type { ScenarioCoverage } from './market-feature-scenarios';

export interface UtFeatureBaselineInput {
  readonly scenarioKey: string;
  readonly coverage: ScenarioCoverage;
  readonly validationConfigCount: number;
  readonly routerRuleCount: number;
  readonly routerTradedDays: number;
  readonly routerTotalPnl: number;
  readonly pipelineStepCount: number;
}

export interface UtFeatureBaselineResult {
  readonly checks: readonly string[];
}

function assertCondition(condition: boolean, message: string, checks: string[]): void {
  if (!condition) {
    throw new Error(message);
  }
  checks.push(message);
}

export function assertUtFeatureBaseline(input: UtFeatureBaselineInput): UtFeatureBaselineResult {
  const checks: string[] = [];

  assertCondition(input.validationConfigCount > 0, 'validation configs must be generated', checks);
  assertCondition(input.routerRuleCount > 0, 'router rules must be generated', checks);
  assertCondition(input.routerTradedDays > 0, 'router must trade at least one day', checks);
  assertCondition(input.routerTotalPnl !== 0, 'router pnl must be non-zero', checks);
  assertCondition(input.pipelineStepCount >= 5, 'pipeline summary must contain core stages', checks);

  if (input.scenarioKey === 'rolling-regime-shift') {
    const dailyBuckets = new Set(input.coverage.dailyBuckets);
    const monthlyBuckets = new Set(input.coverage.monthlyBuckets);

    assertCondition(input.validationConfigCount >= 3, 'rolling-regime-shift must generate at least 3 validation configs', checks);
    assertCondition(dailyBuckets.has('range-low-vol'), 'rolling-regime-shift must cover range-low-vol daily bucket', checks);
    assertCondition(dailyBuckets.has('strong-trend'), 'rolling-regime-shift must cover strong-trend daily bucket', checks);
    assertCondition(dailyBuckets.has('crash-trend'), 'rolling-regime-shift must cover crash-trend daily bucket', checks);
    assertCondition(dailyBuckets.has('mixed-trend'), 'rolling-regime-shift must cover mixed-trend daily bucket', checks);
    assertCondition(monthlyBuckets.size >= 3, 'rolling-regime-shift must cover at least 3 monthly buckets', checks);
  }

  return { checks };
}
