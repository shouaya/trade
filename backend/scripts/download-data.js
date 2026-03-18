#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');

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

function validateDownloadOptions(options) {
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
    throw new Error('priceType must be BID, ASK, or BOTH for fx download');
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

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function parseDate(dateStr) {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10) - 1;
  const day = parseInt(dateStr.slice(6, 8), 10);
  return new Date(year, month, day);
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

async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchDailyPayload({ type, symbol, interval, priceType, date }) {
  const market = MARKET_CONFIG[normalizeMarketType(type)];
  const params = {
    symbol,
    interval,
    date
  };

  if (market.requiresPriceType) {
    params.priceType = priceType;
  }

  const response = await axios.get(`${market.baseUrl}/v1/klines`, {
    params,
    timeout: 15000
  });

  if (response.data && response.data.status === 0 && Array.isArray(response.data.data)) {
    return response.data;
  }

  throw new Error(`unexpected response for ${date}: ${JSON.stringify(response.data)}`);
}

async function main() {
  const rawArgs = parseArgs(process.argv);
  const validated = validateDownloadOptions(rawArgs);
  const outDir = rawArgs.outDir
    ? path.resolve(rawArgs.outDir)
    : path.resolve(__dirname, '..', '..', 'data', 'gmo', validated.type, validated.symbol, validated.interval);

  fs.mkdirSync(outDir, { recursive: true });

  const dates = generateDateRange(validated.startDate, validated.endDate);
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`📥 开始下载: type=${validated.type} symbol=${validated.symbol} interval=${validated.interval} ${validated.startDate}-${validated.endDate}`);
  console.log(`📁 输出目录: ${outDir}`);

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const yearDir = path.join(outDir, date.slice(0, 4));
    const filePath = path.join(yearDir, `${date}.json`);
    fs.mkdirSync(yearDir, { recursive: true });

    if (fs.existsSync(filePath)) {
      skipped++;
      if ((i + 1) % 25 === 0 || i === dates.length - 1) {
        console.log(`⏭️  进度: ${i + 1}/${dates.length} | 已下载 ${downloaded} | 已跳过 ${skipped} | 失败 ${failed}`);
      }
      continue;
    }

    let retries = 3;
    while (retries > 0) {
      try {
        const payload = await fetchDailyPayload({
          type: validated.type,
          symbol: validated.symbol,
          interval: validated.interval,
          priceType: validated.priceType,
          date
        });

        const output = {
          type: validated.type,
          symbol: validated.symbol,
          interval: validated.interval,
          priceType: MARKET_CONFIG[validated.type].requiresPriceType ? validated.priceType : null,
          date,
          count: payload.data.length,
          responsetime: payload.responsetime ?? null,
          data: payload.data
        };

        fs.writeFileSync(filePath, JSON.stringify(output) + '\n', 'utf8');
        downloaded++;
        break;
      } catch (error) {
        retries--;
        if (retries === 0) {
          failed++;
          console.error(`❌ ${date}: ${error.message}`);
        } else {
          console.log(`⚠️  ${date}: ${error.message}, 重试剩余 ${retries} 次`);
          await delay(1000);
        }
      }
    }

    if ((i + 1) % 25 === 0 || i === dates.length - 1) {
      console.log(`📦 进度: ${i + 1}/${dates.length} | 已下载 ${downloaded} | 已跳过 ${skipped} | 失败 ${failed}`);
    }

    await delay(150);
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    type: validated.type,
    symbol: validated.symbol,
    interval: validated.interval,
    priceType: MARKET_CONFIG[validated.type].requiresPriceType ? validated.priceType : null,
    startDate: validated.startDate,
    endDate: validated.endDate,
    downloaded,
    skipped,
    failed,
    generatedAt: new Date().toISOString()
  }, null, 2) + '\n', 'utf8');

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`❌ 下载失败: ${error.message}`);
  process.exit(1);
});
