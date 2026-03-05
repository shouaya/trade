#!/usr/bin/env node
/**
 * 通用分析脚本
 *
 * 使用方法:
 *   node scripts/analyze.js <result-table-name> [options]
 *   node scripts/analyze.js backtest_results_2024_v3_optimized --top=10
 *
 * 功能:
 * 1. 分析策略结果表的统计数据
 * 2. 分析参数影响（止损、止盈、持仓时间等）
 * 3. 生成分析报告
 */

const db = require('../configs/database');

/**
 * 查询Top策略
 */
async function queryTopStrategies(tableName, limit = 10) {
  const [results] = await db.query(
    `SELECT * FROM ${tableName}
     WHERE total_trades > 0
     ORDER BY total_pnl DESC
     LIMIT ?`,
    [limit]
  );

  return results;
}

/**
 * 分析参数影响
 */
async function analyzeParameters(tableName) {
  console.log('\n📊 参数影响分析\n');

  // 止损参数分析
  console.log('### 止损参数分析\n');
  const [stopLossResults] = await db.query(`
    SELECT
      JSON_EXTRACT(parameters, '$.risk.stopLossPercent') as stop_loss,
      COUNT(*) as count,
      AVG(total_pnl) as avg_pnl,
      MAX(total_pnl) as max_pnl,
      AVG(win_rate) as avg_win_rate
    FROM ${tableName}
    WHERE total_trades > 50
    GROUP BY stop_loss
    ORDER BY avg_pnl DESC
  `);

  console.log('| 止损 | 策略数 | 平均盈亏 | 最高盈亏 | 平均胜率 |');
  console.log('|------|--------|----------|----------|----------|');
  stopLossResults.forEach(row => {
    const sl = row.stop_loss === null ? 'null' : `${row.stop_loss}%`;
    console.log(`| ${sl.padEnd(4)} | ${String(row.count).padStart(6)} | $${parseFloat(row.avg_pnl).toFixed(2).padStart(7)} | $${parseFloat(row.max_pnl).toFixed(2).padStart(7)} | ${(parseFloat(row.avg_win_rate) * 100).toFixed(1)}% |`);
  });

  // 止盈参数分析
  console.log('\n### 止盈参数分析\n');
  const [takeProfitResults] = await db.query(`
    SELECT
      JSON_EXTRACT(parameters, '$.risk.takeProfitPercent') as take_profit,
      COUNT(*) as count,
      AVG(total_pnl) as avg_pnl,
      MAX(total_pnl) as max_pnl,
      AVG(win_rate) as avg_win_rate
    FROM ${tableName}
    WHERE total_trades > 50
    GROUP BY take_profit
    ORDER BY avg_pnl DESC
  `);

  console.log('| 止盈 | 策略数 | 平均盈亏 | 最高盈亏 | 平均胜率 |');
  console.log('|------|--------|----------|----------|----------|');
  takeProfitResults.forEach(row => {
    const tp = row.take_profit === null ? 'null' : `${row.take_profit}%`;
    console.log(`| ${tp.padEnd(4)} | ${String(row.count).padStart(6)} | $${parseFloat(row.avg_pnl).toFixed(2).padStart(7)} | $${parseFloat(row.max_pnl).toFixed(2).padStart(7)} | ${(parseFloat(row.avg_win_rate) * 100).toFixed(1)}% |`);
  });

  // 持仓时间分析
  console.log('\n### 持仓时间分析\n');
  const [holdTimeResults] = await db.query(`
    SELECT
      JSON_EXTRACT(parameters, '$.risk.maxHoldMinutes') as hold_minutes,
      COUNT(*) as count,
      AVG(total_pnl) as avg_pnl,
      MAX(total_pnl) as max_pnl
    FROM ${tableName}
    WHERE total_trades > 50
    GROUP BY hold_minutes
    ORDER BY avg_pnl DESC
  `);

  console.log('| 持仓时间 | 策略数 | 平均盈亏 | 最高盈亏 |');
  console.log('|----------|--------|----------|----------|');
  holdTimeResults.forEach(row => {
    const hold = row.hold_minutes === null ? 'null' : `${row.hold_minutes}分`;
    console.log(`| ${hold.padEnd(8)} | ${String(row.count).padStart(6)} | $${parseFloat(row.avg_pnl).toFixed(2).padStart(7)} | $${parseFloat(row.max_pnl).toFixed(2).padStart(7)} |`);
  });
}

/**
 * 分析退出原因
 */
