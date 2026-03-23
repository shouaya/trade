#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import type * as mysql from 'mysql2/promise';
import db from '../configs/database';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEFAULT_INITIAL_CAPITAL = 20_000;
const DEFAULT_LEVERAGE = 2;
const DEFAULT_COMMISSION_RATE = 0.00002;

type PeriodKind = 'day' | 'week' | 'month';

interface CliArgs {
  readonly validation: string;
  readonly strategyName?: string;
  readonly initialCapital: number;
  readonly leverage: number;
  readonly commissionRate: number;
  readonly outputDir?: string;
}

interface ValidationConfig {
  readonly name: string;
  readonly timeRange: {
    readonly startTimeMs: number;
    readonly endTimeMs: number;
  };
  readonly market: {
    readonly symbol: string;
  };
  readonly strategy: {
    readonly explicitStrategies: readonly {
      readonly name: string;
    }[];
  };
}

interface TradeRow extends mysql.RowDataPacket {
  readonly id: number;
  readonly direction: 'long' | 'short';
  readonly entry_time: number | string;
  readonly entry_price: number | string;
  readonly exit_time: number | string;
  readonly exit_price: number | string;
  readonly percent: number | string | null;
  readonly exit_reason: string | null;
}

interface PeriodRow {
  readonly period: string;
  readonly startEquity: number;
  readonly endEquity: number;
  readonly pnl: number;
  readonly returnPct: number;
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
}

interface Summary {
  readonly validationName: string;
  readonly symbol: string;
  readonly strategyName: string;
  readonly tradeBatch: string;
  readonly initialCapital: number;
  readonly leverage: number;
  readonly commissionRate: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number;
  readonly finalEquity: number;
  readonly totalPnl: number;
  readonly totalReturnPct: number;
  readonly maxDrawdown: number;
  readonly maxDrawdownPct: number;
  readonly bestDay: PeriodRow | null;
  readonly worstDay: PeriodRow | null;
  readonly bestWeek: PeriodRow | null;
  readonly worstWeek: PeriodRow | null;
  readonly bestMonth: PeriodRow | null;
  readonly worstMonth: PeriodRow | null;
}

interface CompoundReport {
  readonly summary: Summary;
  readonly daily: readonly PeriodRow[];
  readonly weekly: readonly PeriodRow[];
  readonly monthly: readonly PeriodRow[];
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args = argv.slice(2);
  let validation = '';
  let strategyName: string | undefined;
  let initialCapital = DEFAULT_INITIAL_CAPITAL;
  let leverage = DEFAULT_LEVERAGE;
  let commissionRate = DEFAULT_COMMISSION_RATE;
  let outputDir: string | undefined;

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
    if (arg.startsWith('--strategy=')) {
      strategyName = arg.slice('--strategy='.length);
      continue;
    }
    if (arg === '--strategy') {
      strategyName = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--initialCapital=')) {
      initialCapital = Number(arg.slice('--initialCapital='.length));
      continue;
    }
    if (arg === '--initialCapital') {
      initialCapital = Number(args[index + 1] ?? DEFAULT_INITIAL_CAPITAL);
      index += 1;
      continue;
    }
    if (arg.startsWith('--leverage=')) {
      leverage = Number(arg.slice('--leverage='.length));
      continue;
    }
    if (arg === '--leverage') {
      leverage = Number(args[index + 1] ?? DEFAULT_LEVERAGE);
      index += 1;
      continue;
    }
    if (arg.startsWith('--commissionRate=')) {
      commissionRate = Number(arg.slice('--commissionRate='.length));
      continue;
    }
    if (arg === '--commissionRate') {
      commissionRate = Number(args[index + 1] ?? DEFAULT_COMMISSION_RATE);
      index += 1;
      continue;
    }
    if (arg.startsWith('--outputDir=')) {
      outputDir = arg.slice('--outputDir='.length);
      continue;
    }
    if (arg === '--outputDir') {
      outputDir = args[index + 1] ?? '';
      index += 1;
    }
  }

  if (!validation) {
    throw new Error('missing --validation');
  }
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
    throw new Error('initialCapital must be > 0');
  }
  if (!Number.isFinite(leverage) || leverage <= 0) {
    throw new Error('leverage must be > 0');
  }
  if (!Number.isFinite(commissionRate) || commissionRate < 0) {
    throw new Error('commissionRate must be >= 0');
  }

  const parsed: CliArgs = {
    validation,
    initialCapital,
    leverage,
    commissionRate
  };

  if (strategyName) {
    return {
      ...parsed,
      strategyName,
      ...(outputDir ? { outputDir } : {})
    };
  }

  if (outputDir) {
    return {
      ...parsed,
      outputDir
    };
  }

  return parsed;
}

