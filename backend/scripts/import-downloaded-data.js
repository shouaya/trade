#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  insertKlineData,
  ensureKlineSchema
} = require('../lib/kline-importer');

function parseArgs(argv) {
  const args = {};

  for (const rawArg of argv.slice(2)) {
    const arg = String(rawArg).trim();
    if (!arg) continue;

    const normalized = arg.startsWith('--') ? arg.slice(2) : arg;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    const value = normalized.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    args[key] = value;
  }

  return args;
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().replace(/['"]/g, '');
}

function normalizeInterval(interval) {
  return String(interval || '1min').trim().replace(/['"]/g, '');
}

function sanitizeDate(dateStr, fieldName) {
  const value = String(dateStr || '').trim().replace(/['"]/g, '');
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`${fieldName} must be in YYYYMMDD format`);
  }
  return value;
}

function parseDate(dateStr) {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10) - 1;
  const day = parseInt(dateStr.slice(6, 8), 10);
  return new Date(year, month, day);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function generateDateRange(startDate, endDate) {
  const dates = [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    dates.push(formatDate(current));
  }

  return dates;
}

function validateOptions(options) {
  const symbol = normalizeSymbol(options.symbol);
  const interval = normalizeInterval(options.interval);
  const startDate = sanitizeDate(options.startDate, 'startDate');
  const endDate = sanitizeDate(options.endDate, 'endDate');
  const inputDir = options.inputDir
    ? path.resolve(options.inputDir)
    : path.resolve(__dirname, '..', '..', 'data', 'gmo', 'coin', symbol, interval);

  if (!symbol) {
    throw new Error('symbol is required');
  }

  if (startDate > endDate) {
    throw new Error('startDate must be less than or equal to endDate');
  }

  return {
    symbol,
    interval,
    startDate,
    endDate,
    inputDir
  };
}

function mapStoredData(items) {
  return items.map(item => {
    if (item.bid_open != null || item.ask_open != null) {
      return item;
    }

    return {
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
    };
  });
}

async function main() {
  const options = validateOptions(parseArgs(process.argv));
  const dates = generateDateRange(options.startDate, options.endDate);

  await ensureKlineSchema();

  let imported = 0;
  let skipped = 0;
  let missing = 0;

  console.log(`📥 开始从本地导入: symbol=${options.symbol} interval=${options.interval} ${options.startDate}-${options.endDate}`);
  console.log(`📁 输入目录: ${options.inputDir}`);

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const filePath = path.join(options.inputDir, date.slice(0, 4), `${date}.json`);

    if (!fs.existsSync(filePath)) {
      missing++;
      console.warn(`⚠️  缺少文件: ${filePath}`);
      continue;
    }

    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const mapped = mapStoredData(Array.isArray(payload.data) ? payload.data : []);
    const result = await insertKlineData(options.symbol, options.interval, mapped);
    imported += result.inserted;
    skipped += result.skipped;

    if ((i + 1) % 25 === 0 || i === dates.length - 1) {
      console.log(`📦 进度: ${i + 1}/${dates.length} | 插入 ${imported} | 跳过 ${skipped} | 缺失文件 ${missing}`);
    }
  }

  console.log('');
  console.log('✅ 本地导入完成');
  console.log(JSON.stringify({
    symbol: options.symbol,
    interval: options.interval,
    startDate: options.startDate,
    endDate: options.endDate,
    imported,
    skipped,
    missing
  }, null, 2));
}

main().catch(error => {
  console.error(`❌ 本地导入失败: ${error.message}`);
  process.exit(1);
});
