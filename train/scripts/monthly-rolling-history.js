#!/usr/bin/env node

/**
 * Batch monthly rolling runner for ETHJPY.
 *
 * Runs each execution month independently:
 * - train on previous 12 months
 * - validate on execution month
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'monthly');

function parseArgs(argv) {
  const parsed = {
    start: '2025-01',
    end: '2026-02',
    topN: 10,
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
    if (arg === '--skip-validation') {
      parsed.skipValidation = true;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }

  return parsed;
}

function parseMonth(monthStr) {
  const date = new Date(`${monthStr}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid month: ${monthStr}`);
  }
  return date;
}

function formatMonth(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

function buildMonthRange(start, end) {
  const months = [];
  let current = parseMonth(start);
  const last = parseMonth(end);

  while (current <= last) {
    months.push(formatMonth(current));
    current = addMonths(current, 1);
  }

  return months;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildMarkdown(summary) {
  const lines = [];
  lines.push('# ETHJPY Monthly Rolling History Summary');
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push(`- Start month: \`${summary.start}\``);
  lines.push(`- End month: \`${summary.end}\``);
  lines.push(`- Total months: \`${summary.totalMonths}\``);
  lines.push('');
  lines.push('## Results');
  lines.push('');
  for (const item of summary.reports) {
    lines.push(`- \`${item.runMonth}\`: train=\`H${item.trainingWinner.hold} ATRSL${item.trainingWinner.atrsl} ATRTP${item.trainingWinner.atrtp}\`, validate pnl=\`${item.validationPnl}\`, validate return=\`${item.validationReturnPct}%\``);
  }
  lines.push('');
  lines.push('## Aggregate');
  lines.push('');
  lines.push(`- Positive validation months: \`${summary.positiveMonths}\``);
  lines.push(`- Negative validation months: \`${summary.negativeMonths}\``);
  lines.push(`- Total validation pnl: \`${summary.totalValidationPnl}\``);
  lines.push(`- Average validation return: \`${summary.avgValidationReturnPct}%\``);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const months = buildMonthRange(args.start, args.end);
  const reports = [];

  console.log(`[monthly-history] total months: ${months.length}`);
  console.log(`[monthly-history] range: ${args.start} -> ${args.end}`);

  for (const month of months) {
    const runArgs = ['scripts/monthly-rolling-run.js', `--month=${month}`, `--top-n=${args.topN}`];
    if (args.skipValidation) {
      runArgs.push('--skip-validation');
    }

    console.log(`\n[monthly-history] running ${month}`);
    execFileSync('node', runArgs, {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });

    const runKey = month.replace('-', '_');
    reports.push(readJson(path.join(REPORT_DIR, `ethjpy_${runKey}_rolling.json`)));
  }

  const totalValidationPnl = reports.reduce((sum, item) => sum + Number(item.validationResult?.totalPnl || 0), 0);
  const totalValidationReturn = reports.reduce((sum, item) => sum + Number(item.validationResult?.returnPct || 0), 0);
  const positiveMonths = reports.filter(item => Number(item.validationResult?.totalPnl || 0) > 0).length;
  const negativeMonths = reports.filter(item => Number(item.validationResult?.totalPnl || 0) < 0).length;

  const summary = {
    start: args.start,
    end: args.end,
    totalMonths: reports.length,
    positiveMonths,
    negativeMonths,
    totalValidationPnl: Number(totalValidationPnl.toFixed(2)),
    avgValidationReturnPct: reports.length > 0 ? Number((totalValidationReturn / reports.length).toFixed(4)) : 0,
    reports: reports.map(item => ({
      runMonth: item.runMonth,
      trainingWinner: {
        hold: item.trainingWinner.hold,
        atrsl: item.trainingWinner.atrsl,
        atrtp: item.trainingWinner.atrtp
      },
      validationPnl: Number(item.validationResult?.totalPnl || 0),
      validationReturnPct: Number(item.validationResult?.returnPct || 0)
    }))
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, `ethjpy_monthly_history_${args.start.replace('-', '_')}_${args.end.replace('-', '_')}.json`);
  const mdPath = path.join(REPORT_DIR, `ethjpy_monthly_history_${args.start.replace('-', '_')}_${args.end.replace('-', '_')}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, buildMarkdown(summary), 'utf8');

  console.log('\n[monthly-history] completed');
  console.log(`[monthly-history] positive months: ${positiveMonths}`);
  console.log(`[monthly-history] negative months: ${negativeMonths}`);
  console.log(`[monthly-history] report json: ${path.relative(ROOT_DIR, jsonPath)}`);
  console.log(`[monthly-history] report md: ${path.relative(ROOT_DIR, mdPath)}`);
}

main();
