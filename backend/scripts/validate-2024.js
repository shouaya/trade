/**
 * 2024年数据验证脚本
 * 使用在2025年训练的Top 10策略,在2024年数据上进行验证
 */

const db = require('../config/database');
const StrategyExecutor = require('../services/strategy-executor');

/**
 * 主函数
 */
async function main() {
  console.log('🚀 2024年策略验证测试');
  console.log('='.repeat(80));

  try {
    // 1. 检查2024年数据是否存在
    console.log('\n📊 检查2024年K线数据...');
    const startTime2024 = new Date('2024-01-01T22:00:00Z').getTime();
    const endTime2024 = new Date('2024-12-31T20:59:00Z').getTime();

    const [countResult] = await db.query(`
      SELECT COUNT(*) as count
      FROM klines
      WHERE symbol = 'USDJPY'
        AND interval_type = '1min'
        AND open_time >= ? AND open_time <= ?
    `, [startTime2024, endTime2024]);

    const count2024 = countResult[0].count;
    console.log(`   2024年数据量: ${count2024.toLocaleString()} 条`);

    if (count2024 === 0) {
      console.error('\n❌ 没有找到2024年的K线数据！');
      process.exit(1);
    }

    // 2. 加载2024年K线数据
    console.log('\n📊 加载2024年K线数据...');
    const [klines2024] = await db.query(`
      SELECT * FROM klines
      WHERE symbol = 'USDJPY'
        AND interval_type = '1min'
        AND open_time >= ? AND open_time <= ?
      ORDER BY open_time ASC
    `, [startTime2024, endTime2024]);

    console.log(`✅ 加载了 ${klines2024.length.toLocaleString()} 条K线数据`);
    console.log(`   时间范围: ${new Date(parseInt(klines2024[0].open_time)).toISOString()} ~ ${new Date(parseInt(klines2024[klines2024.length - 1].open_time)).toISOString()}`);

    // 3. 加载数据库中的策略（2025年训练的）
    console.log('\n📊 加载2025年训练的策略...');
    const [strategies] = await db.query(`
      SELECT id, name, description, parameters
      FROM strategies
      ORDER BY id ASC
    `);

    console.log(`✅ 找到 ${strategies.length} 个策略\n`);

    if (strategies.length === 0) {
      console.error('❌ 数据库中没有保存的策略！');
      process.exit(1);
    }

    // 4. 对每个策略进行回测
    console.log('⚙️  开始在2024年数据上验证...\n');
    console.log('='.repeat(80));

    const results = [];

    for (let i = 0; i < strategies.length; i++) {
      const strategyRow = strategies[i];
      const parameters = typeof strategyRow.parameters === 'string'
        ? JSON.parse(strategyRow.parameters)
        : strategyRow.parameters;

      // 重建strategy对象 - 直接使用数据库中的完整parameters
      const strategy = {
        name: strategyRow.name,
        type: parameters.rsi && parameters.rsi.enabled && parameters.macd && parameters.macd.enabled
          ? (parameters.entryLogic === 'AND' ? 'rsi_and_macd' : 'rsi_or_macd')
          : parameters.rsi && parameters.rsi.enabled
          ? 'rsi_only'
          : parameters.macd && parameters.macd.enabled
          ? 'macd_only'
          : 'grid_only',
        parameters: parameters
      };

      console.log(`\n${i + 1}. ${strategy.name}`);
      console.log(`   类型: ${strategy.type}`);

      try {
        const startTime = Date.now();
        const executor = new StrategyExecutor(strategy, klines2024);
        const result = await executor.execute();
        const stats = result.stats;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log(`   交易次数: ${stats.totalTrades}`);
        console.log(`   胜率: ${(stats.winRate * 100).toFixed(2)}%`);
        console.log(`   总盈亏: $${stats.totalPnl.toFixed(2)}`);
        console.log(`   平均盈亏: $${stats.avgPnl.toFixed(2)}`);
        console.log(`   夏普比率: ${stats.sharpeRatio.toFixed(3)}`);
        console.log(`   盈利因子: ${stats.profitFactor.toFixed(2)}`);
        console.log(`   最大回撤: ${(stats.maxDrawdown * 100).toFixed(2)}%`);
        console.log(`   耗时: ${elapsed}秒`);

        results.push({
          strategyId: strategyRow.id,
          strategyName: strategy.name,
          description: strategyRow.description,
          ...stats
        });

      } catch (error) {
        console.error(`   ❌ 验证失败: ${error.message}`);
        results.push({
          strategyId: strategyRow.id,
          strategyName: strategy.name,
          description: strategyRow.description,
          error: error.message
        });
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n📊 2024年验证汇总报告\n');
    console.log('='.repeat(80));

    // 5. 生成对比报告
    results.sort((a, b) => (b.totalPnl || -Infinity) - (a.totalPnl || -Infinity));

    console.log('\n按总盈亏排序:\n');
    results.forEach((result, index) => {
      if (result.error) {
        console.log(`${index + 1}. ${result.strategyName} - ❌ ${result.error}`);
        return;
      }

      console.log(`${index + 1}. ${result.strategyName}`);
      console.log(`   2025训练期: ${result.description}`);
      console.log(`   2024验证期:`);
      console.log(`     - 交易次数: ${result.totalTrades}`);
      console.log(`     - 胜率: ${(result.winRate * 100).toFixed(2)}%`);
      console.log(`     - 总盈亏: $${result.totalPnl.toFixed(2)}`);
      console.log(`     - 夏普比率: ${result.sharpeRatio.toFixed(3)}`);
      console.log(`     - 盈利因子: ${result.profitFactor.toFixed(2)}`);
      console.log(`     - 最大回撤: ${(result.maxDrawdown * 100).toFixed(2)}%`);
      console.log('');
    });

    console.log('='.repeat(80));

    // 6. 计算整体统计
    const validResults = results.filter(r => !r.error && r.totalTrades > 0);

    if (validResults.length > 0) {
      const avgWinRate = validResults.reduce((sum, r) => sum + r.winRate, 0) / validResults.length;
      const totalPnl = validResults.reduce((sum, r) => sum + r.totalPnl, 0);
      const avgSharpe = validResults.reduce((sum, r) => sum + r.sharpeRatio, 0) / validResults.length;
      const avgDrawdown = validResults.reduce((sum, r) => sum + r.maxDrawdown, 0) / validResults.length;

      console.log('\n📈 整体统计 (2024年):');
      console.log(`   有效策略: ${validResults.length}/${results.length}`);
      console.log(`   平均胜率: ${(avgWinRate * 100).toFixed(2)}%`);
      console.log(`   总盈亏: $${totalPnl.toFixed(2)}`);
      console.log(`   平均夏普比率: ${avgSharpe.toFixed(3)}`);
      console.log(`   平均最大回撤: ${(avgDrawdown * 100).toFixed(2)}%`);
      console.log(`   盈利策略: ${validResults.filter(r => r.totalPnl > 0).length}/${validResults.length}`);
      console.log('');
    }

    console.log('✨ 2024年验证完成!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ 执行失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行
main();
