require('./strategy-parameter-generator.test.ts');
require('./task-manager.test.ts');
require('./strategy-executor.test.ts');
require('./cli-and-config.test.ts');
require('./schedule-and-slippage.test.ts');
require('./indicators-and-analyzers.test.ts');
require('./strategy-executor-deep.test.ts');

const { run } = require('./harness.ts');

void run();
