/**
 * 2025年按策略分组的并行回测脚本模板
 * 每个进程负责一组策略,在完整的2025年数据(1-12月)上进行回测
 */

const db = require('../config/database');
const StrategyExecutor = require('../services/strategy-executor');
const { generateStrategyCombinations } = require('../services/strategy-parameter-generator');

// ========== 配置项 (由启动脚本替换) ==========
const GROUP_NUMBER = 4;    // 组号: 1-10
const START_INDEX = 5544;      // 起始策略索引: 0, 56020, 112040, ...
const END_INDEX = 7391;          // 结束策略索引: 56019, 112039, ...
// =============================================

const SYMBOL = 'USDJPY';
const INTERVAL = '1min';
const YEAR = '2025';

// 2025年完整日期范围 (含60天预热期)
const WARMUP_DAYS = 60;
const YEAR_START = '2025-01-01T00:00:00Z';
const YEAR_END = '2025-12-31T23:59:59Z';

/**
 * 主函数
 */
async function main() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 2025年策略组${GROUP_NUMBER}并行回测`);
  console.log(`   策略范围: #${START_INDEX} ~ #${END_INDEX}`);
  console.log(`   策略数量: ${END_INDEX - START_INDEX + 1}`);
  console.log(`${'='.repeat(80)}\n`);

  const overallStartTime = Date.now();

  try {
    // 1. 加载2025年完整K线数据 (含60天预热期)
    console.log(`📊 加载2025年完整K线数据 (含60天预热期)...\n`);

    const yearStartTime = new Date(YEAR_START).getTime();
    const yearEndTime = new Date(YEAR_END).getTime();
    const warmupStartTime = yearStartTime - (WARMUP_DAYS * 24 * 60 * 60 * 1000);

    const [klines] = await db.query(`
      SELECT * FROM klines
      WHERE symbol = ? AND interval_type = ?
        AND open_time >= ? AND open_time <= ?
      ORDER BY open_time ASC
    `, [SYMBOL, INTERVAL, warmupStartTime, yearEndTime]);

    if (klines.length === 0) {
      console.error(`\n❌ 没有找到2025年的K线数据！`);
      process.exit(1);
    }

    // 找到2025年实际开始的索引
    const yearStartIndex = klines.findIndex(k => parseInt(k.open_time) >= yearStartTime);
    const warmupBars = yearStartIndex >= 0 ? yearStartIndex : 0;

    console.log(`✅ 加载了 ${klines.length.toLocaleString()} 条K线数据`);
    console.log(`   完整范围: ${new Date(parseInt(klines[0].open_time)).toISOString()}`);
    console.log(`            ~ ${new Date(parseInt(klines[klines.length - 1].open_time)).toISOString()}`);
    console.log(`   预热期: ${warmupBars.toLocaleString()} 根K线 (用于RSI/MACD计算)`);
    console.log(`   2025年有效数据: ${(klines.length - warmupBars).toLocaleString()} 根K线\n`);

    // 2. 生成所有策略组合
    console.log('🔧 生成策略组合...');
    const allStrategies = generateStrategyCombinations();
    console.log(`✅ 总共 ${allStrategies.length.toLocaleString()} 个策略\n`);

    // 3. 提取当前组的策略
    const strategies = allStrategies.slice(START_INDEX, END_INDEX + 1);
    console.log(`📦 当前组策略数: ${strategies.length.toLocaleString()}\n`);

    // 4. 创建结果表 (所有组共用一张表)
    console.log(`📦 准备结果表 backtest_results_2025_full...`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS backtest_results_2025_full (
        id INT AUTO_INCREMENT PRIMARY KEY,
        strategy_id INT NOT NULL,
        strategy_name VARCHAR(255) NOT NULL,
        strategy_type VARCHAR(50) NOT NULL,
        parameters JSON NOT NULL,
        total_trades INT DEFAULT 0,
        win_rate DECIMAL(5, 4) DEFAULT 0,
        total_pnl DECIMAL(10, 2) DEFAULT 0,
        avg_pnl DECIMAL(10, 2) DEFAULT 0,
        sharpe_ratio DECIMAL(10, 3) DEFAULT 0,
        profit_factor DECIMAL(10, 2) DEFAULT 0,
        max_drawdown DECIMAL(5, 4) DEFAULT 0,
        score DECIMAL(10, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_score (score DESC),
        INDEX idx_strategy_name (strategy_name),
        UNIQUE KEY unique_strategy_name (strategy_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ 结果表准备完成\n');

    // 5. 检查断点续传 (已完成的策略)
    console.log(`🔍 检查断点续传...\n`);
    const [completedStrategies] = await db.query(`
      SELECT strategy_name FROM backtest_results_2025_full
      WHERE strategy_name IN (${strategies.map(() => '?').join(',')})
    `, strategies.map(s => s.name));

    const completedSet = new Set(completedStrategies.map(s => s.strategy_name));

    if (completedSet.size > 0) {
      console.log(`⚠️  发现 ${completedSet.size} 个已完成的策略,将跳过\n`);
    } else {
      console.log(`✅ 从头开始回测\n`);
    }

    // 6. 批量回测
    console.log(`⚙️  开始回测 ${strategies.length.toLocaleString()} 个策略...\n`);
    console.log(`${'='.repeat(80)}\n`);

    const BATCH_SIZE = 10; // 每10个策略落库一次
    const results = [];
    let validCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];

      // 断点续传: 跳过已完成的策略
      if (completedSet.has(strategy.name)) {
        skippedCount++;
        continue;
      }

      try {
        const executor = new StrategyExecutor(strategy, klines);
        const result = await executor.execute();
        const stats = result.stats;

        // 计算综合评分
        const score = (
          stats.totalPnl * 0.3 +
          stats.winRate * 50 * 0.2 +
          stats.sharpeRatio * 10 * 0.25 +
          stats.profitFactor * 5 * 0.15 +
          (1 - stats.maxDrawdown) * 20 * 0.1
        );

        results.push({
          strategyId: strategy.id,
          strategyName: strategy.name,
          strategyType: strategy.type,
          parameters: JSON.stringify(strategy.parameters),
          totalTrades: stats.totalTrades,
          winRate: stats.winRate,
          totalPnl: stats.totalPnl,
          avgPnl: stats.avgPnl,
          sharpeRatio: stats.sharpeRatio,
          profitFactor: stats.profitFactor,
          maxDrawdown: stats.maxDrawdown,
          score: score
        });

        validCount++;

      } catch (error) {
        errorCount++;
        if (errorCount <= 5) {
          console.error(`   ⚠️  策略 ${strategy.name} 失败: ${error.message}`);
        }
      }

      // 批量插入 (每10条或最后一条)
      if (results.length >= BATCH_SIZE || i === strategies.length - 1) {
        if (results.length > 0) {
          const values = results.map(r => [
            r.strategyId,
            r.strategyName,
            r.strategyType,
            r.parameters,
            r.totalTrades,
            r.winRate,
            r.totalPnl,
            r.avgPnl,
            r.sharpeRatio,
            r.profitFactor,
            r.maxDrawdown,
            r.score
          ]);

          // 使用 INSERT IGNORE 避免重复插入
          await db.query(`
            INSERT IGNORE INTO backtest_results_2025_full
            (strategy_id, strategy_name, strategy_type, parameters,
             total_trades, win_rate, total_pnl, avg_pnl,
             sharpe_ratio, profit_factor, max_drawdown, score)
            VALUES ?
          `, [values]);

          // 立即清空数组释放内存
          results.length = 0;

          // 强制GC (如果可用)
          if (global.gc) {
            global.gc();
          }
        }
      }

      // 进度报告
      if ((i + 1) % 500 === 0 || i === strategies.length - 1) {
        const progress = i + 1;
        const percentage = ((progress / strategies.length) * 100).toFixed(1);
        const elapsed = ((Date.now() - overallStartTime) / 60000).toFixed(2);
        const actualProcessed = validCount + errorCount;
        const rate = actualProcessed / (Date.now() - overallStartTime) * 1000;
        const remaining = (strategies.length - progress) / rate / 60;

        console.log(`[组${GROUP_NUMBER}] 进度: ${progress.toLocaleString()}/${strategies.length.toLocaleString()} (${percentage}%) | ` +
                    `耗时: ${elapsed}分钟 | 剩余: ${remaining.toFixed(1)}分钟 | ` +
                    `成功: ${validCount} | 失败: ${errorCount} | 跳过: ${skippedCount}`);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`\n✅ 组${GROUP_NUMBER} 回测完成!`);
    console.log(`   有效策略: ${validCount}/${strategies.length}`);
    console.log(`   失败策略: ${errorCount}`);
    console.log(`   跳过策略: ${skippedCount} (断点续传)`);

    // 7. 查询当前组的Top 10
    console.log(`\n🏆 组${GROUP_NUMBER} Top 10策略:\n`);
    const strategyNames = strategies.map(s => s.name);
    const placeholders = strategyNames.map(() => '?').join(',');

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
      WHERE strategy_name IN (${placeholders})
        AND total_trades >= 10
      ORDER BY score DESC
      LIMIT 10
    `, strategyNames);

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

    const totalElapsed = ((Date.now() - overallStartTime) / 60000).toFixed(2);
    console.log(`${'='.repeat(80)}`);
    console.log(`✨ 组${GROUP_NUMBER} 总耗时: ${totalElapsed} 分钟 (${(totalElapsed / 60).toFixed(2)} 小时)\n`);

    process.exit(0);

  } catch (error) {
    console.error(`\n❌ 组${GROUP_NUMBER} 回测失败:`, error);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行
main();
