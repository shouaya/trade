#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import db from '../configs/database';
import { runRouterValidation, type RouterValidationReport } from '../services/regime-router-validation';
import { renderPolicyCatalogMarkdown } from '../services/router-policy-catalog';

interface CliArgs {
  readonly validation: string;
  readonly router: string;
  readonly tradeCreatedAt?: string;
}

function loadTrainIdFromValidationConfig(validationPath: string): string | null {
  try {
    const payload = JSON.parse(fs.readFileSync(path.resolve(validationPath), 'utf8'));
    return String(payload?.trainId || payload?.trainingMeta?.trainId || '').trim() || null;
  } catch {
    return null;
  }
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args = argv.slice(2);
  let validation = '';
  let router = '';
  let tradeCreatedAt: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg.startsWith('--validation=')) {
      validation = arg.slice('--validation='.length);
      continue;
    }
    if (arg === '--validation') {
      validation = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--router=')) {
      router = arg.slice('--router='.length);
      continue;
    }
    if (arg === '--router') {
      router = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--tradeCreatedAt=')) {
      tradeCreatedAt = arg.slice('--tradeCreatedAt='.length);
      continue;
    }
    if (arg === '--tradeCreatedAt') {
      tradeCreatedAt = args[index + 1] ?? '';
      index += 1;
    }
  }

  if (!validation) {
    throw new Error('missing --validation');
  }
  if (!router) {
    throw new Error('missing --router');
  }

  if (tradeCreatedAt) {
    return {
      validation,
      router,
      tradeCreatedAt
    };
  }

  return {
    validation,
    router
  };
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function extractPeriodLabel(report: RouterValidationReport): string {
  const start = new Date(report.period.startTimeMs).toISOString().slice(0, 10);
  const end = new Date(report.period.endTimeMs).toISOString().slice(0, 10);
  return `${start}_to_${end}`;
}

function topDeltaLine(baseLabel: string, routerPnl: number, basePnl: number): string {
  const delta = Number((routerPnl - basePnl).toFixed(2));
  const sign = delta >= 0 ? '+' : '';
  return `- 相对 ${baseLabel}: \`${sign}${delta}\``;
}

type RoutingAction = 'trade' | 'reduce' | 'stop';

interface WeeklyRouteSummary {
  readonly week: string;
  readonly pnl: number;
  readonly stopDays: number;
  readonly reduceDays: number;
  readonly fullSizeDays: number;
  readonly strategySwitches: number;
  readonly actionSwitches: number;
}

function deriveAction(effectiveRiskMultiplier: number): RoutingAction {
  if (effectiveRiskMultiplier === 0) return 'stop';
  if (effectiveRiskMultiplier < 1) return 'reduce';
  return 'trade';
}

function buildWeeklyRouteSummary(report: RouterValidationReport): WeeklyRouteSummary[] {
  const weekMap = new Map<string, WeeklyRouteSummary>();

  for (const row of report.dailyRoutes) {
    const action = deriveAction(row.effectiveRiskMultiplier);
    const current = weekMap.get(row.week) ?? {
      week: row.week,
      pnl: 0,
      stopDays: 0,
      reduceDays: 0,
      fullSizeDays: 0,
      strategySwitches: 0,
      actionSwitches: 0
    };

    weekMap.set(row.week, {
      ...current,
      pnl: Number((current.pnl + row.routedPnl).toFixed(2)),
      stopDays: current.stopDays + (action === 'stop' ? 1 : 0),
      reduceDays: current.reduceDays + (action === 'reduce' ? 1 : 0),
      fullSizeDays: current.fullSizeDays + (action === 'trade' ? 1 : 0)
    });
  }

  const sortedDays = [...report.dailyRoutes].sort((left, right) => left.day.localeCompare(right.day));
  let previousWeek: string | null = null;
  let previousAction: RoutingAction | null = null;
  let previousStrategyKey: string | null = null;

  for (const row of sortedDays) {
    const action = deriveAction(row.effectiveRiskMultiplier);
    if (row.week !== previousWeek) {
      previousWeek = row.week;
      previousAction = action;
      previousStrategyKey = row.selectedStrategyKey;
      continue;
    }

    const weekRow = weekMap.get(row.week);
    if (!weekRow) continue;

    let nextWeekRow = weekRow;
    if (action !== previousAction) {
      nextWeekRow = {
        ...nextWeekRow,
        actionSwitches: nextWeekRow.actionSwitches + 1
      };
    }
    if (row.selectedStrategyKey !== previousStrategyKey) {
      nextWeekRow = {
        ...nextWeekRow,
        strategySwitches: nextWeekRow.strategySwitches + 1
      };
    }
    if (nextWeekRow !== weekRow) {
      weekMap.set(row.week, nextWeekRow);
    }

    previousAction = action;
    previousStrategyKey = row.selectedStrategyKey;
  }

  return [...weekMap.values()].sort((left, right) => left.week.localeCompare(right.week));
}

