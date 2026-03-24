require('./strategy-parameter-generator.test.ts');
require('./task-manager.test.ts');
require('./strategy-executor.test.ts');
require('./golden-fixtures.test.ts');
require('./train-config-registry.test.ts');
require('./train-orchestration.test.ts');
require('./training-management.test.ts');
require('./train-pipeline-summary.test.ts');
require('./rolling-artifact-builder.test.ts');
require('./cli-and-config.test.ts');
require('./schedule-and-slippage.test.ts');
require('./indicators-and-analyzers.test.ts');

const { run } = require('./harness.ts');

void run();
