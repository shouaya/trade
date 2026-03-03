const path = require('path');
const mysql = require('mysql2');
const dotenv = require('dotenv');

// 加载顺序（先加载的优先级更高，dotenv 默认不覆盖已存在变量）:
// 1) train/.env
// 2) backend/.env
// 3) 项目根 .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'trader',
  password: process.env.DB_PASSWORD || 'traderpass',
  database: process.env.DB_NAME || 'trading',
  charset: 'utf8mb4',
  connectionLimit: 10,
  queueLimit: 0,
  waitForConnections: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

const promisePool = pool.promise();

pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ [train] 数据库连接失败:', err.message);
    return;
  }

  connection.query("SET NAMES 'utf8mb4'", (error) => {
    if (error) {
      console.error('❌ [train] 设置字符集失败:', error.message);
    } else {
      console.log('✅ [train] 数据库连接成功，字符集: utf8mb4');
    }
    connection.release();
  });
});

module.exports = promisePool;
