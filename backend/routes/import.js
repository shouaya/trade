const express = require('express');
const router = express.Router();
const { importKlineData } = require('../lib/kline-importer');

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
    console.error('导入数据失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to import data',
      message: error.message
    });
  }
});

module.exports = router;
