#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ROUTER_PATH = path.join(ROOT, 'configs', 'generated', 'regime-routing', 'BTCJPY_dual_year_router_v10_weekly_refined.json');
const TRAIN_REPORT_PATH = path.join(ROOT, 'reports', 'regime-routing-results', 'BTCJPY_dual_year_v10_weekly_refined_2024-01-01_to_2025-12-31.json');
const VALIDATE_REPORT_PATH = path.join(ROOT, 'reports', 'regime-routing-results', 'BTCJPY_dual_year_v10_weekly_refined_2026-01-01_to_2026-03-31.json');
const OUTPUT_JSON_PATH = path.join(ROOT, 'reports', 'regime-routing-results', 'BTCJPY_dual_year_v10_daily_policy_summary.json');
const OUTPUT_MD_PATH = path.join(ROOT, 'reports', 'regime-routing-results', 'BTCJPY_dual_year_v10_daily_policy_summary.md');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function writeJson(filePath, data) {
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function round(value, digits = 2) {
  return Number(Number(value ?? 0).toFixed(digits));
}

function summarizeRows(rows) {
  if (!rows.length) {
    return {
      hits: 0,
      totalPnl: 0,
      avgPnl: 0,
      winDays: 0,
      lossDays: 0,
      flatDays: 0,
      totalOraclePnl: 0,
      capturePct: 0,
      bestDay: null,
      worstDay: null
    };
  }

  const totalPnl = round(rows.reduce((sum, row) => sum + (row.routedPnl ?? 0), 0));
  const totalOraclePnl = round(rows.reduce((sum, row) => sum + (row.oracleBestOfDayPnl ?? 0), 0));
  const sorted = [...rows].sort((left, right) => left.routedPnl - right.routedPnl);
  const winDays = rows.filter((row) => row.routedPnl > 0).length;
  const lossDays = rows.filter((row) => row.routedPnl < 0).length;
  const flatDays = rows.length - winDays - lossDays;

  return {
    hits: rows.length,
    totalPnl,
    avgPnl: round(totalPnl / rows.length),
    winDays,
    lossDays,
    flatDays,
    totalOraclePnl,
    capturePct: totalOraclePnl !== 0 ? round((totalPnl / totalOraclePnl) * 100, 2) : 0,
    bestDay: sorted[sorted.length - 1]
      ? {
        day: sorted[sorted.length - 1].day,
        pnl: round(sorted[sorted.length - 1].routedPnl),
        oraclePnl: round(sorted[sorted.length - 1].oracleBestOfDayPnl),
        featureBucket: sorted[sorted.length - 1].featureBucket
      }
      : null,
    worstDay: sorted[0]
      ? {
        day: sorted[0].day,
        pnl: round(sorted[0].routedPnl),
        oraclePnl: round(sorted[0].oracleBestOfDayPnl),
        featureBucket: sorted[0].featureBucket
      }
      : null
  };
}

function buildRuleReport(rule, report, routeField) {
  const matchedRows = report.dailyRoutes.filter((row) => row[routeField] === rule.id);
  return summarizeRows(matchedRows);
}

function buildCatalogSummary(router, trainReport, validateReport) {
  const strategyCatalog = router.strategyCatalog ?? {};
  const dailyRules = router.rules
    .filter((rule) => ['daily_router', 'loss_recheck'].includes(rule.layer))
    .sort((left, right) => left.priority - right.priority);

  return dailyRules.map((rule) => {
    const routeField = rule.layer === 'loss_recheck' ? 'lossRuleId' : 'dayRuleId';
    const strategy = strategyCatalog[rule.action.strategyKey] ?? null;

    return {
      ruleId: rule.id,
      layer: rule.layer,
      priority: rule.priority,
      actionType: rule.action.type,
      featureSummary: rule.when,
      rationale: rule.rationale ?? null,
      strategy: strategy
        ? {
          strategyKey: rule.action.strategyKey,
          strategyLabel: strategy.shortLabel,
          strategyName: strategy.strategyName
        }
        : null,
      train: buildRuleReport(rule, trainReport, routeField),
      validate2026: buildRuleReport(rule, validateReport, routeField)
    };
  });
}

function buildUncoveredNegativeDays(report) {
  return report.dailyRoutes
    .filter((row) => row.routedPnl < 0)
    .sort((left, right) => left.routedPnl - right.routedPnl)
    .map((row) => ({
      day: row.day,
      week: row.week,
      featureBucket: row.featureBucket,
      weekRuleId: row.weekRuleId,
      dayRuleId: row.dayRuleId,
      selectedStrategyKey: row.selectedStrategyKey,
      risk: row.effectiveRiskMultiplier,
      pnl: round(row.routedPnl),
      oraclePnl: round(row.oracleBestOfDayPnl),
      realizedVolPct: row.realizedVolPct,
      absReturnPct: round(Math.abs(row.dayReturnPct)),
      avgRangePct: row.avgRangePct,
      upMinuteRatio: row.upMinuteRatio
    }));
}

function renderMd(summary) {
  const lines = [];
  lines.push(`# ${summary.symbol} Daily Policy Summary`);
  lines.push('');
  lines.push(`- Router version: \`${summary.routerVersion}\``);
  lines.push(`- Generated date: \`${summary.generatedDate}\``);
  lines.push(`- Train total PnL: \`${summary.trainRouter.totalPnl}\``);
  lines.push(`- Validate 2026 total PnL: \`${summary.validateRouter.totalPnl}\``);
  lines.push(`- Validate 2026 max drawdown: \`${summary.validateRouter.maxDrawdown}\``);
  lines.push('');
  lines.push('## Daily Rule Table');
  lines.push('');
  lines.push('| Rule | Layer | Action | Strategy | Train Hits | Train PnL | 2026 Hits | 2026 PnL | 2026 Capture % |');
  lines.push('| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |');

  for (const entry of summary.dailyRules) {
    const action = entry.actionType === 'stop'
      ? 'stop'
      : `${entry.actionType}`;
    lines.push(`| ${entry.ruleId} | ${entry.layer} | ${action} | ${entry.strategy?.strategyLabel ?? '-'} | ${entry.train.hits} | ${entry.train.totalPnl} | ${entry.validate2026.hits} | ${entry.validate2026.totalPnl} | ${entry.validate2026.capturePct} |`);
  }

  lines.push('');
  lines.push('## 2026 Remaining Negative Days');
  lines.push('');
  lines.push('| Day | Week | Feature | Week Rule | Day Rule | Strategy | Risk | PnL | Oracle |');
  lines.push('| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |');
  for (const row of summary.remainingNegativeDays2026) {
    lines.push(`| ${row.day} | ${row.week} | ${row.featureBucket} | ${row.weekRuleId ?? '-'} | ${row.dayRuleId ?? '-'} | ${row.selectedStrategyKey ?? '-'} | ${row.risk} | ${row.pnl} | ${row.oraclePnl} |`);
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const router = loadJson(ROUTER_PATH);
  const trainReport = loadJson(TRAIN_REPORT_PATH);
  const validateReport = loadJson(VALIDATE_REPORT_PATH);

  const summary = {
    symbol: router.symbol,
    routerVersion: router.routerVersion,
    generatedDate: new Date().toISOString().slice(0, 10),
    routerPath: ROUTER_PATH,
    trainReportPath: TRAIN_REPORT_PATH,
    validateReportPath: VALIDATE_REPORT_PATH,
    trainRouter: trainReport.comparison.router,
    validateRouter: validateReport.comparison.router,
    dailyRules: buildCatalogSummary(router, trainReport, validateReport),
    remainingNegativeDays2026: buildUncoveredNegativeDays(validateReport)
  };

  writeJson(OUTPUT_JSON_PATH, summary);
  writeText(OUTPUT_MD_PATH, renderMd(summary));

  console.log(`Daily policy summary JSON written: ${OUTPUT_JSON_PATH}`);
  console.log(`Daily policy summary MD written: ${OUTPUT_MD_PATH}`);
}

main();
