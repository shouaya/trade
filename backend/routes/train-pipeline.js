const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

const router = express.Router();

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TRAIN_ROOT = process.env.TRAIN_ROOT
  ? path.resolve(process.env.TRAIN_ROOT)
  : path.join(REPO_ROOT, 'train');
const TRAIN_PIPELINE_SUMMARY_SERVICE_PATH = path.join(TRAIN_ROOT, 'dist', 'services', 'train-pipeline-summary.js');

function loadTrainPipelineSummaryService() {
  if (!fs.existsSync(TRAIN_PIPELINE_SUMMARY_SERVICE_PATH)) {
    throw new Error(`train pipeline summary service not built: ${TRAIN_PIPELINE_SUMMARY_SERVICE_PATH}`);
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(TRAIN_PIPELINE_SUMMARY_SERVICE_PATH);
}

router.get('/', async (req, res) => {
  try {
    const service = loadTrainPipelineSummaryService();
    const summary = await service.buildTrainingPipelineSummary({
      db: {
        query: (sql, params) => db.query(sql, params)
      },
      repoRoot: REPO_ROOT,
      trainRoot: TRAIN_ROOT
    });

    res.json({
      success: true,
      ...summary
    });
  } catch (error) {
    console.error('训练 pipeline 汇总失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to build training pipeline summary',
      message: error.message
    });
  }
});

module.exports = router;
