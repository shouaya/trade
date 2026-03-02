/**
 * 批量回测执行脚本
 * 用于执行多个策略的回测并生成报告
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { RSIStrategy } = require('../strategies/rsi-strategy');
const { runBacktest } = require('../strategies/backtest-engine');
const { generateRSIStrategies } = require('../strategies/strategy-generator');
const { generateHTMLReport } = require('../strategies/report-generator');

// 数据库配置
const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'rootpassword',
  database: 'trading'
};

/**
 * 从数据库加载K线数据
 * @param {Object} params - 查询参数
 * @returns {Array} K线数据数组
 */
async function loadKlineData(params) {
  const { symbol, interval, startDate, endDate } = params;

  const connection = await mysql.createConnection(dbConfig);

  try {
    let query = 'SELECT * FROM klines WHERE symbol = ? AND interval_type = ?';
    const queryParams = [symbol, interval];

    if (startDate && endDate) {
      const startTimestamp = new Date(startDate).getTime();
      const endTimestamp = new Date(endDate).getTime();
      query += ' AND open_time >= ? AND open_time <= ?';
      queryParams.push(startTimestamp, endTimestamp);
    }

    query += ' ORDER BY open_time ASC';

    const [rows] = await connection.execute(query, queryParams);

    console.log(`✅ 加载了 ${rows.length} 条 K 线数据`);
    console.log(`   时间范围: ${new Date(parseInt(rows[0].open_time)).toISOString()} - ${new Date(parseInt(rows[rows.length - 1].open_time)).toISOString()}`);

    // 转换字段名以匹配前端格式
    return rows.map(row => ({
      openTime: row.open_time.toString(),
      open: row.open.toString(),
      high: row.high.toString(),
      low: row.low.toString(),
      close: row.close.toString(),
      volume: row.volume ? row.volume.toString() : '0'
    }));
  } finally {
    await connection.end();
  }
}

/**
 * 执行批量回测
 * @param {Object} options - 回测选项
 */
async function runBatchBacktest(options = {}) {
  const {
    symbol = 'USDJPY',
    interval = '1min',
    startDate = '2025-01-01',
    endDate = '2025-12-31',
    strategyLimit = null // 限制策略数量，用于快速测试
  } = options;

  console.log('\n' + '='.repeat(80));
  console.log('🚀 批量回测开始');
  console.log('='.repeat(80));
  console.log(`📊 回测参数:`);
  console.log(`   交易对: ${symbol}`);
  console.log(`   时间周期: ${interval}`);
  console.log(`   开始日期: ${startDate}`);
  console.log(`   结束日期: ${endDate}`);
  console.log('='.repeat(80) + '\n');

  // 加载K线数据
  console.log('📡 正在加载 K 线数据...');
  const klineData = await loadKlineData({ symbol, interval, startDate, endDate });

  if (klineData.length === 0) {
    console.error('❌ 没有找到K线数据');
    return;
  }

  // 生成策略参数组合
  console.log('\n📋 正在生成策略参数组合...');
  let strategies = generateRSIStrategies();

  if (strategyLimit) {
    strategies = strategies.slice(0, strategyLimit);
  }

  console.log(`✅ 生成了 ${strategies.length} 个策略参数组合\n`);

  // 执行回测
  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < strategies.length; i++) {
    const strategyParams = strategies[i];
    const strategy = new RSIStrategy(strategyParams);

    console.log(`\n[${ i + 1}/${strategies.length}] 回测策略: ${strategy.name}`);

    try {
      const result = runBacktest(strategy, klineData);
      results.push(result);
    } catch (error) {
      console.error(`   ❌ 回测失败: ${error.message}`);
    }
  }

  const endTime = Date.now();
  const totalTime = ((endTime - startTime) / 1000).toFixed(2);

  console.log('\n' + '='.repeat(80));
  console.log('✅ 批量回测完成');
  console.log(`   总耗时: ${totalTime} 秒`);
  console.log(`   回测策略数: ${results.length}`);
  console.log('='.repeat(80) + '\n');

  // 排序：按总盈亏排序
  results.sort((a, b) => b.stats.totalPnl - a.stats.totalPnl);

  // 输出前10名策略
  console.log('🏆 Top 10 最优策略（按总盈亏排序）:\n');
  console.log('排名 | 策略名称 | 交易数 | 胜率(%) | 总盈亏($) | 平均盈亏($) | 夏普比率 | 盈利因子 | 最大回撤($)');
  console.log('-'.repeat(140));

  const top10 = results.slice(0, 10);
  top10.forEach((result, index) => {
    const stats = result.stats;
    console.log(
      `${(index + 1).toString().padStart(4)} | ` +
      `${result.strategy.name.padEnd(60)} | ` +
      `${stats.totalTrades.toString().padStart(6)} | ` +
      `${stats.winRate.toString().padStart(8)} | ` +
      `${stats.totalPnl.toString().padStart(11)} | ` +
      `${stats.avgPnl.toString().padStart(13)} | ` +
      `${stats.sharpeRatio.toString().padStart(10)} | ` +
      `${stats.profitFactor.toString().padStart(10)} | ` +
      `${stats.maxDrawdown.toString().padStart(14)}`
    );
  });

  // 保存结果到文件
  const outputDir = path.join(__dirname, '../backtest-results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outputFile = path.join(outputDir, `backtest_${timestamp}.json`);

  const report = {
    metadata: {
      symbol,
      interval,
      startDate,
      endDate,
      totalStrategies: results.length,
      klineCount: klineData.length,
      executionTime: totalTime,
      timestamp: new Date().toISOString()
    },
    top10,
    allResults: results
  };

  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log(`\n💾 完整结果已保存到: ${outputFile}`);

  // 生成HTML报告
  const htmlFile = outputFile.replace('.json', '.html');
  generateHTMLReport(report, htmlFile);

  return { results, top10, report };
}

