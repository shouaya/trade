#!/usr/bin/env node

import db from '../configs/database';
import type * as mysql from 'mysql2/promise';

const PRESERVED_TABLES = new Set(['klines']);

async function closeDbQuietly(): Promise<void> {
  try {
    await db.end();
  } catch {
    // Ignore pool-close errors during shutdown.
  }
}

async function loadAllTables(): Promise<readonly string[]> {
  const [rows] = await db.query<mysql.RowDataPacket[]>('SHOW TABLES');
  return rows
    .map((row) => {
      const firstValue = Object.values(row)[0];
      return String(firstValue || '').trim();
    })
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

async function clearDatabase(): Promise<void> {
  const allTables = await loadAllTables();
  const targetTables = allTables.filter((tableName) => !PRESERVED_TABLES.has(tableName));

  console.log('='.repeat(80));
  console.log('🧹 开始清理数据库（保留 klines）');
  console.log('='.repeat(80));
  console.log('');

  if (!targetTables.length) {
    console.log('没有需要清理的表。');
    return;
  }

  console.log(`保留表: ${Array.from(PRESERVED_TABLES).join(', ')}`);
  console.log(`清理表数: ${targetTables.length}`);
  console.log('');

  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const tableName of targetTables) {
      console.log(`🗑️  TRUNCATE ${tableName}`);
      await db.query(`TRUNCATE TABLE ${tableName}`);
    }
  } finally {
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  console.log('');
  console.log('✅ 数据库清理完成（klines 已保留）');
}

async function main(): Promise<void> {
  try {
    await clearDatabase();
    await closeDbQuietly();
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    console.error('\n❌ 数据库清理失败:', message);
    if (stack) {
      console.error(stack);
    }
    await closeDbQuietly();
    process.exit(1);
  }
}

void main();
