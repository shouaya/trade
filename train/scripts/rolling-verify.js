const mysql = require('mysql2/promise');
require('dotenv').config();

const MONTHS = [
  '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02'
];

async function verifyRollingWindowData() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log('\n月份\t\t训练策略数\t验证结果数');
  console.log('─'.repeat(60));

  for (const month of MONTHS) {
    const trainTable = `backtest_results_rolling_${month.replace('-', '_')}_train`;
    const validateTable = `backtest_results_rolling_${month.replace('-', '_')}_validate`;

    let trainCount = '表不存在';
    let validateCount = '表不存在';

    try {
      const [train] = await db.query(`SELECT COUNT(*) as cnt FROM ${trainTable}`);
      trainCount = train[0].cnt;
    } catch (e) {
      // Table doesn't exist
    }

    try {
      const [validate] = await db.query(`SELECT COUNT(*) as cnt FROM ${validateTable}`);
      validateCount = validate[0].cnt;
    } catch (e) {
      // Table doesn't exist
    }

    console.log(`${month}\t\t${trainCount}\t\t${validateCount}`);
  }

  await db.end();
}

verifyRollingWindowData().catch(console.error);