/**
 * 对Top 10策略执行完整年度回测
 * @param {Array} top10Strategies - Top 10策略数组
 * @param {Object} options - 回测选项
 */
async function runTop10FullBacktest(top10Strategies, options = {}) {
  const {
    symbol = 'USDJPY',
    interval = '1min',
    startDate = '2025-01-01',
    endDate = '2025-12-31'
  } = options;

  console.log('\n' + '='.repeat(80));
  console.log('🔄 Top 10 策略完整年度回测');
  console.log('='.repeat(80) + '\n');

  // 加载完整年度数据
  console.log('📡 正在加载完整年度 K 线数据...');
  const klineData = await loadKlineData({ symbol, interval, startDate, endDate });

  const results = [];

  for (let i = 0; i < top10Strategies.length; i++) {
    const strategyConfig = top10Strategies[i];
    const strategy = new RSIStrategy(strategyConfig.strategy.params);
    strategy.name = strategyConfig.strategy.name;

    console.log(`\n[${i + 1}/10] 回测策略: ${strategy.name}`);

    try {
      const result = runBacktest(strategy, klineData);
      results.push(result);
    } catch (error) {
      console.error(`   ❌ 回测失败: ${error.message}`);
    }
  }

  // 生成详细报告
  console.log('\n' + '='.repeat(80));
  console.log('📊 详细回测报告');
  console.log('='.repeat(80) + '\n');

  results.forEach((result, index) => {
    const stats = result.stats;
    console.log(`\n${index + 1}. ${result.strategy.name}`);
    console.log('   策略参数:');
    console.log(`      买入阈值: RSI < ${result.strategy.params.buyThreshold}`);
    console.log(`      卖出阈值: RSI > ${result.strategy.params.sellThreshold}`);
    console.log(`      最大持仓时间: ${result.strategy.params.maxHoldMinutes} 分钟`);
    console.log(`      RSI周期: ${result.strategy.params.rsiPeriod}`);
    console.log(`      止损: ${result.strategy.params.stopLossPips || '无'} pips`);
    console.log(`      止盈: ${result.strategy.params.takeProfitPips || '无'} pips`);
    console.log('   回测结果:');
    console.log(`      总交易数: ${stats.totalTrades}`);
    console.log(`      盈利交易: ${stats.winningTrades} (${stats.winRate}%)`);
    console.log(`      亏损交易: ${stats.losingTrades}`);
    console.log(`      总盈亏: $${stats.totalPnl}`);
    console.log(`      平均盈亏: $${stats.avgPnl}`);
    console.log(`      最大单笔盈利: $${stats.maxPnl}`);
    console.log(`      最大单笔亏损: $${stats.minPnl}`);
    console.log(`      总点数: ${stats.totalPips} pips`);
    console.log(`      平均点数: ${stats.avgPips} pips`);
    console.log(`      最大回撤: $${stats.maxDrawdown}`);
    console.log(`      夏普比率: ${stats.sharpeRatio}`);
    console.log(`      盈利因子: ${stats.profitFactor}`);
    console.log(`      总盈利: $${stats.grossProfit}`);
    console.log(`      总亏损: $${stats.grossLoss}`);
  });

  // 保存详细报告
  const outputDir = path.join(__dirname, '../backtest-results');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outputFile = path.join(outputDir, `top10_full_backtest_${timestamp}.json`);

  const report = {
    metadata: {
      symbol,
      interval,
      startDate,
      endDate,
      timestamp: new Date().toISOString()
    },
    results
  };

  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log(`\n💾 详细报告已保存到: ${outputFile}\n`);

  return results;
}

// 命令行执行
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'batch';

  (async () => {
    try {
      if (command === 'batch') {
        // 批量回测
        const strategyLimit = args[1] ? parseInt(args[1]) : null;
        const { top10 } = await runBatchBacktest({ strategyLimit });

        // 对Top 10执行完整回测
        if (top10 && top10.length > 0) {
          console.log('\n⏳ 等待 3 秒后开始 Top 10 完整回测...\n');
          await new Promise(resolve => setTimeout(resolve, 3000));
          await runTop10FullBacktest(top10);
        }
      } else if (command === 'top10') {
        // 从文件加载Top 10并执行完整回测
        const resultFile = args[1];
        if (!resultFile) {
          console.error('❌ 请指定结果文件路径');
          process.exit(1);
        }

        const data = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        await runTop10FullBacktest(data.top10);
      } else {
        console.log('用法:');
        console.log('  node run-backtest.js batch [策略数量限制]  - 执行批量回测');
        console.log('  node run-backtest.js top10 <结果文件>      - 对Top 10执行完整回测');
      }
    } catch (error) {
      console.error('❌ 错误:', error);
      process.exit(1);
    }
  })();
}

module.exports = {
  runBatchBacktest,
  runTop10FullBacktest,
  loadKlineData
};
