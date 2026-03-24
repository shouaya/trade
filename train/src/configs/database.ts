/**
 * 数据库连接池配置
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import mysql from 'mysql2';
import type { Pool } from 'mysql2/promise';
import {
  createMysqlPromisePool,
  loadEnvFiles,
  warmupMysqlConnection
} from '@money/database';

// Load order:
// 1) train/.env
// 2) backend/.env
// 3) repo root .env
loadEnvFiles(dotenv, [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../backend/.env'),
  path.resolve(__dirname, '../../../.env')
]);

const pool = createMysqlPromisePool(mysql, {
  overrides: {
    connectionLimit: 10,
    queueLimit: 0,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  }
}) as Pool;

void warmupMysqlConnection(pool, {
  successMessage: '✅ [train] 数据库连接成功，字符集: utf8mb4',
  failureMessage: '❌ [train] 数据库连接失败:'
});

export default pool;
