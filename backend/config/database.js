const mysql = require('mysql2');

// 创建连接池
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'trader',
  password: process.env.DB_PASSWORD || 'traderpass',
  database: process.env.DB_NAME || 'trading',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Promise 包装
const promisePool = pool.promise();

// 测试连接
pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
    return;
  }
  console.log('✅ 数据库连接成功');
  connection.release();
});

module.exports = promisePool;
