const express = require('express');
const db = require('../config/database');
const {
  REPO_ROOT,
  TRAIN_ROOT,
  loadTrainPipelineSummaryService
} = require('../lib/train-service-loader');
const { sendServerError } = require('../lib/route-utils');

const router = express.Router();

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
    return sendServerError(res, '训练 pipeline 汇总失败:', 'Failed to build training pipeline summary', error);
  }
});

module.exports = router;
