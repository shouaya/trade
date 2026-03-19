#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SYMBOLS = ['ETHJPY', 'BTCJPY', 'SOLJPY'];
const REPORT_DIR = path.resolve(__dirname, '../reports/volatility');
const OUTPUT_PATH = path.join(REPORT_DIR, 'CRYPTO_JPY_volatility_comparison_report_2024_2026.md');

function readSummary(symbol) {
  const filePath = path.join(REPORT_DIR, `${symbol}_volatility_summary_2024_2026.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeLabel(symbol) {
  return symbol.includes('_') ? symbol : `${symbol.slice(0, 3)}_${symbol.slice(3)}`;
}

function topBy(rows, key) {
  return [...rows].sort((a, b) => b[key] - a[key])[0];
}

function lowBy(rows, key) {
  return [...rows].sort((a, b) => a[key] - b[key])[0];
}

function fmt(value) {
  if (value == null) return '';
  if (typeof value === 'number') return String(Number(value.toFixed(6)));
  return String(value);
}

function table(rows, columns) {
  const header = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows
    .map((row) => `| ${columns.map((c) => (c.format ? c.format(row[c.key], row) : fmt(row[c.key]))).join(' | ')} |`)
    .join('\n');
  return `${header}\n${divider}\n${body}`;
}

function buildRows(datasetMap) {
  return SYMBOLS.map((symbol) => {
    const data = datasetMap[symbol];
    const allYears = data.years.filter((year) => year.stats);
    const hottestMonth = topBy(data.months, 'avgAbsReturnPct');
    const calmestMonth = lowBy(data.months, 'avgAbsReturnPct');
    const hottestHour = topBy(data.hourly, 'avgAbsReturnPct');
    const calmestHour = lowBy(data.hourly, 'avgAbsReturnPct');
    const hottestDay = data.hottestDays?.[0] || data.dailySummary?.hottestDays?.[0];
    const calmestDay = data.calmestDays?.[0] || data.dailySummary?.calmestDays?.[0];
    const yearlyAvg = allYears.reduce((sum, row) => sum + row.stats.avgAbsReturnPct, 0) / allYears.length;
    const yearlyRv = allYears.reduce((sum, row) => sum + row.dailySummary.avgRealizedVolPct, 0) / allYears.length;

    return {
      symbol,
      label: normalizeLabel(symbol),
      yearCount: allYears.length,
      yearlyAvgAbsReturnPct: yearlyAvg,
      yearlyAvgDailyRvPct: yearlyRv,
      hottestMonth: hottestMonth.month,
      hottestMonthValue: hottestMonth.avgAbsReturnPct,
      calmestMonth: calmestMonth.month,
      calmestMonthValue: calmestMonth.avgAbsReturnPct,
      hottestHour: `${hottestHour.hour}:00-${String(Number(hottestHour.hour) + 1).padStart(2, '0')}:00`,
      hottestHourValue: hottestHour.avgAbsReturnPct,
      calmestHour: `${calmestHour.hour}:00-${String(Number(calmestHour.hour) + 1).padStart(2, '0')}:00`,
      calmestHourValue: calmestHour.avgAbsReturnPct,
      hottestDay: hottestDay.date,
      hottestDayValue: hottestDay.realizedVolPct,
      calmestDay: calmestDay.date,
      calmestDayValue: calmestDay.realizedVolPct,
      coverage: allYears.map((row) => `${row.year}: ${row.coverage.firstTimestampJst} ~ ${row.coverage.lastTimestampJst}`).join('; ')
    };
  });
}

function buildYearRows(datasetMap, year) {
  return SYMBOLS.map((symbol) => {
    const yearEntry = datasetMap[symbol].years.find((entry) => entry.year === year);
    return {
      symbol: normalizeLabel(symbol),
      coverage: yearEntry?.coverage ? `${yearEntry.coverage.firstTimestampJst} ~ ${yearEntry.coverage.lastTimestampJst}` : '无数据',
      avgAbsReturnPct: yearEntry?.stats?.avgAbsReturnPct ?? null,
      p95AbsReturnPct: yearEntry?.stats?.p95AbsReturnPct ?? null,
      avgRangePct: yearEntry?.stats?.avgRangePct ?? null,
      avgRealizedVolPct: yearEntry?.dailySummary?.avgRealizedVolPct ?? null,
      maxRealizedVolPct: yearEntry?.dailySummary?.maxRealizedVolPct ?? null
    };
  });
}

function main() {
  const datasetMap = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, readSummary(symbol)]));
  const summaryRows = buildRows(datasetMap);
  const hottestOverall = topBy(summaryRows, 'yearlyAvgAbsReturnPct');
  const calmestOverall = lowBy(summaryRows, 'yearlyAvgAbsReturnPct');
  const wildestDay = topBy(summaryRows, 'hottestDayValue');
  const quietestDay = lowBy(summaryRows, 'calmestDayValue');

  const lines = [];
  lines.push('# ETH_JPY / BTC_JPY / SOL_JPY 横向波动率对比报告（2024-2026）');
  lines.push('');
  lines.push('## 范围与口径');
  lines.push('');
  lines.push('- 数据来源: `klines` 表中的 1 分钟 K 线');
  lines.push('- 标的: `ETHJPY`、`BTCJPY`、`SOLJPY`');
  lines.push('- 时区: JST（Asia/Tokyo）');
  lines.push('- 主指标: 每分钟绝对对数收益 `|ln(close_t / close_{t-1})| × 100`');
  lines.push('- 辅助指标: 日实现波动率 `sqrt(sum(log_return^2)) × 100`');
  lines.push('- 注意: `SOLJPY` 的样本从 `2024-04-13` 开始，`2026` 对三者都属于部分样本。');
  lines.push('');
  lines.push('## 核心结论');
  lines.push('');
  lines.push(`- 三个品种里，平均分钟波动最高的是 **${hottestOverall.label}**，跨年份平均 Avg Abs 1m Return 约 **${fmt(hottestOverall.yearlyAvgAbsReturnPct)}%**。`);
  lines.push(`- 平均分钟波动最低的是 **${calmestOverall.label}**，跨年份平均约 **${fmt(calmestOverall.yearlyAvgAbsReturnPct)}%**。`);
  lines.push(`- 单日极端波动最强的是 **${wildestDay.label}**，峰值日 **${wildestDay.hottestDay}**，日实现波动率 **${fmt(wildestDay.hottestDayValue)}%**。`);
  lines.push(`- 单日最平静样本来自 **${quietestDay.label}**，低波动日 **${quietestDay.calmestDay}**，日实现波动率 **${fmt(quietestDay.calmestDayValue)}%**。`);
  lines.push('- 日内时段上，三个品种的高波动窗口都集中在深夜到凌晨 JST，尤其 `23:00-01:00` 一带；低波动窗口主要落在下午到晚间早段。');
  lines.push('- 波动层级大致是 `SOLJPY > ETHJPY > BTCJPY`。SOL 的分钟波动和日波动都明显更大，BTC 相对最平稳。');
  lines.push('');
  lines.push('## 总览对比');
  lines.push('');
  lines.push(
    table(summaryRows, [
      { key: 'label', label: 'Symbol' },
      { key: 'yearlyAvgAbsReturnPct', label: 'Cross-Year Avg Abs 1m Return %' },
      { key: 'yearlyAvgDailyRvPct', label: 'Cross-Year Avg Daily RV %' },
      { key: 'hottestMonth', label: 'Hottest Month' },
      { key: 'hottestMonthValue', label: 'Hot Month Value %' },
      { key: 'calmestMonth', label: 'Calmest Month' },
      { key: 'calmestMonthValue', label: 'Calm Month Value %' },
      { key: 'hottestHour', label: 'Hottest JST Hour' },
      { key: 'hottestHourValue', label: 'Hot Hour Value %' },
      { key: 'calmestHour', label: 'Calmest JST Hour' },
      { key: 'calmestHourValue', label: 'Calm Hour Value %' }
    ])
  );
  lines.push('');
  lines.push('## 年度对比');
  lines.push('');
  for (const year of [2024, 2025, 2026]) {
    lines.push(`### ${year}`);
    lines.push('');
    lines.push(
      table(buildYearRows(datasetMap, year), [
        { key: 'symbol', label: 'Symbol' },
        { key: 'coverage', label: 'Coverage (JST)' },
        { key: 'avgAbsReturnPct', label: 'Avg Abs 1m Return %' },
        { key: 'p95AbsReturnPct', label: 'P95 %' },
        { key: 'avgRangePct', label: 'Avg 1m Range %' },
        { key: 'avgRealizedVolPct', label: 'Avg Daily RV %' },
        { key: 'maxRealizedVolPct', label: 'Max Daily RV %' }
      ])
    );
    lines.push('');
  }

  lines.push('## 解读');
  lines.push('');
  lines.push('- `SOLJPY` 最适合被视作高弹性高噪声资产，月份切换和事件日冲击都更剧烈，做短线时更需要仓位和滑点保护。');
  lines.push('- `ETHJPY` 处在中间层，既有明显趋势段，也会出现很厚的尾部，适合做波动 regime 切换。');
  lines.push('- `BTCJPY` 相对更稳，分钟收益分布更收敛，适合拿来做基准品种或和 ETH/SOL 做相对强弱比较。');
  lines.push('- 三者共同的高波动时段都偏向 `23:00` 前后，说明如果做统一多品种日内策略，这个窗口值得单独建模。');
  lines.push('- 三者共同的低波动时段并不完全一致，但都避不开亚洲下午这段偏淡时段，适合降低频率或提高入场阈值。');
  lines.push('');
  lines.push('## 单品种报告索引');
  lines.push('');
  for (const symbol of SYMBOLS) {
    const base = symbol.toLowerCase();
    lines.push(`- ${normalizeLabel(symbol)}: \`${symbol}_volatility_report_2024_2026.md\`, \`${base}_volatility_distribution_2024_2026.svg\`, \`${base}_monthly_volatility_2024_2026.svg\`, \`${base}_intraday_volatility_jst.svg\``);
  }
  lines.push('');

  fs.writeFileSync(OUTPUT_PATH, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Comparison report written: ${OUTPUT_PATH}`);
}

main();
