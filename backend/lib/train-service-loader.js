const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TRAIN_ROOT = process.env.TRAIN_ROOT
  ? path.resolve(process.env.TRAIN_ROOT)
  : path.join(REPO_ROOT, 'train');
const TRAIN_DIST_SERVICES_ROOT = path.join(TRAIN_ROOT, 'dist', 'services');

function resolveTrainServicePath(fileName) {
  return path.join(TRAIN_DIST_SERVICES_ROOT, fileName);
}

function loadTrainService(fileName, label) {
  const servicePath = resolveTrainServicePath(fileName);
  const cachedModule = require.cache[servicePath];

  if (!fs.existsSync(servicePath)) {
    if (cachedModule?.exports) {
      return cachedModule.exports;
    }
    throw new Error(`${label} not built: ${servicePath}`);
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(servicePath);
}

function loadTrainingManagementService() {
  return loadTrainService('training-management.js', 'train management service');
}

function loadTrainConfigRegistryService() {
  return loadTrainService('train-config-registry.js', 'train config registry service');
}

function loadTrainOrchestrationService() {
  return loadTrainService('train-orchestration.js', 'train orchestration service');
}

function loadTrainPipelineSummaryService() {
  return loadTrainService('train-pipeline-summary.js', 'train pipeline summary service');
}

module.exports = {
  REPO_ROOT,
  TRAIN_ROOT,
  loadTrainConfigRegistryService,
  loadTrainOrchestrationService,
  loadTrainPipelineSummaryService,
  loadTrainingManagementService
};
