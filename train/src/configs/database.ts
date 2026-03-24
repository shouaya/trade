/**
 * 数据库连接池配置
 */

import * as dotenv from 'dotenv';
import mysql from 'mysql2';
import type { Pool } from 'mysql2/promise';
import {
  createMysqlPromisePool,
  warmupMysqlConnection
} from '@money/database';
import { loadTrainEnv } from '../utils/train-env';

// Load order:
// 1) train/.env.test (NODE_ENV=test only)
// 2) train/.env
// 3) backend/.env
// 4) repo root .env
loadTrainEnv(dotenv);

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
