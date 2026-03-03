/**
 * 2024 训练集批量回测入口脚本
 * 具体训练/回测/入库逻辑已迁移到 ../backtest-training-service
 */

const { runTrainingBacktest } = require('../backtest-training-service');
const { parseTrainCliArgs } = require('./_common');

async function main() {
  const { limit, types, topN, retainDays } = parseTrainCliArgs(process.argv);

  try {
    await runTrainingBacktest({
      startTimeMs: new Date('2024-01-01T22:00:00Z').getTime(),
      endTimeMs: new Date('2024-12-31T20:59:00Z').getTime(),
      symbol: 'USDJPY',
      intervalType: '1min',
      tableName: 'backtest_results',
      topN,
      retainDays,
      strategyNamePrefix: '2024-',
      descriptionPrefix: '2024训练 | ',
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



