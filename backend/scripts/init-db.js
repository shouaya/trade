#!/usr/bin/env node

const db = require('../config/database');
const { ensureKlineSchema } = require('../lib/kline-importer');

async function ensureKlinesTable() {
  await db.query('DROP TABLE IF EXISTS klines');
  await db.query(`
    CREATE TABLE klines (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      open_time BIGINT NOT NULL,
      bid_open DECIMAL(10, 5) NOT NULL,
      bid_high DECIMAL(10, 5) NOT NULL,
      bid_low DECIMAL(10, 5) NOT NULL,
      bid_close DECIMAL(10, 5) NOT NULL,
      ask_open DECIMAL(10, 5) NOT NULL,
      ask_high DECIMAL(10, 5) NOT NULL,
      ask_low DECIMAL(10, 5) NOT NULL,
      ask_close DECIMAL(10, 5) NOT NULL,
      volume DECIMAL(20, 8) DEFAULT 0,
      symbol VARCHAR(20) DEFAULT 'USDJPY',
      interval_type VARCHAR(10) DEFAULT '1m',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_kline (symbol, interval_type, open_time),
      INDEX idx_open_time (open_time),
      INDEX idx_symbol_time (symbol, open_time)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureKlineSchema();
}

async function main() {
  try {
    console.log('🗄️  初始化 backend 数据表...');
    await ensureKlinesTable();
    console.log('✅ klines 表已重建');

    await db.end();
    process.exit(0);
  } catch (error) {
    console.error(`❌ backend 数据库初始化失败: ${error.message}`);
    await db.end();
    process.exit(1);
  }
}

void main();