function buildRedlineNotes(report: RouterValidationReport, weeklySummary: readonly WeeklyRouteSummary[]): string[] {
  const router = report.comparison.router;
  const defaultStrategy = report.comparison.defaultStrategy;
  const topWeeks = [...weeklySummary]
    .filter((row) => row.pnl > 0)
    .sort((left, right) => right.pnl - left.pnl)
    .slice(0, 3);
  const topWeeksPnl = topWeeks.reduce((sum, row) => sum + row.pnl, 0);
  const topWeeksShare = router.totalPnl > 0
    ? Number(((topWeeksPnl / router.totalPnl) * 100).toFixed(2))
    : 0;

  return [
    router.totalPnl < 0
      ? '- Redline: future total PnL is negative.'
      : '- Redline check: future total PnL remains positive.',
    router.totalPnl < defaultStrategy.totalPnl
      ? `- Redline: router underperforms default strategy by \`${Number((defaultStrategy.totalPnl - router.totalPnl).toFixed(2))}\`.`
      : `- Redline check: router beats default strategy by \`${Number((router.totalPnl - defaultStrategy.totalPnl).toFixed(2))}\`.`,
    router.maxDrawdown > defaultStrategy.maxDrawdown && router.totalPnl <= defaultStrategy.totalPnl
      ? '- Redline: drawdown is worse than default without a compensating return gain.'
      : '- Redline check: drawdown deterioration without compensation is not obvious.',
    topWeeksShare >= 80
      ? `- Redline: top 3 positive weeks contribute \`${topWeeksShare}%\` of total PnL.`
      : `- Concentration check: top 3 positive weeks contribute \`${topWeeksShare}%\` of total PnL.`
  ];
}

