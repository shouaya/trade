require('./strategy-parameter-generator.test.ts');
require('./task-manager.test.ts');
require('./strategy-executor.test.ts');
require('./golden-fixtures.test.ts');
require('./train-config-registry.test.ts');
require('./train-orchestration.test.ts');
require('./training-management.test.ts');
require('./train-pipeline-summary.test.ts');
require('./train-pipeline-summary.integration.test.ts');
require('./rolling-artifact-builder.test.ts');
require('./rolling-features.test.ts');
require('./market-feature-scenarios.test.ts');
require('./router-policy-catalog.test.ts');
require('./router-artifact-builder.test.ts');
require('./regime-router-validation.test.ts');
require('./feature-flow.test.ts');
require('./cli-and-config.test.ts');
require('./schedule-and-slippage.test.ts');
require('./indicators-and-analyzers.test.ts');
require('./fee-model.test.ts');

const { run } = require('./harness.ts');

void run();
