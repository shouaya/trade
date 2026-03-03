/**
 * 2025 训练集批量回测入口脚本
 * 具体训练/回测/入库逻辑已迁移到 ../backtest-training-service
 */

const { runTrainingBacktest } = require('../backtest-training-service');

async function main() {
  const args = process.argv.slice(2);
  const limit = args[0] ? parseInt(args[0], 10) : null;
  const types = args[1] ? args[1].split(',') : null;

  try {
    await runTrainingBacktest({
      startTimeMs: new Date('2025-01-02T07:00:00Z').getTime(),
      endTimeMs: new Date('2025-12-31T23:59:00Z').getTime(),
      symbol: 'USDJPY',
      intervalType: '1min',
      tableName: 'backtest_results',
      topN: 10,
      retainDays: 1,
      strategyNamePrefix: '',
      descriptionPrefix: '',
      limit,
      types
    });
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 执行失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();