function renderMarkdown(report: RouterValidationReport): string {
  const { comparison } = report;
  const stopDays = report.dailyRoutes.filter((row) => row.effectiveRiskMultiplier === 0).length;
  const halfOrLessDays = report.dailyRoutes.filter((row) => row.effectiveRiskMultiplier > 0 && row.effectiveRiskMultiplier <= 0.5).length;
  const fullSizeDays = report.dailyRoutes.filter((row) => row.effectiveRiskMultiplier >= 1).length;
  const lossRecheckDays = report.dailyRoutes.filter((row) => row.lossRuleId !== null).length;
  const weeklySummary = buildWeeklyRouteSummary(report);
  const strategySwitches = weeklySummary.reduce((sum, row) => sum + row.strategySwitches, 0);
  const actionSwitches = weeklySummary.reduce((sum, row) => sum + row.actionSwitches, 0);
  const highChurnWeeks = weeklySummary.filter((row) => row.strategySwitches + row.actionSwitches >= 3).length;
  const redlineNotes = buildRedlineNotes(report, weeklySummary);
  const topPositive = [...report.dailyRoutes]
    .sort((left, right) => right.routedPnl - left.routedPnl)
    .slice(0, 10);
  const topNegative = [...report.dailyRoutes]
    .sort((left, right) => left.routedPnl - right.routedPnl)
    .slice(0, 10);
  const bestWeeks = [...weeklySummary]
    .sort((left, right) => right.pnl - left.pnl)
    .slice(0, 5);
  const worstWeeks = [...weeklySummary]
    .sort((left, right) => left.pnl - right.pnl)
    .slice(0, 5);
  const policyCatalogSection = report.policyCatalog
    ? `${renderPolicyCatalogMarkdown(report.policyCatalog)}\n`
    : '';

  return `# ${report.symbol} Router Validation ${report.validationName}

- Router version: \`${report.routerVersion}\`
- Trade batch: \`${report.tradeCreatedAt}\`
- Period: \`${new Date(report.period.startTimeMs).toISOString()}\` -> \`${new Date(report.period.endTimeMs).toISOString()}\`

## Summary

- Router PnL: \`${comparison.router.totalPnl}\`
- Router return: \`${comparison.router.returnPct}%\`
- Router max drawdown: \`${comparison.router.maxDrawdown}\`
- Router traded days: \`${comparison.router.tradedDays}\`
- Router positive weeks: \`${comparison.router.positiveWeeks}\`
- Router negative weeks: \`${comparison.router.negativeWeeks}\`
${topDeltaLine(comparison.defaultStrategy.label, comparison.router.totalPnl, comparison.defaultStrategy.totalPnl)}
${topDeltaLine(comparison.rank1Strategy.label, comparison.router.totalPnl, comparison.rank1Strategy.totalPnl)}
${topDeltaLine(comparison.top10EqualWeight.label, comparison.router.totalPnl, comparison.top10EqualWeight.totalPnl)}

## Scorecard

- Router positive days / negative days: \`${comparison.router.positiveDays}\` / \`${comparison.router.negativeDays}\`
- Router positive weeks / negative weeks: \`${comparison.router.positiveWeeks}\` / \`${comparison.router.negativeWeeks}\`
- Default positive weeks / negative weeks: \`${comparison.defaultStrategy.positiveWeeks}\` / \`${comparison.defaultStrategy.negativeWeeks}\`
- Rank1 positive weeks / negative weeks: \`${comparison.rank1Strategy.positiveWeeks}\` / \`${comparison.rank1Strategy.negativeWeeks}\`
- Top10 EW positive weeks / negative weeks: \`${comparison.top10EqualWeight.positiveWeeks}\` / \`${comparison.top10EqualWeight.negativeWeeks}\`

## Redline Check

${redlineNotes.join('\n')}

## Comparison

| Strategy | Total PnL | Return % | Max DD | Max DD % | Positive Days | Negative Days | Positive Weeks | Negative Weeks | Traded Days | Final Equity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Router | ${comparison.router.totalPnl} | ${comparison.router.returnPct} | ${comparison.router.maxDrawdown} | ${comparison.router.maxDrawdownPct} | ${comparison.router.positiveDays} | ${comparison.router.negativeDays} | ${comparison.router.positiveWeeks} | ${comparison.router.negativeWeeks} | ${comparison.router.tradedDays} | ${comparison.router.finalEquity} |
| ${comparison.defaultStrategy.label} | ${comparison.defaultStrategy.totalPnl} | ${comparison.defaultStrategy.returnPct} | ${comparison.defaultStrategy.maxDrawdown} | ${comparison.defaultStrategy.maxDrawdownPct} | ${comparison.defaultStrategy.positiveDays} | ${comparison.defaultStrategy.negativeDays} | ${comparison.defaultStrategy.positiveWeeks} | ${comparison.defaultStrategy.negativeWeeks} | ${comparison.defaultStrategy.tradedDays} | ${comparison.defaultStrategy.finalEquity} |
| ${comparison.rank1Strategy.label} | ${comparison.rank1Strategy.totalPnl} | ${comparison.rank1Strategy.returnPct} | ${comparison.rank1Strategy.maxDrawdown} | ${comparison.rank1Strategy.maxDrawdownPct} | ${comparison.rank1Strategy.positiveDays} | ${comparison.rank1Strategy.negativeDays} | ${comparison.rank1Strategy.positiveWeeks} | ${comparison.rank1Strategy.negativeWeeks} | ${comparison.rank1Strategy.tradedDays} | ${comparison.rank1Strategy.finalEquity} |
| ${comparison.top10EqualWeight.label} | ${comparison.top10EqualWeight.totalPnl} | ${comparison.top10EqualWeight.returnPct} | ${comparison.top10EqualWeight.maxDrawdown} | ${comparison.top10EqualWeight.maxDrawdownPct} | ${comparison.top10EqualWeight.positiveDays} | ${comparison.top10EqualWeight.negativeDays} | ${comparison.top10EqualWeight.positiveWeeks} | ${comparison.top10EqualWeight.negativeWeeks} | ${comparison.top10EqualWeight.tradedDays} | ${comparison.top10EqualWeight.finalEquity} |
| ${comparison.oracleBestOfDay.label} | ${comparison.oracleBestOfDay.totalPnl} | ${comparison.oracleBestOfDay.returnPct} | ${comparison.oracleBestOfDay.maxDrawdown} | ${comparison.oracleBestOfDay.maxDrawdownPct} | ${comparison.oracleBestOfDay.positiveDays} | ${comparison.oracleBestOfDay.negativeDays} | ${comparison.oracleBestOfDay.positiveWeeks} | ${comparison.oracleBestOfDay.negativeWeeks} | ${comparison.oracleBestOfDay.tradedDays} | ${comparison.oracleBestOfDay.finalEquity} |

## Routing Mix

- Stop days: \`${stopDays}\`
- Half-or-less risk days: \`${halfOrLessDays}\`
- Full-size days: \`${fullSizeDays}\`
- Loss-recheck override days: \`${lossRecheckDays}\`

## Stability

- Strategy switches: \`${strategySwitches}\`
- Action switches: \`${actionSwitches}\`
- High-churn weeks (>= 3 combined switches): \`${highChurnWeeks}\`

## Weekly Summary

| Week | PnL | Stop Days | Reduce Days | Full-size Days | Strategy Switches | Action Switches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${weeklySummary.map((row) => `| ${row.week} | ${row.pnl} | ${row.stopDays} | ${row.reduceDays} | ${row.fullSizeDays} | ${row.strategySwitches} | ${row.actionSwitches} |`).join('\n')}

## Best Routed Weeks

${bestWeeks.map((row) => `- \`${row.week}\` | pnl=\`${row.pnl}\` | stop=\`${row.stopDays}\` | reduce=\`${row.reduceDays}\` | switches=\`${row.strategySwitches + row.actionSwitches}\``).join('\n')}

