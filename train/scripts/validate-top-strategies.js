const db = require('../config/database');
const StrategyExecutor = require('../services/strategy-executor');
const { loadNamedConfig, extractConfigArg } = require('./_config');

async function main() {
  const { configName } = extractConfigArg(process.argv, 'default');
  const config = loadNamedConfig('validation-top-strategies', configName);
  const strategies = loadNamedConfig('top-strategies', 'top3');

  console.log('\n' + '='.repeat(80));
  console.log(`🔍 ${config.year} ${config.title}`);
  console.log('='.repeat(80) + '\n');

  try {
    const startTime = new Date(config.startIso).getTime();
    const endTime = new Date(config.endIso).getTime();
    const warmupStartTime = startTime - ((config.warmupDays || 60) * 24 * 60 * 60 * 1000);

    console.log(`📊 加载${config.periodLabel}K线数据 (含预热期)...\n`);
    const [klines] = await db.query(
      `
      SELECT * FROM klines
      WHERE symbol = ? AND interval_type = ?
        AND open_time >= ? AND open_time <= ?
      ORDER BY open_time ASC
      `,
      [config.symbol || 'USDJPY', config.intervalType || '1min', warmupStartTime, endTime]
    );

    if (klines.length === 0) {
      throw new Error(`没有找到${config.periodLabel}的数据`);
    }

    console.log(`✅ 加载了 ${klines.length.toLocaleString()} 条K线数据`);
    console.log(`   时间范围: ${new Date(warmupStartTime).toISOString()} ~ ${new Date(endTime).toISOString()}\n`);

    const results = [];

    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      console.log('='.repeat(80));
      console.log(`\n策略 ${i + 1}: ${strategy.name}`);
      console.log(`描述: ${strategy.description}\n`);
      console.log('='.repeat(80));

      const runStart = Date.now();
      const executor = new StrategyExecutor(
        {
          name: strategy.name,
          type: strategy.type,
          parameters: strategy.parameters
        },
        klines
      );

      const result = await executor.execute();
      const stats = result.stats;
      const elapsed = ((Date.now() - runStart) / 1000).toFixed(2);

      console.log(`\n⏱️  执行耗时: ${elapsed} 秒`);
      console.log(`\n📈 ${config.periodLabel}回测结果:\n`);
      console.log(`   交易次数: ${stats.totalTrades}`);
      console.log(`   胜率: ${(stats.winRate * 100).toFixed(2)}%`);
      console.log(`   总盈亏: $${(stats.totalPnl || 0).toFixed(2)}`);
      console.log(`   平均盈亏: $${(stats.avgPnl || 0).toFixed(2)}`);
      console.log(`   夏普比率: ${(stats.sharpeRatio || 0).toFixed(3)}`);
      console.log(`   盈利因子: ${(stats.profitFactor || 0).toFixed(2)}`);
      console.log(`   最大回撤: ${(stats.maxDrawdown * 100).toFixed(2)}%`);
      console.log(`   综合评分: ${(stats.score || 0).toFixed(2)}\n`);

      results.push({ name: strategy.name, stats });
    }

    console.log('='.repeat(80));
    console.log(`\n📝 ${config.periodLabel}验证总结\n`);
    console.log('='.repeat(80));

    const allProfitable = results.every(r => r.stats.totalPnl > 0);
    const allPositiveWinRate = results.every(r => r.stats.winRate > 0.48);
    const allPositiveProfitFactor = results.every(r => r.stats.profitFactor > 1.0);

    console.log(`\n  所有策略盈利: ${allProfitable ? '✅ 是' : '❌ 否'}`);
    console.log(`  所有策略胜率>48%: ${allPositiveWinRate ? '✅ 是' : '❌ 否'}`);
    console.log(`  所有策略盈利因子>1.0: ${allPositiveProfitFactor ? '✅ 是' : '❌ 否'}\n`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ 验证失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
