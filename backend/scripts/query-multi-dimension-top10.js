/**
 * 多维度Top 10查询
 * 分别按胜率、盈亏比(总盈亏)、综合评分选出Top 10
 */

const db = require('../config/database');

async function main() {
  console.log('='.repeat(80));
  console.log('📊 2025年回测 - 多维度Top 10策略');
  console.log('='.repeat(80));
  console.log('');

  try {
    // 检查哪个表有数据
    let tableName = null;

    // 先检查策略分组表
    const [fullTable] = await db.query(`SHOW TABLES LIKE 'backtest_results_2025_full'`);
    if (fullTable.length > 0) {
      const [countFull] = await db.query(`SELECT COUNT(*) as count FROM backtest_results_2025_full`);
      if (countFull[0].count > 0) {
        tableName = 'backtest_results_2025_full';
        console.log(`📦 使用表: ${tableName} (策略分组回测)\n`);
      }
    }

    // 如果没有,检查月度表
    if (!tableName) {
      const [monthTable] = await db.query(`SHOW TABLES LIKE 'backtest_results_2025_01'`);
      if (monthTable.length > 0) {
        const [countMonth] = await db.query(`SELECT COUNT(*) as count FROM backtest_results_2025_01`);
        if (countMonth[0].count > 0) {
          tableName = 'backtest_results_2025_01';
          console.log(`📦 使用表: ${tableName} (1月数据)\n`);
        }
      }
    }

    if (!tableName) {
      console.error('❌ 没有找到任何回测结果表!');
      process.exit(1);
    }

    // 配置参数
    const MIN_TRADES = 50;  // 最小交易次数要求
    console.log(`⚙️  筛选条件: 最小交易次数 >= ${MIN_TRADES}\n`);

    // 1. 按胜率排序 Top 10
    console.log('='.repeat(80));
    console.log('\n🏆 Top 10 - 按胜率排序:\n');
    console.log('='.repeat(80));
    console.log('');

    const [topByWinRate] = await db.query(`
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
      FROM ${tableName}
      WHERE total_trades >= ?
      ORDER BY win_rate DESC, total_pnl DESC
      LIMIT 10
    `, [MIN_TRADES]);

    topByWinRate.forEach((row, index) => {
      console.log(`${index + 1}. ${row.strategy_name}`);
      console.log(`   类型: ${row.strategy_type}`);
      console.log(`   交易次数: ${row.total_trades}`);
      console.log(`   胜率: ${row.win_rate_pct}% ⭐`);
      console.log(`   总盈亏: $${row.total_pnl}`);
      console.log(`   夏普比率: ${row.sharpe_ratio}`);
      console.log(`   盈利因子: ${row.profit_factor}`);
      console.log(`   最大回撤: ${row.max_drawdown_pct}%`);
      console.log(`   综合评分: ${row.score}`);
      console.log('');
    });

    // 2. 按总盈亏排序 Top 10
    console.log('='.repeat(80));
    console.log('\n💰 Top 10 - 按总盈亏排序:\n');
    console.log('='.repeat(80));
    console.log('');

    const [topByPnl] = await db.query(`
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
      FROM ${tableName}
      WHERE total_trades >= ?
      ORDER BY total_pnl DESC
      LIMIT 10
    `, [MIN_TRADES]);

    topByPnl.forEach((row, index) => {
      console.log(`${index + 1}. ${row.strategy_name}`);
      console.log(`   类型: ${row.strategy_type}`);
      console.log(`   交易次数: ${row.total_trades}`);
      console.log(`   胜率: ${row.win_rate_pct}%`);
      console.log(`   总盈亏: $${row.total_pnl} ⭐`);
      console.log(`   夏普比率: ${row.sharpe_ratio}`);
      console.log(`   盈利因子: ${row.profit_factor}`);
      console.log(`   最大回撤: ${row.max_drawdown_pct}%`);
      console.log(`   综合评分: ${row.score}`);
      console.log('');
    });

    // 3. 按盈利因子排序 Top 10
    console.log('='.repeat(80));
    console.log('\n📈 Top 10 - 按盈利因子排序:\n');
    console.log('='.repeat(80));
    console.log('');

    const [topByProfitFactor] = await db.query(`
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
      FROM ${tableName}
      WHERE total_trades >= ?
      ORDER BY profit_factor DESC, total_pnl DESC
      LIMIT 10
    `, [MIN_TRADES]);

    topByProfitFactor.forEach((row, index) => {
      console.log(`${index + 1}. ${row.strategy_name}`);
      console.log(`   类型: ${row.strategy_type}`);
      console.log(`   交易次数: ${row.total_trades}`);
      console.log(`   胜率: ${row.win_rate_pct}%`);
      console.log(`   总盈亏: $${row.total_pnl}`);
      console.log(`   夏普比率: ${row.sharpe_ratio}`);
      console.log(`   盈利因子: ${row.profit_factor} ⭐`);
      console.log(`   最大回撤: ${row.max_drawdown_pct}%`);
      console.log(`   综合评分: ${row.score}`);
      console.log('');
    });

    // 4. 按夏普比率排序 Top 10
    console.log('='.repeat(80));
    console.log('\n📊 Top 10 - 按夏普比率排序:\n');
    console.log('='.repeat(80));
    console.log('');

    const [topBySharpe] = await db.query(`
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
      FROM ${tableName}
      WHERE total_trades >= ?
      ORDER BY sharpe_ratio DESC, total_pnl DESC
      LIMIT 10
    `, [MIN_TRADES]);

    topBySharpe.forEach((row, index) => {
      console.log(`${index + 1}. ${row.strategy_name}`);
      console.log(`   类型: ${row.strategy_type}`);
      console.log(`   交易次数: ${row.total_trades}`);
      console.log(`   胜率: ${row.win_rate_pct}%`);
      console.log(`   总盈亏: $${row.total_pnl}`);
      console.log(`   夏普比率: ${row.sharpe_ratio} ⭐`);
      console.log(`   盈利因子: ${row.profit_factor}`);
      console.log(`   最大回撤: ${row.max_drawdown_pct}%`);
      console.log(`   综合评分: ${row.score}`);
      console.log('');
    });

    // 5. 按综合评分排序 Top 10
    console.log('='.repeat(80));
    console.log('\n🌟 Top 10 - 按综合评分排序:\n');
    console.log('='.repeat(80));
    console.log('');

    const [topByScore] = await db.query(`
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
      FROM ${tableName}
      WHERE total_trades >= ?
      ORDER BY score DESC
      LIMIT 10
    `, [MIN_TRADES]);

    topByScore.forEach((row, index) => {
      console.log(`${index + 1}. ${row.strategy_name}`);
      console.log(`   类型: ${row.strategy_type}`);
      console.log(`   交易次数: ${row.total_trades}`);
      console.log(`   胜率: ${row.win_rate_pct}%`);
      console.log(`   总盈亏: $${row.total_pnl}`);
      console.log(`   夏普比率: ${row.sharpe_ratio}`);
      console.log(`   盈利因子: ${row.profit_factor}`);
      console.log(`   最大回撤: ${row.max_drawdown_pct}%`);
      console.log(`   综合评分: ${row.score} ⭐`);
      console.log('');
    });

    // 6. 统计分析
    console.log('='.repeat(80));
    console.log('\n📊 统计分析:\n');
    console.log('='.repeat(80));
    console.log('');

    // 收集所有Top策略名称(去重)
    const allTopStrategies = new Set();
    topByWinRate.forEach(s => allTopStrategies.add(s.strategy_name));
    topByPnl.forEach(s => allTopStrategies.add(s.strategy_name));
    topByProfitFactor.forEach(s => allTopStrategies.add(s.strategy_name));
    topBySharpe.forEach(s => allTopStrategies.add(s.strategy_name));
    topByScore.forEach(s => allTopStrategies.add(s.strategy_name));

    console.log(`独特策略总数: ${allTopStrategies.size} (从5个Top 10榜单中)`);
    console.log('');

    // 找出出现在多个榜单的策略
    const strategyAppearances = new Map();

    [topByWinRate, topByPnl, topByProfitFactor, topBySharpe, topByScore].forEach((topList, listIndex) => {
      const listName = ['胜率', '总盈亏', '盈利因子', '夏普比率', '综合评分'][listIndex];
      topList.forEach(s => {
        if (!strategyAppearances.has(s.strategy_name)) {
          strategyAppearances.set(s.strategy_name, []);
        }
        strategyAppearances.get(s.strategy_name).push(listName);
      });
    });

    // 显示出现在多个榜单的策略
    console.log('🔥 出现在多个榜单的策略:\n');
    const multiAppearance = Array.from(strategyAppearances.entries())
      .filter(([_, lists]) => lists.length >= 2)
      .sort((a, b) => b[1].length - a[1].length);

    if (multiAppearance.length > 0) {
      multiAppearance.forEach(([name, lists]) => {
        console.log(`  ${name}`);
        console.log(`    出现在: ${lists.join(', ')} (${lists.length}个榜单)`);
        console.log('');
      });
    } else {
      console.log('  没有策略出现在多个榜单中\n');
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