## Worst Routed Weeks

${worstWeeks.map((row) => `- \`${row.week}\` | pnl=\`${row.pnl}\` | stop=\`${row.stopDays}\` | reduce=\`${row.reduceDays}\` | switches=\`${row.strategySwitches + row.actionSwitches}\``).join('\n')}

${policyCatalogSection}## Best Routed Days

${topPositive.map((row) => `- \`${row.day}\` | risk=\`${row.effectiveRiskMultiplier}\` | strategy=\`${row.selectedStrategyLabel ?? '-'}\` | routedPnL=\`${row.routedPnl}\``).join('\n')}

## Worst Routed Days

${topNegative.map((row) => `- \`${row.day}\` | risk=\`${row.effectiveRiskMultiplier}\` | strategy=\`${row.selectedStrategyLabel ?? '-'}\` | routedPnL=\`${row.routedPnl}\``).join('\n')}
`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const runOptions = args.tradeCreatedAt
    ? {
      validationConfigPath: args.validation,
      routerConfigPath: args.router,
      tradeCreatedAt: args.tradeCreatedAt
    }
    : {
      validationConfigPath: args.validation,
      routerConfigPath: args.router
    };

  const report = await runRouterValidation(runOptions);
  const trainId = loadTrainIdFromValidationConfig(args.validation);
  const reportPayload = trainId
    ? {
        ...report,
        trainId
      }
    : report;

  const outputDir = path.resolve(__dirname, '../../reports/regime-routing-results');
  ensureDir(outputDir);

  const periodLabel = extractPeriodLabel(report);
  const prefix = `${report.symbol}_${report.routerVersion}_${periodLabel}`;
  const jsonPath = path.join(outputDir, `${prefix}.json`);
  const mdPath = path.join(outputDir, `${prefix}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(reportPayload, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdPath, renderMarkdown(report), 'utf8');

  console.log(`Router validation JSON written: ${jsonPath}`);
  console.log(`Router validation report written: ${mdPath}`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
