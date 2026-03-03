const { runTrainingByConfig } = require('./run-training');

runTrainingByConfig('2024', process.argv)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ 执行失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
