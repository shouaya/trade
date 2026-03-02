/**
 * 多时间周期K线数据导入脚本
 * 支持导入 1min, 15min, 30min, 1hour 等不同时间周期的数据
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// 数据库配置
const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'rootpassword',
  database: 'trading'
};

/**
 * 导入K线数据
 * @param {string} filePath - 数据文件路径
 * @param {string} symbol - 交易对 (如 'USDJPY')
 * @param {string} interval - 时间周期 (如 '15min', '30min', '1hour')
 */
async function importKlineData(filePath, symbol, interval) {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log(`\n📊 开始导入 ${symbol} ${interval} K线数据...`);
    console.log(`   文件路径: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`数据文件不存在: ${filePath}`);
    }

    // 读取数据文件
    let klineData;
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.json') {
      // JSON 格式
      const rawData = fs.readFileSync(filePath, 'utf8');
      klineData = JSON.parse(rawData);
    } else if (ext === '.csv') {
      // CSV 格式 - 假设格式为: timestamp,open,high,low,close,volume
      const rawData = fs.readFileSync(filePath, 'utf8');
      const lines = rawData.trim().split('\n');

      // 跳过标题行
      const dataLines = lines[0].includes('timestamp') || lines[0].includes('time')
        ? lines.slice(1)
        : lines;

      klineData = dataLines.map(line => {
        const [timestamp, open, high, low, close, volume] = line.split(',');
        return {
          openTime: parseInt(timestamp),
          open: parseFloat(open),
          high: parseFloat(high),
          low: parseFloat(low),
          close: parseFloat(close),
          volume: volume ? parseFloat(volume) : 0
        };
      });
    } else {
      throw new Error(`不支持的文件格式: ${ext}。请使用 .json 或 .csv 格式`);
    }

    console.log(`✅ 读取到 ${klineData.length} 条 K线数据`);

    if (klineData.length === 0) {
      throw new Error('数据文件为空');
    }

    // 批量插入
    const batchSize = 500;
    let totalInserted = 0;

    for (let i = 0; i < klineData.length; i += batchSize) {
      const batch = klineData.slice(i, i + batchSize);

      const values = batch.map(kline => [
        kline.openTime,
        kline.open,
        kline.high,
        kline.low,
        kline.close,
        kline.volume || 0,
        symbol,
        interval
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

      const [result] = await connection.query(query, [values]);
      totalInserted += result.affectedRows;

      const progress = Math.min(i + batch.length, klineData.length);
      const percentage = ((progress / klineData.length) * 100).toFixed(1);
      console.log(`   进度: ${progress}/${klineData.length} (${percentage}%)`);
    }

    console.log(`✅ ${symbol} ${interval} 导入完成: ${totalInserted} 条记录\n`);

    return totalInserted;

  } catch (error) {
    console.error(`❌ 导入失败:`, error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

/**
 * 显示数据库统计信息
 */
async function showStats() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    const [stats] = await connection.query(`
      SELECT
        symbol,
        interval_type,
        COUNT(*) as count,
        FROM_UNIXTIME(MIN(open_time)/1000) as earliest,
        FROM_UNIXTIME(MAX(open_time)/1000) as latest
      FROM klines
      GROUP BY symbol, interval_type
      ORDER BY symbol, interval_type
    `);

    console.log('\n' + '='.repeat(80));
    console.log('📈 数据库K线统计信息');
    console.log('='.repeat(80));

    stats.forEach(stat => {
      console.log(`\n${stat.symbol} - ${stat.interval_type}:`);
      console.log(`   数量: ${stat.count.toLocaleString()} 条`);
      console.log(`   最早: ${stat.earliest}`);
      console.log(`   最晚: ${stat.latest}`);
    });
    console.log('\n' + '='.repeat(80) + '\n');

  } finally {
    await connection.end();
  }
}

/**
 * 批量导入多个时间周期的数据
 */
async function batchImport(imports) {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 批量导入多时间周期K线数据');
  console.log('='.repeat(80));

  let totalImported = 0;

  for (const { filePath, symbol, interval } of imports) {
    try {
      const imported = await importKlineData(filePath, symbol, interval);
      totalImported += imported;
    } catch (error) {
      console.error(`⚠️  跳过 ${symbol} ${interval}: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`✅ 批量导入完成！总计导入: ${totalImported} 条记录`);
  console.log('='.repeat(80));

  // 显示统计信息
  await showStats();
}

// 命令行执行
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('用法:');
    console.log('  node import-multi-timeframe.js <数据文件> <交易对> <时间周期>');
    console.log('');
    console.log('示例:');
    console.log('  node import-multi-timeframe.js data/usdjpy_15min.json USDJPY 15min');
    console.log('  node import-multi-timeframe.js data/usdjpy_30min.csv USDJPY 30min');
    console.log('  node import-multi-timeframe.js data/usdjpy_1hour.json USDJPY 1hour');
    console.log('');
    console.log('批量导入示例:');
    console.log('  修改脚本底部的 batchImport 配置');
    process.exit(0);
  }

  const [filePath, symbol = 'USDJPY', interval = '15min'] = args;

  (async () => {
    try {
      await importKlineData(filePath, symbol, interval);
      await showStats();
      process.exit(0);
    } catch (error) {
      console.error('❌ 导入失败:', error);
      process.exit(1);
    }
  })();
}

module.exports = {
  importKlineData,
  showStats,
  batchImport
};
