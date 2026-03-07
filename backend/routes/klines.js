const express = require('express');
const router = express.Router();
const db = require('../config/database');

/**
 * GET /api/klines
 * 获取 K 线数据
 * 查询参数:
 *   - symbol: 交易对 (默认 USDJPY)
 *   - interval: 时间间隔 (默认 1m)
 *   - start: 开始时间戳
 *   - end: 结束时间戳
 *   - limit: 返回数量限制 (默认 1000)
 */
router.get('/', async (req, res) => {
  try {
    const {
      symbol = 'USDJPY',
      interval = '1m',
      start,
      end,
      limit = 1000
    } = req.query;

    let query = `
      SELECT
        id,
        open_time,
        CAST((bid_open + ask_open) / 2 AS CHAR) AS open,
        CAST((bid_high + ask_high) / 2 AS CHAR) AS high,
        CAST((bid_low + ask_low) / 2 AS CHAR) AS low,
        CAST((bid_close + ask_close) / 2 AS CHAR) AS close,
        CAST(bid_open AS CHAR) AS bid_open,
        CAST(bid_high AS CHAR) AS bid_high,
        CAST(bid_low AS CHAR) AS bid_low,
        CAST(bid_close AS CHAR) AS bid_close,
        CAST(ask_open AS CHAR) AS ask_open,
        CAST(ask_high AS CHAR) AS ask_high,
        CAST(ask_low AS CHAR) AS ask_low,
        CAST(ask_close AS CHAR) AS ask_close,
        CAST(volume AS CHAR) AS volume,
        symbol,
        interval_type
      FROM klines
      WHERE symbol = ? AND interval_type = ?
    `;
    const params = [symbol, interval];

    if (start) {
      query += ' AND open_time >= ?';
      params.push(parseInt(start));
    }

    if (end) {
      query += ' AND open_time <= ?';
      params.push(parseInt(end));
    }

    query += ' ORDER BY open_time ASC LIMIT ?';
    params.push(parseInt(limit));

    const [rows] = await db.query(query, params);

    // 转换为前端期望的格式
    const formattedData = rows.map(row => ({
      openTime: row.open_time.toString(),
      open: row.open.toString(),
      high: row.high.toString(),
      low: row.low.toString(),
      close: row.close.toString(),
      bidOpen: row.bid_open?.toString() ?? null,
      bidHigh: row.bid_high?.toString() ?? null,
      bidLow: row.bid_low?.toString() ?? null,
      bidClose: row.bid_close?.toString() ?? null,
      askOpen: row.ask_open?.toString() ?? null,
      askHigh: row.ask_high?.toString() ?? null,
      askLow: row.ask_low?.toString() ?? null,
      askClose: row.ask_close?.toString() ?? null,
      volume: row.volume ? row.volume.toString() : '0'
    }));

    res.json({
      success: true,
      count: formattedData.length,
      data: formattedData
    });

  } catch (error) {
    console.error('获取 K 线数据失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch klines',
      message: error.message
    });
  }
});

/**
 * GET /api/klines/stats
 * 获取数据统计信息
 */
router.get('/stats', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        symbol,
        interval_type,
        COUNT(*) as count,
        MIN(open_time) as earliest,
        MAX(open_time) as latest
      FROM klines
      GROUP BY symbol, interval_type
    `);

    res.json({
      success: true,
      data: rows
    });

  } catch (error) {
    console.error('获取统计信息失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats',
      message: error.message
    });
  }
});

/**
 * POST /api/klines/bulk
 * 批量插入 K 线数据
 */
router.post('/bulk', async (req, res) => {
  try {
    const { symbol = 'USDJPY', interval = '1m', data } = req.body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid data format'
      });
    }

    // 准备批量插入数据
    const values = data.map(kline => [
      kline.openTime,
      kline.bidOpen ?? kline.open,
      kline.bidHigh ?? kline.high,
      kline.bidLow ?? kline.low,
      kline.bidClose ?? kline.close,
      kline.askOpen ?? kline.open,
      kline.askHigh ?? kline.high,
      kline.askLow ?? kline.low,
      kline.askClose ?? kline.close,
      kline.volume || 0,
      symbol,
      interval
    ]);

    const query = `
      INSERT INTO klines (
        open_time,
        bid_open, bid_high, bid_low, bid_close,
        ask_open, ask_high, ask_low, ask_close,
        volume, symbol, interval_type
      )
      VALUES ?
      ON DUPLICATE KEY UPDATE
        bid_open = COALESCE(VALUES(bid_open), bid_open),
        bid_high = COALESCE(VALUES(bid_high), bid_high),
        bid_low = COALESCE(VALUES(bid_low), bid_low),
        bid_close = COALESCE(VALUES(bid_close), bid_close),
        ask_open = COALESCE(VALUES(ask_open), ask_open),
        ask_high = COALESCE(VALUES(ask_high), ask_high),
        ask_low = COALESCE(VALUES(ask_low), ask_low),
        ask_close = COALESCE(VALUES(ask_close), ask_close),
        volume = VALUES(volume)
    `;

    const [result] = await db.query(query, [values]);

    res.json({
      success: true,
      inserted: result.affectedRows,
      message: `Successfully inserted/updated ${result.affectedRows} klines`
    });

  } catch (error) {
    console.error('批量插入 K 线失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to insert klines',
      message: error.message
    });
  }
});

module.exports = router;
