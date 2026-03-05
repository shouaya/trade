/**
 * 查询不同维度的Top策略
 * 用于提取盈亏最佳和胜率最佳的策略
 */

const db = require('../configs/database');

async function queryTopByMetrics(tableName, topN = 10) {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           查询多维度 Top 策略                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`📊 结果表: ${tableName}`);
  console.log(`📈 Top N: ${topN}\n`);

  try {
    // 1. 盈亏最佳 (Total PnL)
    console.log('═══════════════════════════════════════════════════════════');
    console.log('💰 盈亏最佳 Top ' + topN);
    console.log('═══════════════════════════════════════════════════════════\n');

    const [topPnl] = await db.query(`
      SELECT
        strategy_name,
        total_pnl,
        total_trades,
        win_rate,
        sharpe_ratio,
        max_drawdown,
        profit_factor,
        avg_win,
        avg_loss
      FROM ${tableName}
      WHERE total_trades >= 10
      ORDER BY total_pnl DESC
      LIMIT ?
    `, [topN]);

    console.log('排名 | 策略名称 | 总盈亏 | 交易数 | 胜率 | 夏普 | 最大回撤 | 盈亏比');
    console.log('────────────────────────────────────────────────────────────');
    topPnl.forEach((row, idx) => {
      console.log(
        `${String(idx + 1).padStart(4)} | ` +
        `${row.strategy_name.padEnd(40)} | ` +
        `$${Number(row.total_pnl).toFixed(2).padStart(8)} | ` +
        `${String(row.total_trades).padStart(6)} | ` +
        `${(Number(row.win_rate) * 100).toFixed(1).padStart(5)}% | ` +
        `${Number(row.sharpe_ratio).toFixed(3).padStart(6)} | ` +
        `$${Number(row.max_drawdown).toFixed(2).padStart(7)} | ` +
        `${Number(row.profit_factor).toFixed(2).padStart(6)}`
      );
    });
    console.log('\n');

    // 2. 胜率最佳 (Win Rate)
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎯 胜率最佳 Top ' + topN);
    console.log('═══════════════════════════════════════════════════════════\n');

    const [topWinRate] = await db.query(`
      SELECT
        strategy_name,
        total_pnl,
        total_trades,
        win_rate,
        sharpe_ratio,
        max_drawdown,
        profit_factor,
        avg_win,
        avg_loss
      FROM ${tableName}
      WHERE total_trades >= 10
      ORDER BY win_rate DESC, total_pnl DESC
      LIMIT ?
    `, [topN]);

    console.log('排名 | 策略名称 | 胜率 | 交易数 | 总盈亏 | 夏普 | 最大回撤 | 盈亏比');
    console.log('────────────────────────────────────────────────────────────');
    topWinRate.forEach((row, idx) => {
      console.log(
        `${String(idx + 1).padStart(4)} | ` +
        `${row.strategy_name.padEnd(40)} | ` +
        `${(Number(row.win_rate) * 100).toFixed(1).padStart(5)}% | ` +
        `${String(row.total_trades).padStart(6)} | ` +
        `$${Number(row.total_pnl).toFixed(2).padStart(8)} | ` +
        `${Number(row.sharpe_ratio).toFixed(3).padStart(6)} | ` +
        `$${Number(row.max_drawdown).toFixed(2).padStart(7)} | ` +
        `${Number(row.profit_factor).toFixed(2).padStart(6)}`
      );
    });
    console.log('\n');

    // 3. 夏普比率最佳 (Sharpe Ratio)
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📈 夏普比率最佳 Top ' + topN);
    console.log('═══════════════════════════════════════════════════════════\n');

    const [topSharpe] = await db.query(`
      SELECT
        strategy_name,
        total_pnl,
        total_trades,
        win_rate,
        sharpe_ratio,
        max_drawdown,
        profit_factor,
        avg_win,
        avg_loss
      FROM ${tableName}
      WHERE total_trades >= 10
      ORDER BY sharpe_ratio DESC, total_pnl DESC
      LIMIT ?
    `, [topN]);

    console.log('排名 | 策略名称 | 夏普 | 交易数 | 总盈亏 | 胜率 | 最大回撤 | 盈亏比');
    console.log('────────────────────────────────────────────────────────────');
    topSharpe.forEach((row, idx) => {
      console.log(
        `${String(idx + 1).padStart(4)} | ` +
        `${row.strategy_name.padEnd(40)} | ` +
        `${Number(row.sharpe_ratio).toFixed(3).padStart(6)} | ` +
        `${String(row.total_trades).padStart(6)} | ` +
        `$${Number(row.total_pnl).toFixed(2).padStart(8)} | ` +
        `${(Number(row.win_rate) * 100).toFixed(1).padStart(5)}% | ` +
        `$${Number(row.max_drawdown).toFixed(2).padStart(7)} | ` +
        `${Number(row.profit_factor).toFixed(2).padStart(6)}`
      );
    });
    console.log('\n');

    // 4. 盈亏比最佳 (Profit Factor)
    console.log('═══════════════════════════════════════════════════════════');
    console.log('💎 盈亏比最佳 Top ' + topN);
    console.log('═══════════════════════════════════════════════════════════\n');

    const [topPF] = await db.query(`
      SELECT
        strategy_name,
        total_pnl,
        total_trades,
        win_rate,
        sharpe_ratio,
        max_drawdown,
        profit_factor,
        avg_win,
        avg_loss
      FROM ${tableName}
      WHERE total_trades >= 10 AND profit_factor < 999
      ORDER BY profit_factor DESC, total_pnl DESC
      LIMIT ?
    `, [topN]);

    console.log('排名 | 策略名称 | 盈亏比 | 交易数 | 总盈亏 | 胜率 | 夏普 | 最大回撤');
    console.log('────────────────────────────────────────────────────────────');
    topPF.forEach((row, idx) => {
      console.log(
        `${String(idx + 1).padStart(4)} | ` +
        `${row.strategy_name.padEnd(40)} | ` +
        `${Number(row.profit_factor).toFixed(2).padStart(6)} | ` +
        `${String(row.total_trades).padStart(6)} | ` +
        `$${Number(row.total_pnl).toFixed(2).padStart(8)} | ` +
        `${(Number(row.win_rate) * 100).toFixed(1).padStart(5)}% | ` +
        `${Number(row.sharpe_ratio).toFixed(3).padStart(6)} | ` +
        `$${Number(row.max_drawdown).toFixed(2).padStart(7)}`
      );
    });
    console.log('\n');

    // 统计摘要
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 统计摘要');
    console.log('═══════════════════════════════════════════════════════════\n');

    const [summary] = await db.query(`
      SELECT
        COUNT(*) as total_strategies,
        COUNT(CASE WHEN total_pnl > 0 THEN 1 END) as profitable_count,
        COUNT(CASE WHEN total_pnl < 0 THEN 1 END) as losing_count,
        AVG(total_pnl) as avg_pnl,
        MAX(total_pnl) as max_pnl,
        MIN(total_pnl) as min_pnl,
        AVG(win_rate) as avg_win_rate,
        AVG(sharpe_ratio) as avg_sharpe
      FROM ${tableName}
      WHERE total_trades >= 10
    `);

    const stats = summary[0];
    console.log(`总策略数: ${stats.total_strategies}`);
    console.log(`盈利策略: ${stats.profitable_count} (${(Number(stats.profitable_count) / Number(stats.total_strategies) * 100).toFixed(1)}%)`);
    console.log(`亏损策略: ${stats.losing_count} (${(Number(stats.losing_count) / Number(stats.total_strategies) * 100).toFixed(1)}%)`);
    console.log(`平均盈亏: $${Number(stats.avg_pnl).toFixed(2)}`);
    console.log(`最大盈亏: $${Number(stats.max_pnl).toFixed(2)}`);
    console.log(`最小盈亏: $${Number(stats.min_pnl).toFixed(2)}`);
    console.log(`平均胜率: ${(Number(stats.avg_win_rate) * 100).toFixed(2)}%`);
    console.log(`平均夏普: ${Number(stats.avg_sharpe).toFixed(3)}`);

    console.log('\n✅ 查询完成\n');

  } catch (error) {
    console.error('❌ 查询失败:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// 命令行调用
if (require.main === module) {
  const tableName = process.argv[2];
  const topN = parseInt(process.argv[3]) || 10;

  if (!tableName) {
    console.error('❌ 请指定结果表名');
    console.error('用法: node scripts/query-top-by-metrics.js <table_name> [top_n]');
    console.error('示例: node scripts/query-top-by-metrics.js backtest_results_2024_v3_holdtime 10');
    process.exit(1);
  }

  queryTopByMetrics(tableName, topN).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { queryTopByMetrics };
