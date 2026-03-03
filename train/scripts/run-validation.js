const { runStrategyValidation } = require('../strategy-validation-service');
const { loadNamedConfig, extractConfigArg } = require('./_config');

async function runValidationByConfig(configName = '2025', argv = process.argv) {
  const { configName: resolvedConfigName } = extractConfigArg(argv, configName);
  const config = loadNamedConfig('validation', resolvedConfigName);
  await runStrategyValidation(config);
}

async function main() {
  try {
    await runValidationByConfig('2025', process.argv);
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
  runValidationByConfig
};
