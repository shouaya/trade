#!/usr/bin/env node

/**
 * Batch weekly rolling runner.
 *
 * Replays weekly decisions sequentially across a date range and carries the
 * selected params from one week into the next as the current production params.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'weekly');

function parseArgs(argv) {
  const parsed = {
    start: '2024-04-05',
    end: '2026-02-20',
    topN: 5,
    initialHold: 10,
    initialAtrsl: 4,
    initialAtrtp: 4,
    skipValidation: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg.startsWith('--start=')) {
      parsed.start = arg.slice('--start='.length);
      continue;
    }
    if (arg === '--start') {
      parsed.start = argv[++i] || parsed.start;
      continue;
    }
    if (arg.startsWith('--end=')) {
      parsed.end = arg.slice('--end='.length);
      continue;
    }
    if (arg === '--end') {
      parsed.end = argv[++i] || parsed.end;
      continue;
    }
    if (arg.startsWith('--top-n=')) {
      parsed.topN = Number(arg.slice('--top-n='.length));
      continue;
    }
    if (arg === '--top-n') {
      parsed.topN = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith('--initial-hold=')) {
      parsed.initialHold = Number(arg.slice('--initial-hold='.length));
      continue;
    }
    if (arg === '--initial-hold') {
      parsed.initialHold = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith('--initial-atrsl=')) {
      parsed.initialAtrsl = Number(arg.slice('--initial-atrsl='.length));
      continue;
    }
    if (arg === '--initial-atrsl') {
      parsed.initialAtrsl = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith('--initial-atrtp=')) {
      parsed.initialAtrtp = Number(arg.slice('--initial-atrtp='.length));
      continue;
    }
    if (arg === '--initial-atrtp') {
      parsed.initialAtrtp = Number(argv[++i]);
      continue;
    }
    if (arg === '--skip-validation') {
      parsed.skipValidation = true;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }

  return parsed;
}

function parseUtcDate(dateStr) {
  const parsed = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid date: ${dateStr}`);
  }
  return parsed;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function buildWeeklyCutoffs(start, end) {
  const dates = [];
  let cur = parseUtcDate(start);
  const last = parseUtcDate(end);

  while (cur <= last) {
    dates.push(toIsoDate(cur));
    cur = addDays(cur, 7);
  }

  return dates;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function runSingleWeek({ cutoff, topN, currentParams, skipValidation }) {
  const args = [
    'scripts/weekly-rolling-run.js',
    `--cutoff=${cutoff}`,
    `--top-n=${topN}`,
    `--current-hold=${currentParams.hold}`,
    `--current-atrsl=${currentParams.atrsl}`,
    `--current-atrtp=${currentParams.atrtp}`
  ];

  if (skipValidation) {
    args.push('--skip-validation');
  }

  execFileSync('node', args, {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });

  return readJson(path.join(REPORT_DIR, `weekly_${cutoff.replace(/-/g, '_')}_decision.json`));
}

function summarize(history, initialParams, finalParams, args) {
  const actionCounts = {};
  let validationCompleted = 0;
  let validationPositive = 0;
  let validationNetReturnSum = 0;

  for (const item of history) {
    actionCounts[item.decision.action] = (actionCounts[item.decision.action] || 0) + 1;
    if (item.validation) {
      validationCompleted += 1;
      validationNetReturnSum += Number(item.validation.netReturnPct || 0);
      if (Number(item.validation.netPnl || 0) > 0) {
        validationPositive += 1;
      }
    }
  }

  return {
    start: args.start,
    end: args.end,
    totalWeeks: history.length,
    initialParams,
    finalParams,
    actionCounts,
    validationCompleted,
    validationPositive,
    validationNegative: validationCompleted - validationPositive,
    validationNetReturnSum: Number(validationNetReturnSum.toFixed(1)),
    validationAverageNetReturn: validationCompleted > 0
      ? Number((validationNetReturnSum / validationCompleted).toFixed(1))
      : 0,
    reports: history.map(item => ({
      runDate: item.runDate,
      action: item.decision.action,
      selectedParams: item.decision.selectedParams,
      validationNetReturnPct: item.validation ? item.validation.netReturnPct : null
    }))
  };
}

function buildMarkdown(summary) {
  const lines = [];
  lines.push('# Weekly Rolling History Summary');
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push(`- Start cutoff: \`${summary.start}\``);
  lines.push(`- End cutoff: \`${summary.end}\``);
  lines.push(`- Total weeks: \`${summary.totalWeeks}\``);
  lines.push('- Initial margin capital: `500 USD`');
  lines.push('- Leverage: `20x`');
  lines.push('- Position basis: `0.1 lot = 10,000 USD notional`');
  lines.push('');
  lines.push('## Action Counts');
  lines.push('');
  for (const [action, count] of Object.entries(summary.actionCounts)) {
    lines.push(`- \`${action}\`: \`${count}\``);
  }
  lines.push('');
  lines.push('## Validation Summary');
  lines.push('');
  lines.push(`- Validation completed: \`${summary.validationCompleted}\``);
  lines.push(`- Positive validation weeks: \`${summary.validationPositive}\``);
  lines.push(`- Negative validation weeks: \`${summary.validationNegative}\``);
  lines.push(`- Total validation net return: \`${summary.validationNetReturnSum}%\``);
  lines.push(`- Average validation net return: \`${summary.validationAverageNetReturn}%\``);
  lines.push('');
  lines.push('## Params');
  lines.push('');
  lines.push(`- Initial params: \`H${summary.initialParams.hold} + ATRSL${summary.initialParams.atrsl} + ATRTP${summary.initialParams.atrtp}\``);
  lines.push(`- Final params: \`H${summary.finalParams.hold} + ATRSL${summary.finalParams.atrsl} + ATRTP${summary.finalParams.atrtp}\``);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const initialParams = {
    hold: args.initialHold,
    atrsl: args.initialAtrsl,
    atrtp: args.initialAtrtp
  };
  let currentParams = { ...initialParams };
  const cutoffs = buildWeeklyCutoffs(args.start, args.end);
  const history = [];

  console.log(`[weekly-history] total cutoffs: ${cutoffs.length}`);
  console.log(`[weekly-history] range: ${args.start} -> ${args.end}`);

  for (const cutoff of cutoffs) {
    console.log(`\n[weekly-history] running ${cutoff} with H${currentParams.hold} ATRSL${currentParams.atrsl} ATRTP${currentParams.atrtp}`);
    const report = runSingleWeek({
      cutoff,
      topN: args.topN,
      currentParams,
      skipValidation: args.skipValidation
    });
    history.push(report);
    currentParams = { ...report.decision.selectedParams };
  }

  const summary = summarize(history, initialParams, currentParams, args);
  writeJson(path.join(REPORT_DIR, `weekly_history_${args.start.replace(/-/g, '_')}_${args.end.replace(/-/g, '_')}.json`), summary);
  fs.writeFileSync(
    path.join(REPORT_DIR, `weekly_history_${args.start.replace(/-/g, '_')}_${args.end.replace(/-/g, '_')}.md`),
    buildMarkdown(summary),
    'utf8'
  );

  console.log('\n[weekly-history] completed');
  console.log(`[weekly-history] final params: H${currentParams.hold} + ATRSL${currentParams.atrsl} + ATRTP${currentParams.atrtp}`);
}

main();
