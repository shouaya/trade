const mysql = require('mysql2');

// 创建连接池
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

// Promise 包装
const promisePool = pool.promise();

// 测试连接并设置字符集
pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
    return;
  }

  // 确保字符集正确
  connection.query("SET NAMES 'utf8mb4'", (error) => {
    if (error) {
      console.error('❌ 设置字符集失败:', error.message);
    } else {
      console.log('✅ 数据库连接成功，字符集: utf8mb4');
    }
    connection.release();
  });
});

module.exports = promisePool;