async function analyzeExitReasons(tableName) {
  console.log('\n📊 退出原因分析\n');

  // 获取策略列表
  const [strategies] = await db.query(
    `SELECT DISTINCT strategy_name FROM ${tableName} ORDER BY total_pnl DESC LIMIT 5`
  );

  for (const strategy of strategies) {
    console.log(`\n### ${strategy.strategy_name}\n`);

    const [exitReasons] = await db.query(
      `SELECT
        exit_reason,
        COUNT(*) as count,
        SUM(pnl) as total_pnl,
        AVG(pnl) as avg_pnl,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) / COUNT(*) as win_rate
       FROM trades
       WHERE strategy_name LIKE ?
       GROUP BY exit_reason
       ORDER BY count DESC`,
      [`%${strategy.strategy_name}%`]
    );

    console.log('| 退出原因 | 次数 | 总盈亏 | 平均盈亏 | 胜率 |');
    console.log('|----------|------|--------|----------|------|');
    exitReasons.forEach(row => {
      const reason = (row.exit_reason || 'unknown').padEnd(15);
      const count = String(row.count).padStart(5);
      const totalPnl = parseFloat(row.total_pnl).toFixed(2).padStart(10);
      const avgPnl = parseFloat(row.avg_pnl).toFixed(2).padStart(8);
      const winRate = (parseFloat(row.win_rate) * 100).toFixed(1) + '%';
      console.log(`| ${reason} | ${count} | $${totalPnl} | $${avgPnl} | ${winRate.padStart(5)} |`);
    });
  }
}

/**
 * 生成总结
 */
async function generateSummary(tableName) {
  console.log('\n📈 训练总结\n');

  const [summary] = await db.query(`
    SELECT
      COUNT(*) as total_strategies,
      SUM(total_trades) as total_trades,
      AVG(win_rate) as avg_win_rate,
      MAX(total_pnl) as max_pnl,
      MIN(total_pnl) as min_pnl,
      AVG(total_pnl) as avg_pnl
    FROM ${tableName}
    WHERE total_trades > 0
  `);

  const stats = summary[0];

  console.log(`- 总策略数: ${stats.total_strategies}`);
  console.log(`- 总交易数: ${stats.total_trades}`);
  console.log(`- 平均胜率: ${(parseFloat(stats.avg_win_rate) * 100).toFixed(1)}%`);
  console.log(`- 最高盈亏: $${parseFloat(stats.max_pnl).toFixed(2)}`);
  console.log(`- 最低盈亏: $${parseFloat(stats.min_pnl).toFixed(2)}`);
  console.log(`- 平均盈亏: $${parseFloat(stats.avg_pnl).toFixed(2)}`);
}

/**
 * 显示Top策略
 */
function displayTopStrategies(results) {
  console.log('\n🏆 Top 策略\n');
  console.log('| 排名 | 策略名称 | 类型 | 交易数 | 胜率 | 总盈亏 | 评分 |');
  console.log('|------|----------|------|--------|------|--------|------|');

  results.forEach((row, i) => {
    const rank = String(i + 1).padStart(4);
    const name = row.strategy_name.substring(0, 30);
    const type = (row.strategy_type || '').padEnd(8);
    const trades = String(row.total_trades || 0).padStart(6);
    const winRate = (parseFloat(row.win_rate) * 100).toFixed(1) + '%';
    const pnl = '$' + parseFloat(row.total_pnl).toFixed(2);
    const score = parseFloat(row.score).toFixed(2);

    console.log(`| ${rank} | ${name} | ${type} | ${trades} | ${winRate.padStart(5)} | ${pnl.padStart(9)} | ${score.padStart(6)} |`);
  });
}

/**
 * 主函数
 */
async function main() {
  const tableName = process.argv[2];
  const topN = parseInt(process.argv[3]) || 10;

  if (!tableName) {
    console.error('❌ 请指定结果表名');
    console.error('\n使用方法:');
    console.error('  node scripts/analyze.js <table-name> [top-n]');
    console.error('\n示例:');
    console.error('  node scripts/analyze.js backtest_results_2024_v3_optimized 10');
    process.exit(1);
  }

  try {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    策略分析系统                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\n📋 分析表: ${tableName}\n`);

    // 1. 生成总结
    await generateSummary(tableName);

    // 2. 查询Top策略
    const topStrategies = await queryTopStrategies(tableName, topN);
    displayTopStrategies(topStrategies);

    // 3. 参数分析
    await analyzeParameters(tableName);

    // 4. 退出原因分析
    await analyzeExitReasons(tableName);

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                  分析完成！                                ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ 分析失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await db.end();
  }
}

// 执行
if (require.main === module) {
  main();
}

module.exports = { main, queryTopStrategies, analyzeParameters };
