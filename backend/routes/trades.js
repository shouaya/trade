const express = require('express');
const router = express.Router();
const db = require('../config/database');

/**
 * GET /api/trades
 * 获取交易记录列表
 * 查询参数:
 *   - limit: 返回数量 (默认 100)
 *   - offset: 偏移量 (默认 0)
 *   - direction: 筛选方向 (long/short)
 *   - strategy: 策略名称
 */
router.get('/', async (req, res) => {
  try {
    const {
      limit = 100,
      offset = 0,
      direction,
      strategy
    } = req.query;

    let query = 'SELECT * FROM trades WHERE 1=1';
    const params = [];

    if (direction) {
      query += ' AND direction = ?';
      params.push(direction);
    }

    if (strategy) {
      query += ' AND strategy_name = ?';
      params.push(strategy);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await db.query(query, params);

    // 获取总数
    let countQuery = 'SELECT COUNT(*) as total FROM trades WHERE 1=1';
    const countParams = [];

    if (direction) {
      countQuery += ' AND direction = ?';
      countParams.push(direction);
    }

    if (strategy) {
      countQuery += ' AND strategy_name = ?';
      countParams.push(strategy);
    }

    const [countResult] = await db.query(countQuery, countParams);

    res.json({
      success: true,
      total: countResult[0].total,
      count: rows.length,
      data: rows
    });

  } catch (error) {
    console.error('获取交易记录失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trades',
      message: error.message
    });
  }
});

/**
 * GET /api/trades/:id
 * 获取单个交易记录详情
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query('SELECT * FROM trades WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Trade not found'
      });
    }

    res.json({
      success: true,
      data: rows[0]
    });

  } catch (error) {
    console.error('获取交易详情失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trade',
      message: error.message
    });
  }
});

/**
 * POST /api/trades
 * 创建新的交易记录
 */
router.post('/', async (req, res) => {
  try {
    const {
      direction,
      entryTime,
      entryPrice,
      entryIndex,
      lotSize = 1,
      holdMinutes,
      stopLoss,
      takeProfit,
      exitTime,
      exitPrice,
      exitReason,
      pnl,
      pips,
      percent,
      actualHoldMinutes,
      strategyName,
      notes,
      symbol = 'USDJPY'
    } = req.body;

    // 验证必填字段
    if (!direction || !entryTime || !entryPrice || entryIndex === undefined || !holdMinutes) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['direction', 'entryTime', 'entryPrice', 'entryIndex', 'holdMinutes']
      });
    }

    const query = `
      INSERT INTO trades (
        direction, entry_time, entry_price, entry_index,
        lot_size, hold_minutes, stop_loss, take_profit,
        exit_time, exit_price, exit_reason,
        pnl, pips, percent, actual_hold_minutes,
        strategy_name, notes, symbol
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      direction,
      entryTime,
      entryPrice,
      entryIndex,
      lotSize,
      holdMinutes,
      stopLoss,
      takeProfit,
      exitTime,
      exitPrice,
      exitReason,
      pnl,
      pips,
      percent,
      actualHoldMinutes,
      strategyName,
      notes,
      symbol
    ];

    const [result] = await db.query(query, values);

    res.status(201).json({
      success: true,
      tradeId: result.insertId,
      message: 'Trade created successfully'
    });

  } catch (error) {
    console.error('创建交易记录失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create trade',
      message: error.message
    });
  }
});

/**
 * PUT /api/trades/:id
 * 更新交易记录（通常用于补充出场信息）
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      exitTime,
      exitPrice,
      exitReason,
      pnl,
      pips,
      percent,
      actualHoldMinutes,
      notes
    } = req.body;

    const query = `
      UPDATE trades SET
        exit_time = COALESCE(?, exit_time),
        exit_price = COALESCE(?, exit_price),
        exit_reason = COALESCE(?, exit_reason),
        pnl = COALESCE(?, pnl),
        pips = COALESCE(?, pips),
        percent = COALESCE(?, percent),
        actual_hold_minutes = COALESCE(?, actual_hold_minutes),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `;

    const values = [
      exitTime,
      exitPrice,
      exitReason,
      pnl,
      pips,
      percent,
      actualHoldMinutes,
      notes,
      id
    ];

    const [result] = await db.query(query, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Trade not found'
      });
    }

    res.json({
      success: true,
      message: 'Trade updated successfully'
    });

  } catch (error) {
    console.error('更新交易记录失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update trade',
      message: error.message
    });
  }
});

/**
 * GET /api/trades/stats/summary
 * 获取交易统计摘要
 */
router.get('/stats/summary', async (req, res) => {
  try {
    const query = `
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
        SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing_trades,
        ROUND(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as win_rate,
        ROUND(SUM(pnl), 2) as total_pnl,
        ROUND(AVG(pnl), 2) as avg_pnl,
        ROUND(MAX(pnl), 2) as max_profit,
        ROUND(MIN(pnl), 2) as max_loss,
        SUM(CASE WHEN direction = 'long' THEN 1 ELSE 0 END) as long_trades,
        SUM(CASE WHEN direction = 'short' THEN 1 ELSE 0 END) as short_trades
      FROM trades
      WHERE pnl IS NOT NULL
    `;

    const [rows] = await db.query(query);

    res.json({
      success: true,
      data: rows[0]
    });

  } catch (error) {
    console.error('获取统计摘要失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats',
      message: error.message
    });
  }
});

module.exports = router;
