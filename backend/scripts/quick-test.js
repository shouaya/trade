/**
 * Quick Test Script
 * 快速测试少量策略,验证系统是否正常工作
 */

const db = require('../config/database');
const StrategyExecutor = require('../services/strategy-executor');
const { generateStrategyCombinations } = require('../services/strategy-parameter-generator');

async function main() {
  console.log('🧪 快速测试模式\n');

  try {
    // 1. 加载K线数据
    console.log('📊 加载K线数据...');
    const startTime = new Date('2026-01-02T07:00:00Z').getTime();
    const endTime = new Date('2026-02-28T05:59:00Z').getTime();

    const [klines] = await db.query(`
      SELECT * FROM klines
      WHERE symbol = 'USDJPY'
        AND interval_type = '1min'
        AND open_time >= ? AND open_time <= ?
      ORDER BY open_time ASC
    `, [startTime, endTime]);

    console.log(`✅ 加载了 ${klines.length} 条K线数据\n`);

    if (klines.length === 0) {
      console.error('❌ 没有找到K线数据');
      process.exit(1);
    }

    // 2. 生成策略 (只测试每种类型的第一个)
    console.log('🔧 生成测试策略...');
    const allStrategies = generateStrategyCombinations({ limit: null });

    // 每种类型选一个
    const testStrategies = [];
    const seenTypes = new Set();

    for (const strategy of allStrategies) {
      if (!seenTypes.has(strategy.type)) {
        testStrategies.push(strategy);
        seenTypes.add(strategy.type);
      }
    }

    console.log(`   选择了 ${testStrategies.length} 个测试策略 (每种类型1个)\n`);

    // 3. 执行测试
    console.log('⚙️  开始测试...\n');

    for (let i = 0; i < testStrategies.length; i++) {
      const strategy = testStrategies[i];
      console.log(`[${i + 1}/${testStrategies.length}] ${strategy.name}`);
      console.log(`   类型: ${strategy.type}`);

      const startTime = Date.now();

      try {
        const executor = new StrategyExecutor(strategy, klines);
        const result = await executor.execute();

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        const { stats } = result;

        console.log(`   ✅ 完成 (${elapsed}秒)`);
        console.log(`   交易次数: ${stats.totalTrades}`);
        console.log(`   胜率: ${(stats.winRate * 100).toFixed(2)}%`);
        console.log(`   总盈亏: $${stats.totalPnl.toFixed(2)}`);
        console.log(`   夏普比率: ${stats.sharpeRatio.toFixed(3)}`);
        console.log('');

      } catch (error) {
        console.error(`   ❌ 失败: ${error.message}`);
        console.error(error.stack);
      }
    }

    console.log('✨ 测试完成!\n');
    process.exit(0);

  } catch (error) {
    console.error('❌ 错误:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
