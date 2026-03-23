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

function renderMarkdown(report: RouterValidationReport): string {
  const { comparison } = report;
  const stopDays = report.dailyRoutes.filter((row) => row.effectiveRiskMultiplier === 0).length;
  const halfOrLessDays = report.dailyRoutes.filter((row) => row.effectiveRiskMultiplier > 0 && row.effectiveRiskMultiplier <= 0.5).length;
  const fullSizeDays = report.dailyRoutes.filter((row) => row.effectiveRiskMultiplier >= 1).length;
  const lossRecheckDays = report.dailyRoutes.filter((row) => row.lossRuleId !== null).length;
  const topPositive = [...report.dailyRoutes]
    .sort((left, right) => right.routedPnl - left.routedPnl)
    .slice(0, 10);
  const topNegative = [...report.dailyRoutes]
    .sort((left, right) => left.routedPnl - right.routedPnl)
    .slice(0, 10);
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
${topDeltaLine(comparison.defaultStrategy.label, comparison.router.totalPnl, comparison.defaultStrategy.totalPnl)}
${topDeltaLine(comparison.rank1Strategy.label, comparison.router.totalPnl, comparison.rank1Strategy.totalPnl)}
${topDeltaLine(comparison.top10EqualWeight.label, comparison.router.totalPnl, comparison.top10EqualWeight.totalPnl)}

## Comparison

| Strategy | Total PnL | Return % | Max DD | Max DD % | Positive Days | Negative Days | Traded Days | Final Equity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Router | ${comparison.router.totalPnl} | ${comparison.router.returnPct} | ${comparison.router.maxDrawdown} | ${comparison.router.maxDrawdownPct} | ${comparison.router.positiveDays} | ${comparison.router.negativeDays} | ${comparison.router.tradedDays} | ${comparison.router.finalEquity} |
| ${comparison.defaultStrategy.label} | ${comparison.defaultStrategy.totalPnl} | ${comparison.defaultStrategy.returnPct} | ${comparison.defaultStrategy.maxDrawdown} | ${comparison.defaultStrategy.maxDrawdownPct} | ${comparison.defaultStrategy.positiveDays} | ${comparison.defaultStrategy.negativeDays} | ${comparison.defaultStrategy.tradedDays} | ${comparison.defaultStrategy.finalEquity} |
| ${comparison.rank1Strategy.label} | ${comparison.rank1Strategy.totalPnl} | ${comparison.rank1Strategy.returnPct} | ${comparison.rank1Strategy.maxDrawdown} | ${comparison.rank1Strategy.maxDrawdownPct} | ${comparison.rank1Strategy.positiveDays} | ${comparison.rank1Strategy.negativeDays} | ${comparison.rank1Strategy.tradedDays} | ${comparison.rank1Strategy.finalEquity} |
| ${comparison.top10EqualWeight.label} | ${comparison.top10EqualWeight.totalPnl} | ${comparison.top10EqualWeight.returnPct} | ${comparison.top10EqualWeight.maxDrawdown} | ${comparison.top10EqualWeight.maxDrawdownPct} | ${comparison.top10EqualWeight.positiveDays} | ${comparison.top10EqualWeight.negativeDays} | ${comparison.top10EqualWeight.tradedDays} | ${comparison.top10EqualWeight.finalEquity} |
| ${comparison.oracleBestOfDay.label} | ${comparison.oracleBestOfDay.totalPnl} | ${comparison.oracleBestOfDay.returnPct} | ${comparison.oracleBestOfDay.maxDrawdown} | ${comparison.oracleBestOfDay.maxDrawdownPct} | ${comparison.oracleBestOfDay.positiveDays} | ${comparison.oracleBestOfDay.negativeDays} | ${comparison.oracleBestOfDay.tradedDays} | ${comparison.oracleBestOfDay.finalEquity} |

## Routing Mix

- Stop days: \`${stopDays}\`
- Half-or-less risk days: \`${halfOrLessDays}\`
- Full-size days: \`${fullSizeDays}\`
- Loss-recheck override days: \`${lossRecheckDays}\`

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

  const outputDir = path.resolve(__dirname, '../../reports/regime-routing-results');
  ensureDir(outputDir);

  const periodLabel = extractPeriodLabel(report);
  const prefix = `${report.symbol}_${report.routerVersion}_${periodLabel}`;
  const jsonPath = path.join(outputDir, `${prefix}.json`);
  const mdPath = path.join(outputDir, `${prefix}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
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
