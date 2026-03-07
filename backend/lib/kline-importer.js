const axios = require('axios');
const db = require('../config/database');

const MARKET_CONFIG = {
  fx: {
    baseUrl: 'https://forex-api.coin.z.com/public',
    requiresPriceType: true
  },
  coin: {
    baseUrl: 'https://api.coin.z.com/public',
    requiresPriceType: false
  }
};

function normalizeMarketType(type) {
  const normalized = String(type || 'fx').trim().toLowerCase();
  if (!MARKET_CONFIG[normalized]) {
    throw new Error(`Unsupported type: ${type}. Available values: fx, coin`);
  }
  return normalized;
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().replace(/['"]/g, '');
}

function normalizeStorageSymbol(symbol) {
  return normalizeSymbol(symbol).replace('_', '');
}

function normalizeInterval(interval) {
  return String(interval || '1min').trim().replace(/['"]/g, '');
}

function normalizePriceType(priceType) {
  return String(priceType || 'BOTH').trim().toUpperCase().replace(/['"]/g, '');
}

function sanitizeDate(dateStr, fieldName) {
  const value = String(dateStr || '').trim().replace(/['"]/g, '');
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`${fieldName} must be in YYYYMMDD format`);
  }
  return value;
}

function validateImportOptions(options) {
  const type = normalizeMarketType(options.type);
  const symbol = normalizeSymbol(options.symbol);
  const interval = normalizeInterval(options.interval);
  const startDate = sanitizeDate(options.startDate, 'startDate');
  const endDate = sanitizeDate(options.endDate, 'endDate');
  const priceType = normalizePriceType(options.priceType);

  if (!symbol) {
    throw new Error('symbol is required');
  }

  if (startDate > endDate) {
    throw new Error('startDate must be less than or equal to endDate');
  }

  if (MARKET_CONFIG[type].requiresPriceType && !['BID', 'ASK', 'BOTH'].includes(priceType)) {
    throw new Error('priceType must be BID, ASK, or BOTH for fx import');
  }

  return {
    type,
    symbol,
    interval,
    priceType,
    startDate,
    endDate
  };
}

async function fetchKlineDataDaily(type, symbol, interval, priceType, date) {
  const { baseUrl, requiresPriceType } = MARKET_CONFIG[type];
  const params = {
    symbol,
    interval,
    date
  };

  if (requiresPriceType) {
    params.priceType = priceType;
  }

  const response = await axios.get(`${baseUrl}/v1/klines`, {
    params,
    timeout: 10000
  });

  if (response.data && response.data.status === 0 && response.data.data) {
    return response.data.data;
  }

  throw new Error(formatApiError(response.data));
}

async function fetchKlineDataYearly(type, symbol, interval, priceType, year) {
  const { baseUrl, requiresPriceType } = MARKET_CONFIG[type];
  const params = {
    symbol,
    interval,
    date: year
  };

  if (requiresPriceType) {
    params.priceType = priceType;
  }

  const response = await axios.get(`${baseUrl}/v1/klines`, {
    params,
    timeout: 10000
  });

  if (response.data && response.data.status === 0 && response.data.data) {
    return response.data.data;
  }

  throw new Error(formatApiError(response.data));
}

async function insertKlineData(symbol, interval, data) {
  let inserted = 0;
  let skipped = 0;

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const insertQuery = `
      INSERT INTO klines (
        symbol, interval_type, open_time,
        bid_open, bid_high, bid_low, bid_close,
        ask_open, ask_high, ask_low, ask_close, volume
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    for (const item of data) {
      const values = [
        normalizeStorageSymbol(symbol),
        interval,
        item.openTime,
        parseNullableNumber(item.bid_open),
        parseNullableNumber(item.bid_high),
        parseNullableNumber(item.bid_low),
        parseNullableNumber(item.bid_close),
        parseNullableNumber(item.ask_open),
        parseNullableNumber(item.ask_high),
        parseNullableNumber(item.ask_low),
        parseNullableNumber(item.ask_close),
        parseFloat(item.volume || 0)
      ];

      const [result] = await connection.query(insertQuery, values);
      if (result.affectedRows === 1) {
        inserted++;
      } else if (result.affectedRows === 2) {
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

async function clearKlineData(options) {
  await ensureKlineSchema();

  const type = normalizeMarketType(options.type || 'fx');
  const symbol = normalizeSymbol(options.symbol);
  const interval = normalizeInterval(options.interval);
  const startDate = options.startDate ? sanitizeDate(options.startDate, 'startDate') : null;
  const endDate = options.endDate ? sanitizeDate(options.endDate, 'endDate') : null;

  if (!symbol) {
    throw new Error('symbol is required');
  }

  if (!interval) {
    throw new Error('interval is required');
  }

  if ((startDate && !endDate) || (!startDate && endDate)) {
    throw new Error('startDate and endDate must be provided together');
  }

  const params = [normalizeStorageSymbol(symbol), interval];
  let query = 'DELETE FROM klines WHERE symbol = ? AND interval_type = ?';

  if (startDate && endDate) {
    const startTimestamp = parseDateUTC(startDate).getTime();
    const endTimestamp = parseDateUTC(endDate).getTime() + 24 * 60 * 60 * 1000 - 1;
    query += ' AND open_time >= ? AND open_time <= ?';
    params.push(startTimestamp, endTimestamp);
  }

  const [result] = await db.query(query, params);

  return {
    type,
    symbol,
    interval,
    deleted: result.affectedRows || 0,
    startDate,
    endDate
  };
}

async function importKlineData(options, logger = console) {
  await ensureKlineSchema();

  const {
    type,
    symbol,
    interval,
    priceType,
    startDate,
    endDate
  } = validateImportOptions(options);

  logger.log(`📥 开始导入数据: type=${type} symbol=${symbol} interval=${interval} priceType=${priceType} ${startDate}-${endDate}`);

  const isYearlyTimeframe = interval === '4hour' || interval === '8hour' ||
    interval === '12hour' || interval === '1day' ||
    interval === '1week' || interval === '1month';

  let totalImported = 0;
  let totalSkipped = 0;
  const errors = [];

  if (isYearlyTimeframe) {
    const years = generateYearRange(startDate, endDate);

    for (const year of years) {
      try {
        const data = await fetchImportBatch(type, symbol, interval, priceType, year, true);

        if (data.length > 0) {
          const startTimestamp = parseDateUTC(startDate).getTime();
          const endTimestamp = parseDateUTC(endDate).getTime() + 24 * 60 * 60 * 1000 - 1;
          const filteredData = data.filter(kline => {
            const klineTime = parseInt(kline.openTime, 10);
            return klineTime >= startTimestamp && klineTime <= endTimestamp;
          });

          if (filteredData.length > 0) {
            const result = await insertKlineData(symbol, interval, filteredData);
            totalImported += result.inserted;
            totalSkipped += result.skipped;
            logger.log(`✅ ${year}: 插入 ${result.inserted} 条, 跳过 ${result.skipped} 条`);
          } else {
            logger.log(`⚠️  ${year}: 过滤后无数据`);
          }
        } else {
          logger.log(`⚠️  ${year}: 无数据`);
        }

        await delay(300);
      } catch (error) {
        logger.error(`❌ ${year}: ${error.message}`);
        errors.push({ date: year, error: error.message });
      }
    }
  } else {
    const dates = generateDateRange(startDate, endDate);
    const nextDay = new Date(parseDate(endDate));
    nextDay.setDate(nextDay.getDate() + 1);
    dates.push(formatDate(nextDay));

    const allData = [];
    const batchSize = 50;
    let processedCount = 0;

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      let retries = 3;
      let success = false;

      while (retries > 0 && !success) {
        try {
          const data = await fetchImportBatch(type, symbol, interval, priceType, date, false);
          if (data.length > 0) {
            allData.push(...data);
          }
          success = true;
          processedCount++;

          if (processedCount % 10 === 0) {
            logger.log(`📥 进度: ${processedCount}/${dates.length} (${(processedCount / dates.length * 100).toFixed(1)}%)`);
          }

          await delay(200);
        } catch (error) {
          retries--;
          if (retries > 0) {
            logger.log(`⚠️  ${date}: ${error.message}, 重试剩余 ${retries} 次`);
            await delay(1000);
          } else {
            logger.error(`❌ ${date}: ${error.message} (已放弃)`);
            errors.push({ date, error: error.message });
          }
        }
      }

      if ((i + 1) % batchSize === 0 || i === dates.length - 1) {
        if (allData.length > 0) {
          const startTimestamp = parseDateUTC(startDate).getTime();
          const endTimestamp = parseDateUTC(endDate).getTime() + 24 * 60 * 60 * 1000 - 1;
          const filteredData = allData.filter(kline => {
            const klineTime = parseInt(kline.openTime, 10);
            return klineTime >= startTimestamp && klineTime <= endTimestamp;
          });

          if (filteredData.length > 0) {
            const result = await insertKlineData(symbol, interval, filteredData);
            totalImported += result.inserted;
            totalSkipped += result.skipped;
            logger.log(`💾 中间插入: 插入 ${result.inserted} 条, 跳过 ${result.skipped} 条`);
          }

          allData.length = 0;
        }
      }
    }
  }

  return {
    success: true,
    type,
    symbol,
    interval,
    priceType: MARKET_CONFIG[type].requiresPriceType ? priceType : null,
    imported: totalImported,
    skipped: totalSkipped,
    errors
  };
}

function generateDateRange(startDate, endDate) {
  const dates = [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  let current = new Date(start);
  while (current <= end) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function generateYearRange(startDate, endDate) {
  const years = [];
  const startYear = parseInt(startDate.substring(0, 4), 10);
  const endYear = parseInt(endDate.substring(0, 4), 10);

  for (let year = startYear; year <= endYear; year++) {
    years.push(String(year));
  }

  return years;
}

function parseDate(dateStr) {
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(4, 6), 10) - 1;
  const day = parseInt(dateStr.substring(6, 8), 10);
  return new Date(year, month, day);
}

function parseDateUTC(dateStr) {
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(4, 6), 10) - 1;
  const day = parseInt(dateStr.substring(6, 8), 10);
  return new Date(Date.UTC(year, month, day));
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchImportBatch(type, symbol, interval, priceType, dateOrYear, isYearly) {
  if (type !== 'fx') {
    const data = isYearly
      ? await fetchKlineDataYearly(type, symbol, interval, priceType, dateOrYear)
      : await fetchKlineDataDaily(type, symbol, interval, priceType, dateOrYear);
    return mapCoinData(data);
  }

  if (priceType !== 'BOTH') {
    const data = isYearly
      ? await fetchKlineDataYearly(type, symbol, interval, priceType, dateOrYear)
      : await fetchKlineDataDaily(type, symbol, interval, priceType, dateOrYear);
    return mapSingleSideData(data, priceType);
  }

  const [bidData, askData] = await Promise.all([
    isYearly
      ? fetchKlineDataYearly(type, symbol, interval, 'BID', dateOrYear)
      : fetchKlineDataDaily(type, symbol, interval, 'BID', dateOrYear),
    isYearly
      ? fetchKlineDataYearly(type, symbol, interval, 'ASK', dateOrYear)
      : fetchKlineDataDaily(type, symbol, interval, 'ASK', dateOrYear)
  ]);

  return mergeBidAskData(bidData, askData);
}

function mapSingleSideData(data, priceType) {
  return data.map(item => ({
    openTime: item.openTime,
    bid_open: item.open,
    bid_high: item.high,
    bid_low: item.low,
    bid_close: item.close,
    ask_open: item.open,
    ask_high: item.high,
    ask_low: item.low,
    ask_close: item.close,
    volume: item.volume || 0
  }));
}

function mergeBidAskData(bidData, askData) {
  const merged = new Map();

  for (const item of bidData) {
    merged.set(item.openTime, {
      openTime: item.openTime,
      bid_open: item.open,
      bid_high: item.high,
      bid_low: item.low,
      bid_close: item.close,
      volume: item.volume || 0
    });
  }

  for (const item of askData) {
    const existing = merged.get(item.openTime) || {
      openTime: item.openTime,
      volume: item.volume || 0
    };
    existing.ask_open = item.open;
    existing.ask_high = item.high;
    existing.ask_low = item.low;
    existing.ask_close = item.close;
    existing.volume = existing.volume || item.volume || 0;
    merged.set(item.openTime, existing);
  }

  return Array.from(merged.values())
    .filter(hasCompleteBidAskBar)
    .sort((a, b) => Number(a.openTime) - Number(b.openTime));
}

function hasCompleteBidAskBar(item) {
  return item.bid_open != null &&
    item.bid_high != null &&
    item.bid_low != null &&
    item.bid_close != null &&
    item.ask_open != null &&
    item.ask_high != null &&
    item.ask_low != null &&
    item.ask_close != null;
}

function mapCoinData(data) {
  return data.map(item => ({
    openTime: item.openTime,
    bid_open: item.open,
    bid_high: item.high,
    bid_low: item.low,
    bid_close: item.close,
    ask_open: item.open,
    ask_high: item.high,
    ask_low: item.low,
    ask_close: item.close,
    volume: item.volume || 0
  }));
}

function parseNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function ensureKlineSchema() {
  const requiredColumns = [
    ['bid_open', 'DECIMAL(10, 5) NULL AFTER open_time'],
    ['bid_high', 'DECIMAL(10, 5) NULL AFTER bid_open'],
    ['bid_low', 'DECIMAL(10, 5) NULL AFTER bid_high'],
    ['bid_close', 'DECIMAL(10, 5) NULL AFTER bid_low'],
    ['ask_open', 'DECIMAL(10, 5) NULL AFTER bid_close'],
    ['ask_high', 'DECIMAL(10, 5) NULL AFTER ask_open'],
    ['ask_low', 'DECIMAL(10, 5) NULL AFTER ask_high'],
    ['ask_close', 'DECIMAL(10, 5) NULL AFTER ask_low']
  ];

  for (const [name, ddl] of requiredColumns) {
    const [rows] = await db.query('SHOW COLUMNS FROM klines LIKE ?', [name]);
    if (rows.length === 0) {
      await db.query(`ALTER TABLE klines ADD COLUMN ${name} ${ddl}`);
    }
  }
}

function formatApiError(payload) {
  if (!payload) {
    return 'Empty response from GMO API';
  }

  const message = Array.isArray(payload.messages) && payload.messages.length > 0
    ? payload.messages
      .map(item => item.message_string || item.message_code)
      .filter(Boolean)
      .join('; ')
    : null;

  if (message) {
    return `GMO API error (status=${payload.status}): ${message}`;
  }

  return `GMO API error (status=${payload.status ?? 'unknown'})`;
}

module.exports = {
  importKlineData,
  clearKlineData,
  validateImportOptions,
  normalizeMarketType,
  ensureKlineSchema
};
