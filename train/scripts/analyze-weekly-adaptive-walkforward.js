#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { loadEnvFiles } = require('@money/database');
const {
  ROOT_DIR,
  round,
  parseMonth,
  startOfUtcMonth,
  endOfUtcMonth,
  buildTimeRange,
  getIsoWeekInfoFromUtcMs,
  enumerateWeeksFromMonths,
  runTrainConfig,
  connect,
  findLatestRunId,
  loadResultRows,
  loadKlines,
  findLatestKlineOpenTime,
  computePeriodFeatures,
  buildWeeklyCombos,
  buildPolicyMap,
  buildFinalStrategyPool,
  buildValidationRows,
  summarizeValidation
} = require('./lib/weekly-feature-combo-common');

loadEnvFiles(dotenv, [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../backend/.env'),
  path.resolve(__dirname, '../../.env')
]);

const GENERATED_DIR = path.join(ROOT_DIR, 'configs', 'generated', 'weekly-adaptive');
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'weekly-adaptive');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const eqIndex = arg.indexOf('=');
    if (eqIndex !== -1) {
      args[arg.slice(0, eqIndex).replace(/^--/, '')] = arg.slice(eqIndex + 1);
      continue;
    }
    if (arg.startsWith('--') && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[arg.replace(/^--/, '')] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function required(args, key) {
  const value = args[key];
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function buildWeekTrainingConfig(template, weekInfo, resultGroup) {
  return {
    ...template,
    name: `${template.name}_${weekInfo.label}`,
    description: `${template.description} | weekly adaptive train ${weekInfo.key}`,
    timeRange: buildTimeRange(weekInfo.startUtc, weekInfo.endUtc),
    database: {
      tableName: resultGroup,
      resetTableBeforeRun: true
    },
    regimeRouting: undefined,
    output: {
      ...(template.output ?? {}),
      topN: Number(template.output?.topN ?? 10)
    }
  };
}

function summarizeByYear(rows) {
  const yearMap = new Map();
  for (const row of rows) {
    const year = row.week.slice(0, 4);
    let group = yearMap.get(year);
    if (!group) {
      group = [];
      yearMap.set(year, group);
    }
    group.push(row);
  }

  return Array.from(yearMap.entries())
    .map(([year, group]) => ({
      year,
      ...summarizeValidation(group)
    }))
    .sort((left, right) => left.year.localeCompare(right.year));
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# ${report.symbol} Weekly Adaptive Walk-Forward`);
  lines.push('');
  lines.push(`- Template config: \`${report.templateConfig}\``);
  lines.push(`- Bootstrap: \`${report.bootstrap.startMonth}\` -> \`${report.bootstrap.endMonth}\``);
  lines.push(`- Forward: \`${report.forward.startMonth}\` -> \`${report.forward.endMonth}\``);
  lines.push(`- Bootstrap weeks: \`${report.bootstrap.weeks.length}\``);
  lines.push(`- Forward weeks: \`${report.forward.weeks.length}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total PnL: \`${report.forward.summary.totalPnl}\``);
  lines.push(`- Positive weeks: \`${report.forward.summary.positiveWeeks}\``);
  lines.push(`- Negative weeks: \`${report.forward.summary.negativeWeeks}\``);
  lines.push(`- Max drawdown: \`${report.forward.summary.maxDrawdown}\``);
  lines.push(`- Exact matches: \`${report.forward.matchStats.exact}\``);
  lines.push(`- Nearest matches: \`${report.forward.matchStats.nearest}\``);
  lines.push('');
  lines.push('## Yearly Summary');
  lines.push('');
  lines.push('| Year | Weeks | Total PnL | Positive | Negative | Max Drawdown |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const row of report.forward.yearlySummary) {
    lines.push(`| ${row.year} | ${row.weeks} | ${row.totalPnl} | ${row.positiveWeeks} | ${row.negativeWeeks} | ${row.maxDrawdown} |`);
  }
  lines.push('');
  lines.push('## Forward Decisions');
  lines.push('');
  lines.push('| Week | Match | Feature Key | Matched Policy | Selected Combo | Week PnL | Policy Size Before | Pool Size Before |');
  lines.push('| --- | --- | --- | --- | --- | ---: | ---: | ---: |');
  for (const row of report.forward.weeks) {
    lines.push(`| ${row.week} | ${row.matchSource} | ${row.featureKey} | ${row.matchedFeatureKey ?? '-'} | ${row.comboLabel ?? '-'} | ${row.comboPnl} | ${row.policySizeBefore} | ${row.strategyPoolSizeBefore} |`);
  }
  lines.push('');
  lines.push('## Final Policy');
  lines.push('');
  lines.push(`- Final feature keys: \`${report.final.policyMap.length}\``);
  lines.push(`- Final strategy pool size: \`${report.final.strategyPool.length}\``);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const templatePath = path.resolve(required(args, 'template'));
  const symbol = required(args, 'symbol').toUpperCase();
  const bootstrapStartMonth = required(args, 'bootstrapStartMonth');
  const bootstrapEndMonth = required(args, 'bootstrapEndMonth');
  const forwardStartMonth = required(args, 'forwardStartMonth');
  const forwardEndMonth = required(args, 'forwardEndMonth');
  const candidateLimit = Number(args.candidateLimit || '12');
  const comboSize = Number(args.comboSize || '3');
  const comboTopK = Number(args.comboTopK || '5');
  const weights = {
    pnl: Number(args.pnlWeight || '0.60'),
    returnPct: Number(args.returnWeight || '0.20'),
    profitFactor: Number(args.profitFactorWeight || '0.10'),
    winRate: Number(args.winRateWeight || '0.05'),
    robustness: Number(args.robustnessWeight || '0.05')
  };

  const template = loadJson(templatePath);
  ensureDir(GENERATED_DIR);
  ensureDir(REPORT_DIR);

  const bootstrapEndUtcMs = endOfUtcMonth(parseMonth(bootstrapEndMonth)).getTime();
  const forwardStartUtcMs = startOfUtcMonth(parseMonth(forwardStartMonth)).getTime();
  if (forwardStartUtcMs <= bootstrapEndUtcMs) {
    throw new Error('forwardStartMonth must be after bootstrapEndMonth');
  }

  const connection = await connect();
  try {
    const latestKlineOpenTime = await findLatestKlineOpenTime(connection, symbol);
    if (!latestKlineOpenTime) {
      throw new Error(`no klines found for symbol=${symbol}`);
    }

    const latestAvailableWeek = getIsoWeekInfoFromUtcMs(latestKlineOpenTime);
    const allWeeks = enumerateWeeksFromMonths(bootstrapStartMonth, forwardEndMonth)
      .filter((weekInfo) => weekInfo.startUtc.getTime() <= latestKlineOpenTime);

    if (!allWeeks.length) {
      throw new Error(`no eligible weeks found for symbol=${symbol}`);
    }

    const trainingWeeks = [];
    const forwardRows = [];

    for (const weekInfo of allWeeks) {
      const resultGroup = `${symbol.toLowerCase()}_weekly_adaptive_${weekInfo.label.toLowerCase()}`;
      const config = buildWeekTrainingConfig(template, weekInfo, resultGroup);
      const configPath = path.join(GENERATED_DIR, `${symbol.toLowerCase()}_${weekInfo.label.toLowerCase()}_adaptive_train.json`);
      writeJson(configPath, config);

      console.log(`\n[weekly-adaptive] training ${weekInfo.key} ...`);
      runTrainConfig(path.relative(ROOT_DIR, configPath));

      const runId = await findLatestRunId(connection, resultGroup);
      if (!runId) {
        throw new Error(`no run_id for result_group=${resultGroup}`);
      }

      const range = buildTimeRange(weekInfo.startUtc, weekInfo.endUtc);
      const [allResults, klines] = await Promise.all([
        loadResultRows(connection, resultGroup, runId, 500),
        loadKlines(connection, symbol, range)
      ]);

      const feature = computePeriodFeatures(klines, weekInfo.key);
      if (!feature) {
        continue;
      }
      if (allResults.length < comboSize) {
        throw new Error(`week ${weekInfo.key} result count ${allResults.length} < comboSize ${comboSize}`);
      }

      const candidates = allResults.slice(0, candidateLimit);
      const topCombos = buildWeeklyCombos(candidates, comboSize, comboTopK, weights);
      const weekTrainingRecord = {
        week: weekInfo.key,
        weekStartTimeMs: weekInfo.startUtc.getTime(),
        resultGroup,
        runId,
        ...feature,
        candidates,
        topCombos,
        bestCombo: topCombos[0] ?? null
      };

      if (weekInfo.startUtc.getTime() >= forwardStartUtcMs) {
        const policyMapBefore = buildPolicyMap(trainingWeeks);
        const strategyPoolBefore = buildFinalStrategyPool(policyMapBefore);
        const strategyPnlMap = new Map(allResults.map((row) => [row.strategyName, row.totalPnl]));
        const decision = buildValidationRows([feature], policyMapBefore, new Map([[weekInfo.key, strategyPnlMap]]))[0];
        if (!decision) {
          throw new Error(`failed to build forward decision for ${weekInfo.key}`);
        }

        forwardRows.push({
          ...decision,
          policySizeBefore: policyMapBefore.length,
          strategyPoolSizeBefore: strategyPoolBefore.length,
          candidateCount: candidates.length
        });
      }

      trainingWeeks.push(weekTrainingRecord);
    }

    const bootstrapWeeks = trainingWeeks.filter((week) => week.weekStartTimeMs <= bootstrapEndUtcMs);
    const finalPolicyMap = buildPolicyMap(trainingWeeks);
    const finalStrategyPool = buildFinalStrategyPool(finalPolicyMap);
    const summary = summarizeValidation(forwardRows);
    const yearlySummary = summarizeByYear(forwardRows);
    const matchStats = {
      exact: forwardRows.filter((row) => row.matchSource === 'exact').length,
      nearest: forwardRows.filter((row) => row.matchSource === 'nearest').length,
      none: forwardRows.filter((row) => row.matchSource === 'none').length
    };

    const strategyPoolSnapshot = {
      symbol,
      generatedAt: new Date().toISOString(),
      source: {
        templateConfig: path.relative(ROOT_DIR, templatePath),
        bootstrapStartMonth,
        bootstrapEndMonth,
        forwardStartMonth,
        forwardEndMonth,
        latestKlineOpenTime,
        latestAvailableWeek: latestAvailableWeek.key,
        candidateLimit,
        comboSize,
        comboTopK
      },
      strategies: finalStrategyPool.map((strategy) => ({
        strategyName: strategy.strategyName,
        strategyType: strategy.strategyType,
        shortLabel: strategy.shortLabel,
        parameters: strategy.parameters
      }))
    };
    const strategyPoolPath = path.join(
      GENERATED_DIR,
      `${symbol.toLowerCase()}_${bootstrapStartMonth.replace('-', '_')}_${forwardEndMonth.replace('-', '_')}_adaptive_strategy_pool.json`
    );
    writeJson(strategyPoolPath, strategyPoolSnapshot);

    const report = {
      symbol,
      generatedAt: new Date().toISOString(),
      templateConfig: path.relative(ROOT_DIR, templatePath),
      latestKlineOpenTime,
      latestAvailableWeek: latestAvailableWeek.key,
      options: {
        candidateLimit,
        comboSize,
        comboTopK,
        weights
      },
      bootstrap: {
        startMonth: bootstrapStartMonth,
        endMonth: bootstrapEndMonth,
        weeks: bootstrapWeeks
      },
      forward: {
        startMonth: forwardStartMonth,
        endMonth: forwardEndMonth,
        weeks: forwardRows,
        summary,
        yearlySummary,
        matchStats
      },
      final: {
        policyMap: finalPolicyMap,
        strategyPool: finalStrategyPool
      },
      generated: {
        strategyPoolSnapshot: path.relative(ROOT_DIR, strategyPoolPath)
      }
    };

    const prefix = `${symbol}_${bootstrapStartMonth.replace('-', '_')}_${forwardEndMonth.replace('-', '_')}_weekly_adaptive_walkforward`;
    const jsonPath = path.join(REPORT_DIR, `${prefix}.json`);
    const mdPath = path.join(REPORT_DIR, `${prefix}.md`);
    writeJson(jsonPath, report);
    fs.writeFileSync(mdPath, buildMarkdown(report), 'utf8');

    console.log(`\n[weekly-adaptive] JSON written: ${jsonPath}`);
    console.log(`[weekly-adaptive] MD written: ${mdPath}`);
    console.log(`[weekly-adaptive] strategy pool written: ${strategyPoolPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[weekly-adaptive] failed: ${error.stack || error.message}`);
  process.exit(1);
});
