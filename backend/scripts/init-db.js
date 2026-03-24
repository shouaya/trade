#!/usr/bin/env node

const { KLINES_DDL, ensureKlineSchema } = require('@money/database');
const db = require('../config/database');

async function ensureKlinesTable() {
  await db.query('DROP TABLE IF EXISTS klines');
  await db.query(KLINES_DDL);
  await ensureKlineSchema(db);
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