function resolveConfigPath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(__dirname, '..', '..', filePath);
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function getJstDate(timestampMs: number): Date {
  return new Date(timestampMs + JST_OFFSET_MS);
}

function getDayKey(timestampMs: number): string {
  const date = getJstDate(timestampMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function getMonthKey(timestampMs: number): string {
  const date = getJstDate(timestampMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getWeekKey(timestampMs: number): string {
  const date = getJstDate(timestampMs);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function buildCsv(rows: readonly PeriodRow[]): string {
  const header = 'period,start_equity,end_equity,pnl,return_pct,trades,wins,losses,win_rate,start_time_ms,end_time_ms';
  const lines = rows.map((row) => [
    row.period,
    row.startEquity,
    row.endEquity,
    row.pnl,
    row.returnPct,
    row.trades,
    row.wins,
    row.losses,
    row.winRate,
    row.startTimeMs,
    row.endTimeMs
  ].join(','));
  return [header, ...lines].join('\n') + '\n';
}

function formatPeriodTable(rows: readonly PeriodRow[]): string {
  if (rows.length === 0) {
    return '_No data_\n';
  }

  const header = '| Period | Start Equity | End Equity | PnL | Return % | Trades | Win Rate |';
  const divider = '| --- | ---: | ---: | ---: | ---: | ---: | ---: |';
  const lines = rows.map((row) => {
    return `| ${row.period} | ${row.startEquity.toFixed(2)} | ${row.endEquity.toFixed(2)} | ${row.pnl.toFixed(2)} | ${row.returnPct.toFixed(2)} | ${row.trades} | ${row.winRate.toFixed(2)}% |`;
  });
  return [header, divider, ...lines].join('\n') + '\n';
}

function renderMarkdown(report: CompoundReport, dailyCsvPath: string, weeklyCsvPath: string, monthlyCsvPath: string): string {
  const { summary } = report;
  const bestDay = summary.bestDay ? `- Best day: \`${summary.bestDay.period}\` / \`${summary.bestDay.pnl}\`` : '- Best day: `n/a`';
  const worstDay = summary.worstDay ? `- Worst day: \`${summary.worstDay.period}\` / \`${summary.worstDay.pnl}\`` : '- Worst day: `n/a`';
  const bestWeek = summary.bestWeek ? `- Best week: \`${summary.bestWeek.period}\` / \`${summary.bestWeek.pnl}\`` : '- Best week: `n/a`';
  const worstWeek = summary.worstWeek ? `- Worst week: \`${summary.worstWeek.period}\` / \`${summary.worstWeek.pnl}\`` : '- Worst week: `n/a`';
  const bestMonth = summary.bestMonth ? `- Best month: \`${summary.bestMonth.period}\` / \`${summary.bestMonth.pnl}\`` : '- Best month: `n/a`';
  const worstMonth = summary.worstMonth ? `- Worst month: \`${summary.worstMonth.period}\` / \`${summary.worstMonth.pnl}\`` : '- Worst month: `n/a`';

  const dailyLabel = path.basename(dailyCsvPath);
  const weeklyLabel = path.basename(weeklyCsvPath);
  const monthlyLabel = path.basename(monthlyCsvPath);

  return `# ${summary.symbol} Single Strategy Compound Report

- Validation: \`${summary.validationName}\`
- Strategy: \`${summary.strategyName}\`
- Trade batch: \`${summary.tradeBatch}\`
- Period: \`${summary.periodStart}\` -> \`${summary.periodEnd}\`
- Initial capital: \`${summary.initialCapital}\`
- Leverage: \`${summary.leverage}x\`
- Commission rate: \`${summary.commissionRate}\`

## Summary

- Final equity: \`${summary.finalEquity}\`
- Total PnL: \`${summary.totalPnl}\`
- Total return: \`${summary.totalReturnPct}%\`
- Max drawdown: \`${summary.maxDrawdown}\` / \`${summary.maxDrawdownPct}%\`
- Trades: \`${summary.totalTrades}\`
- Win rate: \`${summary.winRate}%\`
${bestDay}
${worstDay}
${bestWeek}
${worstWeek}
${bestMonth}
${worstMonth}

## Monthly

${formatPeriodTable(report.monthly)}

## Best Weeks

${formatPeriodTable([...report.weekly].sort((left, right) => right.pnl - left.pnl).slice(0, 10))}

## Worst Weeks

${formatPeriodTable([...report.weekly].sort((left, right) => left.pnl - right.pnl).slice(0, 10))}

## Best Days

${formatPeriodTable([...report.daily].sort((left, right) => right.pnl - left.pnl).slice(0, 10))}

## Worst Days

${formatPeriodTable([...report.daily].sort((left, right) => left.pnl - right.pnl).slice(0, 10))}

## Data Files

- Daily CSV: \`${dailyLabel}\`
- Weekly CSV: \`${weeklyLabel}\`
- Monthly CSV: \`${monthlyLabel}\`
`;
}

function pickStrategyName(config: ValidationConfig, requestedName?: string): string {
  if (requestedName) {
    return requestedName;
  }

  const strategies = config.strategy.explicitStrategies;
  if (strategies.length !== 1) {
    throw new Error('validation config contains multiple strategies, please pass --strategy');
  }
  const strategy = strategies[0];
  if (!strategy) {
    throw new Error('validation config has no explicit strategies');
  }
  return strategy.name;
}

async function findTradeBatch(
  strategyName: string,
  symbol: string,
  startTimeMs: number,
  endTimeMs: number
): Promise<string> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i:%s') AS created_at
     FROM trades
     WHERE strategy_name = ?
       AND symbol = ?
       AND exit_time BETWEEN ? AND ?`,
    [strategyName, symbol, startTimeMs, endTimeMs]
  );

  const createdAt = rows[0]?.['created_at'];
  if (!createdAt) {
    throw new Error('could not detect trade batch');
  }
  return String(createdAt);
}

async function loadTrades(
  createdAt: string,
  strategyName: string,
  symbol: string,
  startTimeMs: number,
  endTimeMs: number
): Promise<readonly TradeRow[]> {
  const [rows] = await db.query<TradeRow[]>(
    `SELECT id, direction, entry_time, entry_price, exit_time, exit_price, percent, exit_reason
     FROM trades
     WHERE created_at = ?
       AND strategy_name = ?
       AND symbol = ?
       AND exit_time BETWEEN ? AND ?
     ORDER BY exit_time ASC, id ASC`,
    [createdAt, strategyName, symbol, startTimeMs, endTimeMs]
  );
  return rows;
}

function aggregatePeriods(dailyRows: readonly PeriodRow[], kind: PeriodKind): readonly PeriodRow[] {
  const rowsByPeriod = new Map<string, PeriodRow[]>();

  for (const row of dailyRows) {
    const key = kind === 'week'
      ? getWeekKey(row.endTimeMs)
      : getMonthKey(row.endTimeMs);
    const periodRows = rowsByPeriod.get(key) ?? [];
    periodRows.push(row);
    rowsByPeriod.set(key, periodRows);
  }

  return Array.from(rowsByPeriod.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, rows]) => {
      const first = rows[0];
      const last = rows[rows.length - 1];
      if (!first || !last) {
        throw new Error(`empty ${kind} rows for ${period}`);
      }
      const pnl = rows.reduce((sum, row) => sum + row.pnl, 0);
      const trades = rows.reduce((sum, row) => sum + row.trades, 0);
      const wins = rows.reduce((sum, row) => sum + row.wins, 0);
      const losses = rows.reduce((sum, row) => sum + row.losses, 0);
      const startEquity = first.startEquity;
      const endEquity = last.endEquity;
      const returnPct = startEquity === 0 ? 0 : ((endEquity / startEquity) - 1) * 100;

      return {
        period,
        startEquity: round(startEquity),
        endEquity: round(endEquity),
        pnl: round(pnl),
        returnPct: round(returnPct, 4),
        trades,
        wins,
        losses,
        winRate: trades === 0 ? 0 : round((wins / trades) * 100, 2),
        startTimeMs: first.startTimeMs,
        endTimeMs: last.endTimeMs
      };
    });
}

function buildSummary(
  config: ValidationConfig,
  strategyName: string,
  tradeBatch: string,
  initialCapital: number,
  leverage: number,
  commissionRate: number,
  daily: readonly PeriodRow[],
  weekly: readonly PeriodRow[],
  monthly: readonly PeriodRow[]
): Summary {
  const finalDaily = daily[daily.length - 1] ?? null;
  const finalEquity = finalDaily ? finalDaily.endEquity : initialCapital;
  const totalPnl = finalEquity - initialCapital;
  const totalTrades = daily.reduce((sum, row) => sum + row.trades, 0);
  const wins = daily.reduce((sum, row) => sum + row.wins, 0);
  const losses = daily.reduce((sum, row) => sum + row.losses, 0);
  let peakEquity = initialCapital;
  let maxDrawdown = 0;

  for (const row of daily) {
    if (row.endEquity > peakEquity) {
      peakEquity = row.endEquity;
    }
    const drawdown = peakEquity - row.endEquity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  const pickBest = (rows: readonly PeriodRow[]): PeriodRow | null => rows.length ? [...rows].sort((left, right) => right.pnl - left.pnl)[0] ?? null : null;
  const pickWorst = (rows: readonly PeriodRow[]): PeriodRow | null => rows.length ? [...rows].sort((left, right) => left.pnl - right.pnl)[0] ?? null : null;

  return {
    validationName: config.name,
    symbol: config.market.symbol.toUpperCase(),
    strategyName,
    tradeBatch,
    initialCapital,
    leverage,
    commissionRate,
    periodStart: new Date(config.timeRange.startTimeMs).toISOString(),
    periodEnd: new Date(config.timeRange.endTimeMs).toISOString(),
    totalTrades,
    wins,
    losses,
    winRate: totalTrades === 0 ? 0 : round((wins / totalTrades) * 100, 2),
    finalEquity: round(finalEquity),
    totalPnl: round(totalPnl),
    totalReturnPct: initialCapital === 0 ? 0 : round((totalPnl / initialCapital) * 100, 4),
    maxDrawdown: round(maxDrawdown),
    maxDrawdownPct: initialCapital === 0 ? 0 : round((maxDrawdown / initialCapital) * 100, 4),
    bestDay: pickBest(daily),
    worstDay: pickWorst(daily),
    bestWeek: pickBest(weekly),
    worstWeek: pickWorst(weekly),
    bestMonth: pickBest(monthly),
    worstMonth: pickWorst(monthly)
  };
}

function simulateReport(
  config: ValidationConfig,
  strategyName: string,
  tradeBatch: string,
  initialCapital: number,
  leverage: number,
  commissionRate: number,
  trades: readonly TradeRow[]
): CompoundReport {
  const tradesByDay = new Map<string, TradeRow[]>();

  for (const trade of trades) {
    const exitTimeMs = Number(trade.exit_time);
    const day = getDayKey(exitTimeMs);
    const dayTrades = tradesByDay.get(day) ?? [];
    dayTrades.push(trade);
    tradesByDay.set(day, dayTrades);
  }

  const sortedDays = Array.from(tradesByDay.keys()).sort((left, right) => left.localeCompare(right));
  const daily: PeriodRow[] = [];
  let equity = initialCapital;

  for (const day of sortedDays) {
    const dayTrades = tradesByDay.get(day) ?? [];
    const startEquity = equity;
    let wins = 0;
    let losses = 0;
    let startTimeMs = Number(dayTrades[0]?.entry_time ?? 0);
    let endTimeMs = Number(dayTrades[dayTrades.length - 1]?.exit_time ?? 0);

    for (const trade of dayTrades) {
      if (equity <= 0) {
        equity = 0;
        break;
      }

      const entryPrice = Number(trade.entry_price);
      const exitPrice = Number(trade.exit_price);
      const movePct = Number(trade.percent ?? 0) / 100;
      const notional = equity * leverage;
      const grossPnl = notional * movePct;
      const exitNotionalRatio = entryPrice > 0 ? exitPrice / entryPrice : 1;
      const fee = notional * commissionRate * (1 + exitNotionalRatio);
      const netPnl = grossPnl - fee;

      equity = Math.max(0, equity + netPnl);
      if (netPnl > 0) {
        wins += 1;
      } else if (netPnl < 0) {
        losses += 1;
      }
      if (Number(trade.entry_time) < startTimeMs || startTimeMs === 0) {
        startTimeMs = Number(trade.entry_time);
      }
      if (Number(trade.exit_time) > endTimeMs) {
        endTimeMs = Number(trade.exit_time);
      }
    }

    const pnl = equity - startEquity;
    const returnPct = startEquity === 0 ? 0 : ((equity / startEquity) - 1) * 100;

    daily.push({
      period: day,
      startEquity: round(startEquity),
      endEquity: round(equity),
      pnl: round(pnl),
      returnPct: round(returnPct, 4),
      trades: dayTrades.length,
      wins,
      losses,
      winRate: dayTrades.length === 0 ? 0 : round((wins / dayTrades.length) * 100, 2),
      startTimeMs,
      endTimeMs
    });
  }

  const weekly = aggregatePeriods(daily, 'week');
  const monthly = aggregatePeriods(daily, 'month');
  const summary = buildSummary(config, strategyName, tradeBatch, initialCapital, leverage, commissionRate, daily, weekly, monthly);

  return {
    summary,
    daily,
    weekly,
    monthly
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const validationPath = resolveConfigPath(args.validation);
  const config = loadJson<ValidationConfig>(validationPath);
  const strategyName = pickStrategyName(config, args.strategyName);
  const symbol = config.market.symbol.toUpperCase();
  const { startTimeMs, endTimeMs } = config.timeRange;
  const tradeBatch = await findTradeBatch(strategyName, symbol, startTimeMs, endTimeMs);
  const trades = await loadTrades(tradeBatch, strategyName, symbol, startTimeMs, endTimeMs);

  if (trades.length === 0) {
    throw new Error('no trades found for requested strategy and period');
  }

  const report = simulateReport(
    config,
    strategyName,
    tradeBatch,
    args.initialCapital,
    args.leverage,
    args.commissionRate,
    trades
  );

  const outputDir = args.outputDir
    ? path.resolve(args.outputDir)
    : path.resolve(__dirname, '../../reports/compound-reports');
  ensureDir(outputDir);

  const startLabel = new Date(startTimeMs).toISOString().slice(0, 10);
  const endLabel = new Date(endTimeMs).toISOString().slice(0, 10);
  const baseName = `${symbol}_${startLabel}_to_${endLabel}_compound_${Math.round(args.initialCapital)}jpy_${String(args.leverage).replace('.', 'p')}x`;
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const mdPath = path.join(outputDir, `${baseName}.md`);
  const dailyCsvPath = path.join(outputDir, `${baseName}_daily.csv`);
  const weeklyCsvPath = path.join(outputDir, `${baseName}_weekly.csv`);
  const monthlyCsvPath = path.join(outputDir, `${baseName}_monthly.csv`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(dailyCsvPath, buildCsv(report.daily), 'utf8');
  fs.writeFileSync(weeklyCsvPath, buildCsv(report.weekly), 'utf8');
  fs.writeFileSync(monthlyCsvPath, buildCsv(report.monthly), 'utf8');
  fs.writeFileSync(mdPath, renderMarkdown(report, dailyCsvPath, weeklyCsvPath, monthlyCsvPath), 'utf8');

  console.log(`Compound report JSON written: ${jsonPath}`);
  console.log(`Compound report markdown written: ${mdPath}`);
  console.log(`Daily CSV written: ${dailyCsvPath}`);
  console.log(`Weekly CSV written: ${weeklyCsvPath}`);
  console.log(`Monthly CSV written: ${monthlyCsvPath}`);
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
