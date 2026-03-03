/**
 * 查询策略分组回测的最终结果
 * 从backtest_results_2025_full表中提取Top 10策略
 */

const db = require('../../backend/config/database');

async function main() {
  console.log('='.repeat(80));
  console.log('📊 2025年策略分组回测 - 结果查询');
  console.log('='.repeat(80));
  console.log('');

  try {
    // 1. 检查表是否存在
    const [tables] = await db.query(`SHOW TABLES LIKE 'backtest_results_2025_full'`);

    if (tables.length === 0) {
      console.error('❌ 结果表 backtest_results_2025_full 不存在!');
      console.log('\n请先运行回测: bash scripts/launch-strategy-group-backtest.sh\n');
      process.exit(1);
    }

    // 2. 统计总记录数
    const [countResult] = await db.query(`
      SELECT COUNT(*) as total FROM backtest_results_2025_full
    `);
    const totalRecords = countResult[0].total;

    console.log(`📦 数据库统计:`);
    console.log(`   总记录数: ${totalRecords.toLocaleString()} / 560,196`);
    console.log(`   完成度: ${((totalRecords / 560196) * 100).toFixed(2)}%\n`);

    // 3. 按策略类型统计
    const [typeStats] = await db.query(`
      SELECT
        strategy_type,
        COUNT(*) as count,
        AVG(score) as avg_score,
        MAX(score) as max_score
      FROM backtest_results_2025_full
      GROUP BY strategy_type
      ORDER BY avg_score DESC
    `);

    console.log('📊 策略类型统计:\n');
    typeStats.forEach(row => {
      console.log(`  ${row.strategy_type}:`);
      console.log(`    数量: ${row.count.toLocaleString()}`);
      console.log(`    平均评分: ${parseFloat(row.avg_score || 0).toFixed(2)}`);
      console.log(`    最高评分: ${parseFloat(row.max_score || 0).toFixed(2)}`);
      console.log('');
    });

    // 4. Top 10策略
    console.log('='.repeat(80));
    console.log('\n🏆 2025年全年Top 10策略:\n');
    console.log('='.repeat(80));
    console.log('');

    const [top10] = await db.query(`
      SELECT
        strategy_name,
        strategy_type,
        total_trades,
        ROUND(win_rate * 100, 2) as win_rate_pct,
        ROUND(total_pnl, 2) as total_pnl,
        ROUND(sharpe_ratio, 3) as sharpe_ratio,
        ROUND(profit_factor, 2) as profit_factor,
        ROUND(max_drawdown * 100, 2) as max_drawdown_pct,
        ROUND(score, 2) as score
      FROM backtest_results_2025_full
      WHERE total_trades >= 10
      ORDER BY score DESC
      LIMIT 10
    `);

    if (top10.length === 0) {
      console.log('⚠️  暂无结果 (可能回测还在进行中)\n');
    } else {
      top10.forEach((row, index) => {
        console.log(`${index + 1}. ${row.strategy_name}`);
        console.log(`   类型: ${row.strategy_type}`);
        console.log(`   交易次数: ${row.total_trades}`);
        console.log(`   胜率: ${row.win_rate_pct}%`);
        console.log(`   总盈亏: $${row.total_pnl}`);
        console.log(`   夏普比率: ${row.sharpe_ratio}`);
        console.log(`   盈利因子: ${row.profit_factor}`);
        console.log(`   最大回撤: ${row.max_drawdown_pct}%`);
        console.log(`   综合评分: ${row.score}`);
        console.log('');
      });

      // 5. 保存到strategies表
      if (totalRecords >= 560196) {
        console.log('='.repeat(80));
        console.log('\n💾 保存Top 10到strategies表...\n');

        await db.query(`DELETE FROM strategies WHERE name LIKE '2025-FULL-%'`);

        for (let i = 0; i < top10.length; i++) {
          const strategy = top10[i];

          const description = `2025全年: 交易${strategy.total_trades}次, 胜率${strategy.win_rate_pct}%, ` +
                             `总盈亏$${strategy.total_pnl}, 夏普${strategy.sharpe_ratio}, ` +
                             `回撤${strategy.max_drawdown_pct}%`;

          const [paramRow] = await db.query(`
            SELECT parameters FROM backtest_results_2025_full WHERE strategy_name = ?
          `, [strategy.strategy_name]);

          await db.query(`
            INSERT INTO strategies (name, description, parameters)
            VALUES (?, ?, ?)
          `, [`2025-FULL-${strategy.strategy_name}`, description, paramRow[0].parameters]);

          console.log(`  ${i + 1}. 2025-FULL-${strategy.strategy_name}`);
        }

        console.log('\n✅ Top 10策略已保存到strategies表\n');
      }
    }

    console.log('='.repeat(80));
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 查询失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

