const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const MONTHS = [
  '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02'
];

async function generateTrainingSummary() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log('📊 生成滚动窗口训练汇总报告...\n');

  const summary = [];
  let totalPnl = 0;
  let totalTrades = 0;
  let profitableMonths = 0;

  for (const month of MONTHS) {
    const tableName = `backtest_results_rolling_${month.replace('-', '_')}_train`;

    try {
      const [rows] = await db.query(`
        SELECT strategy_name, total_pnl, total_trades, win_rate, sharpe_ratio, profit_factor, parameters
        FROM ${tableName}
        ORDER BY total_pnl DESC
        LIMIT 1
      `);

      if (rows.length > 0) {
        const row = rows[0];
        const pnl = parseFloat(row.total_pnl);
        const winRate = parseFloat(row.win_rate);
        const sharpe = parseFloat(row.sharpe_ratio);
        const profitFactor = parseFloat(row.profit_factor);

        summary.push({
          month: month,
          trainStrategy: row.strategy_name,
          trainPnl: pnl,
          trainTrades: row.total_trades,
          trainWinRate: `${(winRate * 100).toFixed(1)}%`,
          trainSharpe: sharpe,
          trainProfitFactor: profitFactor,
          parameters: typeof row.parameters === 'string' ? JSON.parse(row.parameters) : row.parameters,
          note: '训练期表现（过去12个月数据）'
        });

        totalPnl += pnl;
        totalTrades += row.total_trades;
        if (pnl > 0) profitableMonths++;

        console.log(`✅ ${month}: $${pnl.toFixed(2)}`);
      }
    } catch (error) {
      console.log(`⚠️  ${month}: 数据不存在`);
    }
  }

  await db.end();

  const report = {
    generatedAt: new Date().toISOString(),
    note: '此报告显示训练期最佳策略表现。验证步骤失败，未包含验证期数据。',
    summary,
    totals: {
      totalTrainPnl: totalPnl,
      totalTrainTrades: totalTrades,
      avgTrainPnl: totalPnl / summary.length,
      profitableMonths,
      totalMonths: summary.length
    }
  };

  // 保存报告
  const reportPath = path.join(__dirname, '../reports/rolling_window_training_summary.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n✅ 报告已生成: ${reportPath}`);
  console.log(`\n汇总统计:`);
  console.log(`  总盈亏: $${totalPnl.toFixed(2)}`);
  console.log(`  总交易数: ${totalTrades}`);
  console.log(`  平均每月盈亏: $${(totalPnl / summary.length).toFixed(2)}`);
  console.log(`  盈利月份: ${profitableMonths}/${summary.length}`);
}

generateTrainingSummary().catch(console.error);
