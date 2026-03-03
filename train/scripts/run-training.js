const { runTrainingBacktest } = require('../backtest-training-service');
const { parseTrainCliArgs } = require('./_common');
const { loadNamedConfig, extractConfigArg } = require('./_config');

async function runTrainingByConfig(configName = '2025', argv = process.argv) {
  const { configName: resolvedConfigName, passthroughArgv } = extractConfigArg(argv, configName);
  const config = loadNamedConfig('training', resolvedConfigName);
  const { limit, types, topN, retainDays } = parseTrainCliArgs(passthroughArgv);

  await runTrainingBacktest({
    ...config,
    topN,
    retainDays,
    limit,
    types
  });
}

async function main() {
  try {
    await runTrainingByConfig('2025', process.argv);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 执行失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runTrainingByConfig
};
