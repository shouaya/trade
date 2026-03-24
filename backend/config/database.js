const path = require('path');
const mysql = require('mysql2');
const {
  createMysqlPromisePool,
  loadEnvFiles,
  warmupMysqlConnection
} = require('@money/database');

loadEnvFiles(require('dotenv'), [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env')
]);

const db = createMysqlPromisePool(mysql, {
  overrides: {
    connectionLimit: 10,
    queueLimit: 0,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  }
});

void warmupMysqlConnection(db, {
  successMessage: '✅ 数据库连接成功，字符集: utf8mb4',
  failureMessage: '❌ 数据库连接失败:'
});

module.exports = db;
