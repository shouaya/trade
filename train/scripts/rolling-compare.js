const mysql = require('mysql2/promise');
require('dotenv').config();

const MONTHS = [
  '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02'
];

async function compareRollingWindowResults() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log('\n每月最佳策略对比:\n');

  const results = [];
  let totalPnl = 0;
  let totalTrades = 0;
  let totalWinRate = 0;
  let monthsWithData = 0;

  for (const month of MONTHS) {
    const tableName = `backtest_results_rolling_${month.replace('-', '_')}_train`;

    try {
      const [rows] = await db.query(`
        SELECT strategy_name, total_pnl, total_trades, win_rate, sharpe_ratio, profit_factor
        FROM ${tableName}
        ORDER BY total_pnl DESC
        LIMIT 1
      `);

      if (rows.length > 0) {
        const row = rows[0];
        // Convert MySQL DECIMAL to number
        const pnl = parseFloat(row.total_pnl);
        const winRate = parseFloat(row.win_rate);
        const sharpe = parseFloat(row.sharpe_ratio);

        const profitFactor = parseFloat(row.profit_factor);

        results.push({
          月份: month,
          策略: row.strategy_name.substring(0, 40) + '...',
          总盈亏: `$${pnl.toFixed(2)}`,
          交易数: row.total_trades,
          胜率: `${(winRate * 100).toFixed(1)}%`,
          夏普: sharpe.toFixed(3),
          盈利因子: profitFactor.toFixed(2)
        });

        totalPnl += pnl;
        totalTrades += row.total_trades;
        totalWinRate += winRate;
        monthsWithData++;
      }
    } catch (error) {
      console.log(`⚠️  ${month}: 表不存在或无数据`);
    }
  }

  console.table(results);

  if (monthsWithData > 0) {
    console.log('\n汇总统计:');
    console.log(`总盈亏: $${totalPnl.toFixed(2)}`);
    console.log(`总交易数: ${totalTrades}`);
    console.log(`平均胜率: ${(totalWinRate / monthsWithData * 100).toFixed(1)}%`);
    console.log(`平均每月盈亏: $${(totalPnl / monthsWithData).toFixed(2)}`);
    console.log(`完成月份数: ${monthsWithData}/${MONTHS.length}`);

    console.log('\n说明: 以上是每月训练出的最佳策略在训练期（过去12个月）的表现');
    console.log('注意: 验证步骤失败，需要修复后才能看到策略在验证期（当月）的实际表现');
  }

  await db.end();
}

compareRollingWindowResults().catch(console.error);
