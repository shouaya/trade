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

    // 判断是否为年度周期（需要使用 YYYY 格式）
    const isYearlyTimeframe = interval === '4hour' || interval === '8hour' ||
                              interval === '12hour' || interval === '1day' ||
                              interval === '1week' || interval === '1month';

    let totalImported = 0;
    let totalSkipped = 0;
    const errors = [];

    if (isYearlyTimeframe) {
      // 对于年度周期，按年份获取数据
      console.log(`📅 年度周期 (${interval})：按年份获取`);
      const years = generateYearRange(startDate, endDate);

      for (const year of years) {
        try {
          const data = await fetchGMOKlineDataYearly(symbol, interval, priceType, year);

          if (data.length > 0) {
            // 过滤数据，只保留在 startDate 和 endDate 范围内的
            // 使用 UTC 时间而不是本地时间
            const startTimestamp = parseDateUTC(startDate).getTime();
            const endTimestamp = parseDateUTC(endDate).getTime() + 24 * 60 * 60 * 1000 - 1;

            const filteredData = data.filter(kline => {
              const klineTime = parseInt(kline.openTime);
              return klineTime >= startTimestamp && klineTime <= endTimestamp;
            });

            if (filteredData.length > 0) {
              const result = await insertKlineData(symbol, interval, filteredData);
              totalImported += result.inserted;
              totalSkipped += result.skipped;
              console.log(`✅ ${year}: 插入 ${result.inserted} 条, 跳过 ${result.skipped} 条`);
            } else {
              console.log(`⚠️  ${year}: 过滤后无数据`);
            }
          } else {
            console.log(`⚠️  ${year}: 无数据`);
          }

          // 延迟以避免频繁请求
          await delay(300);

        } catch (error) {
          console.error(`❌ ${year}: ${error.message}`);
          errors.push({ date: year, error: error.message });
        }
      }
    } else {
      // 对于日内周期（1min ~ 1hour），批量获取整个时间段的数据
      console.log(`📅 日内周期 (${interval})：批量获取 ${startDate} - ${endDate}`);

      try {
        const dates = generateDateRange(startDate, endDate);

        // 添加结束日期后一天(用于获取最后一天的21-23点)
        const nextDay = new Date(parseDate(endDate));
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = `${nextDay.getFullYear()}${String(nextDay.getMonth() + 1).padStart(2, '0')}${String(nextDay.getDate()).padStart(2, '0')}`;
        dates.push(nextDayStr);

        console.log(`🔄 开始批量获取 ${dates.length} 天的数据 (含次日)`);

        const allData = [];
        const batchSize = 50; // 每50天数据进行一次数据库插入
        let processedCount = 0;

        for (let i = 0; i < dates.length; i++) {
          const date = dates[i];

          // 带重试的API调用
          let retries = 3;
          let success = false;

          while (retries > 0 && !success) {
            try {
              const data = await fetchGMOKlineDataDaily(symbol, interval, priceType, date);
              if (data.length > 0) {
                allData.push(...data);
              }
              success = true;
              processedCount++;

              if (processedCount % 10 === 0) {
                console.log(`   📥 进度: ${processedCount}/${dates.length} (${(processedCount/dates.length*100).toFixed(1)}%)`);
              }

              await delay(200); // 减少延迟到200ms
            } catch (error) {
              retries--;
              if (retries > 0) {
                console.log(`   ⚠️  ${date}: ${error.message}, 重试剩余 ${retries} 次`);
                await delay(1000); // 失败后等待1秒再重试
              } else {
                console.error(`   ❌ ${date}: ${error.message} (已放弃)`);
                errors.push({ date, error: error.message });
              }
            }
          }

          // 每处理batchSize天或最后一批,进行一次数据库插入
          if ((i + 1) % batchSize === 0 || i === dates.length - 1) {
            if (allData.length > 0) {
              console.log(`💾 中间插入: 处理 ${allData.length} 条数据...`);

              // 按UTC时间过滤
              const startTimestamp = parseDateUTC(startDate).getTime();
              const endTimestamp = parseDateUTC(endDate).getTime() + 24 * 60 * 60 * 1000 - 1;

              const filteredData = allData.filter(kline => {
                const klineTime = parseInt(kline.openTime);
                return klineTime >= startTimestamp && klineTime <= endTimestamp;
              });

              if (filteredData.length > 0) {
                const result = await insertKlineData(symbol, interval, filteredData);
                totalImported += result.inserted;
                totalSkipped += result.skipped;
                console.log(`   ✅ 插入 ${result.inserted} 条, 跳过 ${result.skipped} 条`);
              }

              // 清空allData以释放内存
              allData.length = 0;
            }
          }
        }

        console.log(`✅ 批量获取完成`);

      } catch (error) {
        console.error(`❌ 批量导入失败: ${error.message}`);
        errors.push({ date: 'all', error: error.message });
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
 * 从 GMO Coin API 拉取日内周期的 K 线数据（使用 YYYYMMDD 格式）
 * 适用于: 1min, 5min, 10min, 15min, 30min, 1hour
 */
async function fetchGMOKlineDataDaily(symbol, interval, priceType, date) {
  const url = `${GMO_BASE_URL}/v1/klines`;

  const params = {
    symbol: symbol,
    priceType: priceType,
    interval: interval,
    date: date  // YYYYMMDD 格式，如 20250101
  };

  const response = await axios.get(url, {
    params,
    timeout: 10000
  });

  if (response.data && response.data.status === 0 && response.data.data) {
    return response.data.data;
  }

  return [];
}

/**
 * 从 GMO Coin API 拉取年度周期的 K 线数据（使用 YYYY 格式）
 * 适用于: 4hour, 8hour, 12hour, 1day, 1week, 1month
 */
async function fetchGMOKlineDataYearly(symbol, interval, priceType, year) {
  const url = `${GMO_BASE_URL}/v1/klines`;

  const params = {
    symbol: symbol,
    priceType: priceType,
    interval: interval,
    date: year  // YYYY 格式，如 2025
  };

  const response = await axios.get(url, {
    params,
    timeout: 10000
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
        symbol, interval_type, open_time, open, high,
        low, close, volume
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        open = VALUES(open),
        high = VALUES(high),
        low = VALUES(low),
        close = VALUES(close),
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
 * 生成年份范围数组 (YYYY 格式)
 */
function generateYearRange(startDate, endDate) {
  const years = [];
  const startYear = parseInt(startDate.substring(0, 4));
  const endYear = parseInt(endDate.substring(0, 4));

  for (let year = startYear; year <= endYear; year++) {
    years.push(year.toString());
  }

  return years;
}

/**
 * 解析 YYYYMMDD 格式日期（使用本地时间）
 */
function parseDate(dateStr) {
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1;
  const day = parseInt(dateStr.substring(6, 8));
  return new Date(year, month, day);
}

/**
 * 解析 YYYYMMDD 格式日期（使用 UTC 时间）
 * GMO API 返回的时间戳是 UTC 时间，所以过滤时也需要使用 UTC
 */
function parseDateUTC(dateStr) {
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1;
  const day = parseInt(dateStr.substring(6, 8));
  return new Date(Date.UTC(year, month, day));
}

/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = router;
