const express = require('express');
const router = express.Router();
const { importKlineData } = require('../lib/kline-importer');
const { sendServerError } = require('../lib/route-utils');

router.post('/gmocoin', async (req, res) => {
  try {
    const result = await importKlineData(req.body, console);
    res.json({
      success: true,
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors.length > 0 ? result.errors : undefined,
      message: `Successfully imported ${result.imported} klines`
    });
  } catch (error) {
    return sendServerError(res, '导入数据失败:', 'Failed to import data', error);
  }
});

module.exports = router;
