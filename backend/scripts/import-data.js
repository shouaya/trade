require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

async function importKlineData() {
  try {
    console.log('📊 开始导入 K 线数据...');

    // 读取 JSON 数据文件
    const dataPath = path.join(__dirname, '../../data/sample_data.json');

    if (!fs.existsSync(dataPath)) {
      console.error('❌ 数据文件不存在:', dataPath);
      console.log('💡 请先运行 npm run fetch:sample 生成数据');
      process.exit(1);
    }

    const rawData = fs.readFileSync(dataPath, 'utf8');
    const klineData = JSON.parse(rawData);

    console.log(`✅ 读取到 ${klineData.length} 条 K 线数据`);

    // 准备批量插入
    const batchSize = 500;
    let inserted = 0;
    let updated = 0;

    for (let i = 0; i < klineData.length; i += batchSize) {
      const batch = klineData.slice(i, i + batchSize);

      const values = batch.map(kline => [
        kline.openTime,
        kline.open,
        kline.high,
        kline.low,
        kline.close,
        kline.volume || 0,
        'USDJPY',
        '1m'
      ]);

      const query = `
        INSERT INTO klines (open_time, open, high, low, close, volume, symbol, interval_type)
        VALUES ?
        ON DUPLICATE KEY UPDATE
          open = VALUES(open),
          high = VALUES(high),
          low = VALUES(low),
          close = VALUES(close),
          volume = VALUES(volume)
      `;

      const [result] = await db.query(query, [values]);

      const batchInserted = result.affectedRows;
      inserted += batchInserted;

      console.log(`   处理 ${i + batch.length}/${klineData.length} (插入/更新: ${batchInserted})`);
    }

    console.log(`\n✅ 数据导入完成!`);
    console.log(`   总计处理: ${klineData.length} 条`);
    console.log(`   插入/更新: ${inserted} 条`);

    // 显示统计信息
    const [stats] = await db.query(`
      SELECT
        symbol,
        interval_type,
        COUNT(*) as count,
        FROM_UNIXTIME(MIN(open_time)/1000) as earliest,
        FROM_UNIXTIME(MAX(open_time)/1000) as latest
      FROM klines
      GROUP BY symbol, interval_type
    `);

    console.log('\n📈 数据库统计:');
    stats.forEach(stat => {
      console.log(`   ${stat.symbol} ${stat.interval_type}: ${stat.count} 条`);
      console.log(`   时间范围: ${stat.earliest} 至 ${stat.latest}`);
    });

    process.exit(0);

  } catch (error) {
    console.error('❌ 导入失败:', error);
    process.exit(1);
  }
}

// 执行导入
importKlineData();
