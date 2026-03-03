/**
 * 2025年按月并行回测脚本模板
 * 每个进程负责一个月的数据,12个进程并行执行
 */

const db = require('../config/database');
const StrategyExecutor = require('../services/strategy-executor');
const { generateStrategyCombinations } = require('../services/strategy-parameter-generator');

// ========== 配置项 (由启动脚本替换) ==========
const MONTH_NUMBER = 2;  // 月份: 1-12
const MONTH_STR = '02';      // 月份字符串: '01'-'12'
const START_DATE = '2025-02-01';    // 开始日期: '2025-01-01'
const END_DATE = '2025-02-28';        // 结束日期: '2025-01-31'
const TABLE_SUFFIX = '2025_02'; // 表后缀: '2025_01'
// =============================================

const SYMBOL = 'USDJPY';
const INTERVAL = '1min';
const YEAR_PREFIX = '2025';

/**
 * 主函数
 */
async function main() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 2025年第${MONTH_NUMBER}月并行回测 (${START_DATE} ~ ${END_DATE})`);
  console.log(`${'='.repeat(80)}\n`);

  const overallStartTime = Date.now();

  try {
    // 1. 加载该月的K线数据 (包含预热期以正确计算RSI/MACD)
    console.log(`📊 加载 ${MONTH_NUMBER}月 K线数据 (含预热期)...`);

    // 为了正确计算RSI和MACD,需要加载额外的历史数据
    // MACD(12,26,9)需要至少35个周期,保守起见加载60天预热期
    const WARMUP_DAYS = 60;
    const monthStartTime = new Date(START_DATE + 'T00:00:00Z').getTime();
    const endTime = new Date(END_DATE + 'T23:59:59Z').getTime();

    // 预热期开始时间: 往前推60天 (对于1分钟K线约86400根)
    const warmupStartTime = monthStartTime - (WARMUP_DAYS * 24 * 60 * 60 * 1000);

    const [klines] = await db.query(`
      SELECT * FROM klines
      WHERE symbol = ? AND interval_type = ?
        AND open_time >= ? AND open_time <= ?
      ORDER BY open_time ASC
    `, [SYMBOL, INTERVAL, warmupStartTime, endTime]);

    if (klines.length === 0) {
      console.error(`\n❌ 没有找到 ${MONTH_NUMBER}月 的K线数据！`);
      process.exit(1);
    }

    // 找到实际月份开始的索引 (用于统计)
    const monthStartIndex = klines.findIndex(k => parseInt(k.open_time) >= monthStartTime);
    const warmupBars = monthStartIndex >= 0 ? monthStartIndex : 0;

    console.log(`✅ 加载了 ${klines.length.toLocaleString()} 条K线数据`);
    console.log(`   完整范围: ${new Date(parseInt(klines[0].open_time)).toISOString()}`);
    console.log(`            ~ ${new Date(parseInt(klines[klines.length - 1].open_time)).toISOString()}`);
    console.log(`   预热期: ${warmupBars.toLocaleString()} 根K线 (用于RSI/MACD计算)`);
    console.log(`   有效数据: ${(klines.length - warmupBars).toLocaleString()} 根K线\n`);

    // 2. 生成所有策略组合
    console.log('🔧 生成策略组合...');
    const strategies = generateStrategyCombinations();
    console.log(`✅ 生成了 ${strategies.length.toLocaleString()} 个策略组合\n`);

    // 3. 创建该月专用的结果表
    console.log(`📦 准备结果表 backtest_results_${TABLE_SUFFIX}...`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS backtest_results_${TABLE_SUFFIX} (
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
        INDEX idx_strategy_name (strategy_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ 结果表准备完成\n');

    // 4. 检查是否有断点续传 (已完成的策略)
    console.log(`🔍 检查断点续传...\n`);
    const [completedStrategies] = await db.query(`
      SELECT strategy_name FROM backtest_results_${TABLE_SUFFIX}
    `);
    const completedSet = new Set(completedStrategies.map(s => s.strategy_name));
    const startIndex = completedSet.size;

    if (startIndex > 0) {
      console.log(`⚠️  发现 ${startIndex} 个已完成的策略,将从第 ${startIndex + 1} 个策略继续\n`);
    } else {
      console.log(`✅ 从头开始回测\n`);
    }

    // 5. 批量回测 (更小的批次,更频繁落库)
    console.log(`⚙️  开始回测 ${strategies.length.toLocaleString()} 个策略...\n`);
    console.log(`${'='.repeat(80)}\n`);

    const BATCH_SIZE = 10; // 减小到10,更频繁落库防止内存溢出
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

      // 更频繁的批量插入 (每10条)
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

          await db.query(`
            INSERT INTO backtest_results_${TABLE_SUFFIX}
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
      if ((i + 1) % 1000 === 0 || i === strategies.length - 1) {
        const progress = i + 1;
        const percentage = ((progress / strategies.length) * 100).toFixed(1);
        const elapsed = ((Date.now() - overallStartTime) / 60000).toFixed(2);
        const actualProcessed = validCount + errorCount;
        const rate = actualProcessed / (Date.now() - overallStartTime) * 1000;
        const remaining = (strategies.length - progress) / rate / 60;

        console.log(`[月${MONTH_NUMBER}] 进度: ${progress.toLocaleString()}/${strategies.length.toLocaleString()} (${percentage}%) | ` +
                    `耗时: ${elapsed}分钟 | 剩余: ${remaining.toFixed(1)}分钟 | ` +
                    `成功: ${validCount} | 失败: ${errorCount} | 跳过: ${skippedCount}`);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`\n✅ ${MONTH_NUMBER}月 回测完成!`);
    console.log(`   有效策略: ${validCount}/${strategies.length}`);
    console.log(`   失败策略: ${errorCount}`);
    console.log(`   跳过策略: ${skippedCount} (断点续传)`);

    // 5. 查询Top 10
    console.log(`\n🏆 ${MONTH_NUMBER}月 Top 10 策略:\n`);
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
      FROM backtest_results_${TABLE_SUFFIX}
      WHERE total_trades >= 10
      ORDER BY score DESC
      LIMIT 10
    `);

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
    console.log(`✨ ${MONTH_NUMBER}月 总耗时: ${totalElapsed} 分钟\n`);

    process.exit(0);

  } catch (error) {
    console.error(`\n❌ ${MONTH_NUMBER}月 回测失败:`, error);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行
main();
