/**
 * 聚合12个月的并行回测结果
 * 从12个月度结果表中提取Top策略,计算全年综合表现
 */

const db = require('../config/database');

const MONTHS = [
  { number: 1, suffix: '2025_01' },
  { number: 2, suffix: '2025_02' },
  { number: 3, suffix: '2025_03' },
  { number: 4, suffix: '2025_04' },
  { number: 5, suffix: '2025_05' },
  { number: 6, suffix: '2025_06' },
  { number: 7, suffix: '2025_07' },
  { number: 8, suffix: '2025_08' },
  { number: 9, suffix: '2025_09' },
  { number: 10, suffix: '2025_10' },
  { number: 11, suffix: '2025_11' },
  { number: 12, suffix: '2025_12' }
];

/**
 * 主函数
 */
async function main() {
  console.log('='.repeat(80));
  console.log('📊 聚合12个月的并行回测结果');
  console.log('='.repeat(80));
  console.log('');

  try {
    // 1. 检查所有月度表是否存在
    console.log('🔍 检查月度结果表...\n');
    const existingTables = [];

    for (const month of MONTHS) {
      const [tables] = await db.query(`
        SHOW TABLES LIKE 'backtest_results_${month.suffix}'
      `);

      if (tables.length > 0) {
        const [countResult] = await db.query(`
          SELECT COUNT(*) as count FROM backtest_results_${month.suffix}
        `);
        const count = countResult[0].count;

        console.log(`  ✅ ${month.number}月: ${count.toLocaleString()} 条结果`);
        existingTables.push(month);
      } else {
        console.log(`  ⚠️  ${month.number}月: 表不存在`);
      }
    }

    if (existingTables.length === 0) {
      console.error('\n❌ 没有找到任何月度结果表！');
      process.exit(1);
    }

    console.log(`\n✅ 找到 ${existingTables.length}/12 个月的结果\n`);

    // 2. 从每个月提取Top 100策略
    console.log('🏆 从每个月提取Top 100策略...\n');
    const allCandidates = new Map(); // strategy_name -> {months: [], avgScore: 0, ...}

    for (const month of existingTables) {
      const [top100] = await db.query(`
        SELECT
          strategy_name,
          strategy_type,
          parameters,
          total_trades,
          win_rate,
          total_pnl,
          avg_pnl,
          sharpe_ratio,
          profit_factor,
          max_drawdown,
          score
        FROM backtest_results_${month.suffix}
        WHERE total_trades >= 10
        ORDER BY score DESC
        LIMIT 100
      `);

      console.log(`  ${month.number}月: ${top100.length} 个策略`);

      top100.forEach(strategy => {
        if (!allCandidates.has(strategy.strategy_name)) {
          allCandidates.set(strategy.strategy_name, {
            name: strategy.strategy_name,
            type: strategy.strategy_type,
            parameters: strategy.parameters,
            monthlyResults: [],
            totalMonths: 0,
            avgScore: 0,
            totalPnl: 0,
            avgWinRate: 0,
            avgSharpe: 0,
            avgProfitFactor: 0,
            maxDrawdown: 0,
            totalTrades: 0
          });
        }

        const candidate = allCandidates.get(strategy.strategy_name);
        candidate.monthlyResults.push({
          month: month.number,
          score: strategy.score,
          totalPnl: strategy.total_pnl,
          winRate: strategy.win_rate,
          sharpeRatio: strategy.sharpe_ratio,
          profitFactor: strategy.profit_factor,
          maxDrawdown: strategy.max_drawdown,
          totalTrades: strategy.total_trades
        });
      });
    }

    console.log(`\n✅ 共收集 ${allCandidates.size.toLocaleString()} 个候选策略\n`);

    // 3. 计算每个策略的全年综合指标
    console.log('📈 计算全年综合指标...\n');

    const finalCandidates = [];

    for (const [name, candidate] of allCandidates) {
      const monthlyResults = candidate.monthlyResults;
      const monthCount = monthlyResults.length;

      // 只保留至少在6个月中表现优秀的策略
      if (monthCount < 6) {
        continue;
      }

      // 计算平均值
      const avgScore = monthlyResults.reduce((sum, m) => sum + m.score, 0) / monthCount;
      const totalPnl = monthlyResults.reduce((sum, m) => sum + m.totalPnl, 0);
      const avgWinRate = monthlyResults.reduce((sum, m) => sum + m.winRate, 0) / monthCount;
      const avgSharpe = monthlyResults.reduce((sum, m) => sum + m.sharpeRatio, 0) / monthCount;
      const avgProfitFactor = monthlyResults.reduce((sum, m) => sum + m.profitFactor, 0) / monthCount;
      const maxDrawdown = Math.max(...monthlyResults.map(m => m.maxDrawdown));
      const totalTrades = monthlyResults.reduce((sum, m) => sum + m.totalTrades, 0);

      // 计算最终综合评分 (考虑稳定性)
      const stabilityBonus = (monthCount / 12) * 10; // 出现月份越多,奖励越高
      const finalScore = avgScore + stabilityBonus;

      finalCandidates.push({
        name,
        type: candidate.type,
        parameters: candidate.parameters,
        monthCount,
        avgScore,
        totalPnl,
        avgWinRate,
        avgSharpe,
        avgProfitFactor,
        maxDrawdown,
        totalTrades,
        finalScore
      });
    }

    console.log(`✅ ${finalCandidates.length.toLocaleString()} 个策略在至少6个月中表现优秀\n`);

    // 4. 排序并选出Top 10
    finalCandidates.sort((a, b) => b.finalScore - a.finalScore);
    const top10 = finalCandidates.slice(0, 10);

    console.log('='.repeat(80));
    console.log('\n🏆 2025年全年Top 10策略 (基于12个月并行回测)\n');
    console.log('='.repeat(80));
    console.log('');

    top10.forEach((strategy, index) => {
      console.log(`${index + 1}. ${strategy.name}`);
      console.log(`   类型: ${strategy.type}`);
      console.log(`   出现月份: ${strategy.monthCount}/12`);
      console.log(`   全年交易次数: ${strategy.totalTrades}`);
      console.log(`   平均胜率: ${(strategy.avgWinRate * 100).toFixed(2)}%`);
      console.log(`   全年总盈亏: $${strategy.totalPnl.toFixed(2)}`);
      console.log(`   平均夏普比率: ${strategy.avgSharpe.toFixed(3)}`);
      console.log(`   平均盈利因子: ${strategy.avgProfitFactor.toFixed(2)}`);
      console.log(`   最大回撤: ${(strategy.maxDrawdown * 100).toFixed(2)}%`);
      console.log(`   平均评分: ${strategy.avgScore.toFixed(2)}`);
      console.log(`   最终评分: ${strategy.finalScore.toFixed(2)}`);
      console.log('');
    });

    // 5. 保存到strategies表
    console.log('💾 保存Top 10到strategies表...\n');

    // 清空旧的2025策略
    await db.query(`DELETE FROM strategies WHERE name LIKE '2025-%'`);
    console.log('✅ 清空旧的2025策略');

    // 插入新的Top 10
    for (let i = 0; i < top10.length; i++) {
      const strategy = top10[i];

      const description = `全年: 交易${strategy.totalTrades}次, 胜率${(strategy.avgWinRate * 100).toFixed(2)}%, ` +
                         `总盈亏$${strategy.totalPnl.toFixed(2)}, 夏普${strategy.avgSharpe.toFixed(3)}, ` +
                         `回撤${(strategy.maxDrawdown * 100).toFixed(2)}%, 出现${strategy.monthCount}/12月`;

      await db.query(`
        INSERT INTO strategies (name, description, parameters)
        VALUES (?, ?, ?)
      `, [`2025-${strategy.name}`, description, strategy.parameters]);

      console.log(`  ${i + 1}. 2025-${strategy.name}`);
    }

    console.log('\n✅ Top 10策略已保存到strategies表\n');

    // 6. 生成统计摘要
    console.log('='.repeat(80));
    console.log('\n📊 全年统计摘要:\n');
    console.log('='.repeat(80));

    const avgWinRateAll = top10.reduce((sum, s) => sum + s.avgWinRate, 0) / top10.length;
    const totalPnlAll = top10.reduce((sum, s) => sum + s.totalPnl, 0);
    const avgSharpeAll = top10.reduce((sum, s) => sum + s.avgSharpe, 0) / top10.length;
    const avgDrawdownAll = top10.reduce((sum, s) => sum + s.maxDrawdown, 0) / top10.length;

    console.log(`   Top 10平均胜率: ${(avgWinRateAll * 100).toFixed(2)}%`);
    console.log(`   Top 10总盈亏: $${totalPnlAll.toFixed(2)}`);
    console.log(`   Top 10平均夏普: ${avgSharpeAll.toFixed(3)}`);
    console.log(`   Top 10平均回撤: ${(avgDrawdownAll * 100).toFixed(2)}%`);
    console.log('');

    console.log('='.repeat(80));
    console.log('✨ 聚合完成!\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 聚合失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行
main();
