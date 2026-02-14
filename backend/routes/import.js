const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../config/database');

const GMO_BASE_URL = 'https://forex-api.coin.z.com/public';

/**
 * POST /api/import/gmocoin
 * 从 GMO Coin API 导入 K 线数据到数据库
 * Body:
 *   - symbol: 交易对 (如 USD_JPY, BTC_JPY)
 *   - interval: K线间隔 (如 1min, 5min, 1hour, 1day)
 *   - priceType: 价格类型 (BID 或 ASK)
 *   - startDate: 开始日期 (格式: YYYYMMDD)
 *   - endDate: 结束日期 (格式: YYYYMMDD)
 */
router.post('/gmocoin', async (req, res) => {
  try {
    const {
      symbol = 'USD_JPY',
      interval = '1min',
      priceType = 'BID',
      startDate,
      endDate
    } = req.body;

    // 验证必填字段
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['startDate', 'endDate']
      });
    }

    console.log(`📥 开始导入数据: ${symbol} ${interval} ${priceType} ${startDate} - ${endDate}`);

    // 生成日期范围
    const dates = generateDateRange(startDate, endDate);
    console.log(`📅 总共需要拉取 ${dates.length} 天的数据`);

    let totalImported = 0;
    let totalSkipped = 0;
    const errors = [];

    // 逐日拉取数据
    for (const date of dates) {
      try {
        const data = await fetchGMOKlineData(symbol, interval, priceType, date);

        if (data.length > 0) {
          // 批量插入数据库
          const result = await insertKlineData(symbol, interval, data);
          totalImported += result.inserted;
          totalSkipped += result.skipped;

          console.log(`✅ ${date}: 插入 ${result.inserted} 条, 跳过 ${result.skipped} 条`);
        } else {
          console.log(`⚠️  ${date}: 无数据`);
        }

        // 延迟以避免频繁请求
        await delay(300);

      } catch (error) {
        console.error(`❌ ${date}: ${error.message}`);
        errors.push({ date, error: error.message });
      }
    }

    console.log(`✨ 导入完成: 总插入 ${totalImported} 条, 跳过 ${totalSkipped} 条`);

    res.json({
      success: true,
      imported: totalImported,
      skipped: totalSkipped,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully imported ${totalImported} klines`
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

/**
 * 从 GMO Coin API 拉取指定日期的 K 线数据
 */
async function fetchGMOKlineData(symbol, interval, priceType, date) {
  const url = `${GMO_BASE_URL}/v1/klines`;
  const params = {
    symbol: symbol,
    priceType: priceType,
    interval: interval,
    date: date
  };

  const response = await axios.get(url, {
    params,
    timeout: 10000 // 10秒超时
  });

  if (response.data && response.data.status === 0 && response.data.data) {
    return response.data.data;
  }

  return [];
}

/**
 * 批量插入 K 线数据到数据库
 */
async function insertKlineData(symbol, interval, data) {
  let inserted = 0;
  let skipped = 0;

  // 使用事务批量插入
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const insertQuery = `
      INSERT INTO klines (
        symbol, interval, open_time, open_price, high_price,
        low_price, close_price, volume
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        open_price = VALUES(open_price),
        high_price = VALUES(high_price),
        low_price = VALUES(low_price),
        close_price = VALUES(close_price),
        volume = VALUES(volume)
    `;

    for (const item of data) {
      const values = [
        symbol.replace('_', ''), // USD_JPY -> USDJPY
        interval,
        item.openTime,
        parseFloat(item.open),
        parseFloat(item.high),
        parseFloat(item.low),
        parseFloat(item.close),
        parseFloat(item.volume || 0)
      ];

      const [result] = await connection.query(insertQuery, values);

      if (result.affectedRows === 1) {
        inserted++;
      } else if (result.affectedRows === 2) {
        // ON DUPLICATE KEY UPDATE 触发时 affectedRows = 2
        skipped++;
      }
    }

    await connection.commit();

  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return { inserted, skipped };
}

/**
 * 生成日期范围数组 (YYYYMMDD 格式)
 */
function generateDateRange(startDate, endDate) {
  const dates = [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  let current = new Date(start);
  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}${month}${day}`);

    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * 解析 YYYYMMDD 格式日期
 */
function parseDate(dateStr) {
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1;
  const day = parseInt(dateStr.substring(6, 8));
  return new Date(year, month, day);
}

/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = router;
