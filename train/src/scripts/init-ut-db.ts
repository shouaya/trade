#!/usr/bin/env node

import * as dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import {
  INIT_DDLS,
  TABLES,
  ensureBacktestResultsSchema,
  ensureKlineSchema,
  ensureTrainArtifactsSchema,
  ensureTrainConfigsSchema,
  ensureTrainDataTraceSchema,
  ensureTrainGoalTrackingSchema,
  ensureTrainRunRequestsSchema,
  getMysqlConnectionOptions
} from '@money/database';
import { loadTrainEnv } from '../utils/train-env';

loadTrainEnv(dotenv);

const UT_DB_NAME = String(process.env['UT_DB_NAME'] || 'trading_ut').trim() || 'trading_ut';
const UT_DB_ADMIN_USER = String(process.env['UT_DB_ADMIN_USER'] || 'root').trim() || 'root';
const UT_DB_ADMIN_PASSWORD = String(process.env['UT_DB_ADMIN_PASSWORD'] || 'rootpassword');
const APP_DB_USER = String(process.env['DB_USER'] || 'trader').trim() || 'trader';
const APP_DB_PASSWORD = String(process.env['DB_PASSWORD'] || 'traderpass');

async function createDatabase(): Promise<void> {
  const admin = await mysql.createConnection({
    host: process.env['DB_HOST'] || '127.0.0.1',
    port: Number(process.env['DB_PORT'] || 3306),
    user: UT_DB_ADMIN_USER,
    password: UT_DB_ADMIN_PASSWORD,
    charset: 'utf8mb4'
  });

  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${UT_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await admin.query(
      `CREATE USER IF NOT EXISTS '${APP_DB_USER}'@'%' IDENTIFIED BY ?`,
      [APP_DB_PASSWORD]
    );
    await admin.query(
      `ALTER USER '${APP_DB_USER}'@'%' IDENTIFIED BY ?`,
      [APP_DB_PASSWORD]
    );
    await admin.query(
      `GRANT ALL PRIVILEGES ON \`${UT_DB_NAME}\`.* TO '${APP_DB_USER}'@'%'`
    );
    await admin.query('FLUSH PRIVILEGES');
  } finally {
    await admin.end();
  }
}

async function resetSchema(): Promise<void> {
  const connection = await mysql.createConnection({
    ...getMysqlConnectionOptions({
      defaults: {
        host: '127.0.0.1',
        database: UT_DB_NAME
      },
      overrides: {
        database: UT_DB_NAME
      }
    })
  });

  const tableNames = Object.values(TABLES).reverse();

  try {
    await connection.query("SET NAMES 'utf8mb4'");
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const tableName of tableNames) {
      await connection.query(`DROP TABLE IF EXISTS ${tableName}`);
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    for (const ddl of INIT_DDLS) {
      await connection.query(ddl);
    }

    await ensureKlineSchema(connection);
    await ensureBacktestResultsSchema(connection);
    await ensureTrainDataTraceSchema(connection);
    await ensureTrainConfigsSchema(connection);
    await ensureTrainRunRequestsSchema(connection);
    await ensureTrainGoalTrackingSchema(connection);
    await ensureTrainArtifactsSchema(connection);
  } finally {
    await connection.end();
  }
}

async function main(): Promise<void> {
  console.log(`🧪 初始化 UT 数据库: ${UT_DB_NAME}`);
  await createDatabase();
  await resetSchema();
  console.log(`✅ UT 数据库已重建: ${UT_DB_NAME}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
