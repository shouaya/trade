const db = require('../config/database');

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    year: new Date().getUTCFullYear(),
    tableName: null,
    minTrades: 50
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--year=')) parsed.year = parseInt(arg.split('=')[1], 10);
    else if (arg === '--year') parsed.year = parseInt(args[++i], 10);
    else if (arg.startsWith('--table=')) parsed.tableName = arg.split('=')[1];
    else if (arg === '--table') parsed.tableName = args[++i];
    else if (arg.startsWith('--minTrades=')) parsed.minTrades = parseInt(arg.split('=')[1], 10);
    else if (arg === '--minTrades') parsed.minTrades = parseInt(args[++i], 10);
  }

  return parsed;
}

async function pickResultTable(year, explicitTableName) {
  if (explicitTableName) return explicitTableName;

  const fullTable = `backtest_results_${year}_full`;
  const [fullTableRows] = await db.query(`SHOW TABLES LIKE ?`, [fullTable]);
  if (fullTableRows.length > 0) {
    const [count] = await db.query(`SELECT COUNT(*) as count FROM ${fullTable}`);
    if (count[0].count > 0) return fullTable;
  }

  const monthTable = `backtest_results_${year}_01`;
  const [monthTableRows] = await db.query(`SHOW TABLES LIKE ?`, [monthTable]);
  if (monthTableRows.length > 0) {
    const [count] = await db.query(`SELECT COUNT(*) as count FROM ${monthTable}`);
    if (count[0].count > 0) return monthTable;
  }

  return null;
}

async function queryTop(tableName, minTrades, orderBy) {
  const [rows] = await db.query(
    `
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
    ORDER BY ${orderBy}
    LIMIT 10
    `,
    [minTrades]
  );
  return rows;
}

function printTop(title, rows, highlight) {
  console.log('='.repeat(80));
  console.log(`\n${title}\n`);
  console.log('='.repeat(80));
  console.log('');

  rows.forEach((row, index) => {
    console.log(`${index + 1}. ${row.strategy_name}`);
    console.log(`   类型: ${row.strategy_type}`);
    console.log(`   交易次数: ${row.total_trades}`);
    console.log(`   胜率: ${row.win_rate_pct}%${highlight === 'win_rate' ? ' ⭐' : ''}`);
    console.log(`   总盈亏: $${row.total_pnl}${highlight === 'total_pnl' ? ' ⭐' : ''}`);
    console.log(`   夏普比率: ${row.sharpe_ratio}${highlight === 'sharpe_ratio' ? ' ⭐' : ''}`);
    console.log(`   盈利因子: ${row.profit_factor}${highlight === 'profit_factor' ? ' ⭐' : ''}`);
    console.log(`   最大回撤: ${row.max_drawdown_pct}%`);
    console.log(`   综合评分: ${row.score}${highlight === 'score' ? ' ⭐' : ''}`);
    console.log('');
  });
}

async function main() {
  const { year, tableName: explicitTableName, minTrades } = parseCliArgs(process.argv);

  console.log('='.repeat(80));
  console.log(`📊 ${year}年回测 - 多维度Top 10策略`);
  console.log('='.repeat(80));
  console.log('');

  try {
    const tableName = await pickResultTable(year, explicitTableName);
    if (!tableName) {
      console.error('❌ 没有找到任何回测结果表!');
      process.exit(1);
    }

    console.log(`📦 使用表: ${tableName}\n`);
    console.log(`⚙️  筛选条件: 最小交易次数 >= ${minTrades}\n`);

    const topByWinRate = await queryTop(tableName, minTrades, 'win_rate DESC, total_pnl DESC');
    const topByPnl = await queryTop(tableName, minTrades, 'total_pnl DESC');
    const topByProfitFactor = await queryTop(tableName, minTrades, 'profit_factor DESC, total_pnl DESC');
    const topBySharpe = await queryTop(tableName, minTrades, 'sharpe_ratio DESC, total_pnl DESC');
    const topByScore = await queryTop(tableName, minTrades, 'score DESC');

    printTop('🏆 Top 10 - 按胜率排序:', topByWinRate, 'win_rate');
    printTop('💰 Top 10 - 按总盈亏排序:', topByPnl, 'total_pnl');
    printTop('📈 Top 10 - 按盈利因子排序:', topByProfitFactor, 'profit_factor');
    printTop('📊 Top 10 - 按夏普比率排序:', topBySharpe, 'sharpe_ratio');
    printTop('🌟 Top 10 - 按综合评分排序:', topByScore, 'score');

    console.log('='.repeat(80));
    console.log('\n📊 统计分析:\n');
    console.log('='.repeat(80));
    console.log('');

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

    console.log(`独特策略总数: ${strategyAppearances.size} (从5个Top 10榜单中)\n`);
    console.log('🔥 出现在多个榜单的策略:\n');

    const multiAppearance = Array.from(strategyAppearances.entries())
      .filter(([, lists]) => lists.length >= 2)
      .sort((a, b) => b[1].length - a[1].length);

    if (multiAppearance.length === 0) {
      console.log('  没有策略出现在多个榜单中\n');
    } else {
      multiAppearance.forEach(([name, lists]) => {
        console.log(`  ${name}`);
        console.log(`    出现在: ${lists.join(', ')} (${lists.length}个榜单)\n`);
      });
    }

    console.log('='.repeat(80));
    console.log('');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 查询失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
