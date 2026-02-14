const express = require('express');
const router = express.Router();
const db = require('../config/database');

/**
 * GET /api/strategies
 * 获取所有策略
 */
router.get('/', async (req, res) => {
  try {
    const { active } = req.query;

    // 设置连接字符集
    await db.query("SET NAMES 'utf8mb4'");

    let query = 'SELECT * FROM strategies';
    const params = [];

    if (active !== undefined) {
      query += ' WHERE is_active = ?';
      params.push(active === 'true' ? 1 : 0);
    }

    query += ' ORDER BY created_at DESC';

    const [rows] = await db.query(query, params);

    res.json({
      success: true,
      count: rows.length,
      data: rows
    });

  } catch (error) {
    console.error('获取策略列表失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch strategies',
      message: error.message
    });
  }
});

/**
 * GET /api/strategies/:id
 * 获取单个策略详情
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query('SELECT * FROM strategies WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Strategy not found'
      });
    }

    res.json({
      success: true,
      data: rows[0]
    });

  } catch (error) {
    console.error('获取策略详情失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch strategy',
      message: error.message
    });
  }
});

/**
 * POST /api/strategies
 * 创建新策略
 */
router.post('/', async (req, res) => {
  try {
    const { name, description, parameters, isActive = true } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Strategy name is required'
      });
    }

    const query = `
      INSERT INTO strategies (name, description, parameters, is_active)
      VALUES (?, ?, ?, ?)
    `;

    const values = [
      name,
      description,
      parameters ? JSON.stringify(parameters) : null,
      isActive
    ];

    const [result] = await db.query(query, values);

    res.status(201).json({
      success: true,
      strategyId: result.insertId,
      message: 'Strategy created successfully'
    });

  } catch (error) {
    console.error('创建策略失败:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create strategy',
      message: error.message
    });
  }
});

module.exports = router;
