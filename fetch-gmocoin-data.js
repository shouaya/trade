const axios = require('axios');
const fs = require('fs');
const path = require('path');

// GMO Coin Forex API 配置
const BASE_URL = 'https://forex-api.coin.z.com/public';
const SYMBOL = 'USD_JPY';
const INTERVAL = '1min';
const PRICE_TYPE = 'BID'; // 可以选择 BID 或 ASK

/**
 * 生成日期范围 (YYYYMMDD 格式)
 * @param {string} startDate - 开始日期 YYYYMMDD
 * @param {string} endDate - 结束日期 YYYYMMDD
 * @returns {string[]} 日期数组
 */
function generateDateRange(startDate, endDate) {
  const dates = [];
  const start = new Date(
    startDate.substring(0, 4),
    parseInt(startDate.substring(4, 6)) - 1,
    startDate.substring(6, 8)
  );
  const end = new Date(
    endDate.substring(0, 4),
    parseInt(endDate.substring(4, 6)) - 1,
    endDate.substring(6, 8)
  );

  const current = new Date(start);
  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}${month}${day}`);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * 延迟函数，避免 API 请求过于频繁
 * @param {number} ms - 延迟毫秒数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 获取指定日期的 K 线数据
 * @param {string} date - 日期 YYYYMMDD
 * @returns {Promise<Object[]>} K 线数据数组
 */
async function fetchKlineData(date) {
  try {
    const url = `${BASE_URL}/v1/klines`;
    const params = {
      symbol: SYMBOL,
      priceType: PRICE_TYPE,
      interval: INTERVAL,
      date: date
    };

    console.log(`正在拉取 ${date} 的数据...`);
    const response = await axios.get(url, { params });

    if (response.data && response.data.status === 0 && response.data.data) {
      console.log(`✓ ${date}: 成功获取 ${response.data.data.length} 条数据`);
      return response.data.data;
    } else {
      console.log(`✗ ${date}: 无数据或请求失败`);
      return [];
    }
  } catch (error) {
    console.error(`✗ ${date}: 请求出错 - ${error.message}`);
    return [];
  }
}

/**
 * 保存数据到 JSON 文件
 * @param {Object[]} allData - 所有 K 线数据
 * @param {string} filename - 文件名
 */
function saveToFile(allData, filename) {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const filePath = path.join(dataDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(allData, null, 2), 'utf8');
  console.log(`\n数据已保存到: ${filePath}`);
  console.log(`总计: ${allData.length} 条 K 线数据`);
}

/**
 * 主函数
 */
async function main() {
  console.log('='.repeat(60));
  console.log('GMO Coin USD/JPY 1分钟 K线数据拉取工具');
  console.log('='.repeat(60));
  console.log(`交易对: ${SYMBOL}`);
  console.log(`时间间隔: ${INTERVAL}`);
  console.log(`价格类型: ${PRICE_TYPE}`);
  console.log('='.repeat(60));
  console.log('注意: 根据 GMO Coin API 文档');
  console.log('      1分钟数据仅从 2023-10-28 开始提供');
  console.log('      数据每天 JST 06:00 更新');
  console.log('='.repeat(60));
  console.log();

  // 生成 2025-01-01 到今天的日期范围
  const startDate = '20250101';
  const today = new Date();
  const endDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  console.log(`时间范围: ${startDate} 至 ${endDate}`);
  console.log();

  const dates = generateDateRange(startDate, endDate);

  console.log(`需要拉取 ${dates.length} 天的数据\n`);

  const allKlineData = [];
  let successCount = 0;
  let failCount = 0;

  // 遍历每一天拉取数据
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const data = await fetchKlineData(date);

    if (data.length > 0) {
      allKlineData.push(...data);
      successCount++;
    } else {
      failCount++;
    }

    // 每 10 个请求延迟 1 秒，避免请求过于频繁
    if ((i + 1) % 10 === 0) {
      console.log(`已处理 ${i + 1}/${dates.length} 天，休息 1 秒...`);
      await delay(1000);
    } else {
      await delay(200); // 每个请求之间间隔 200ms
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('数据拉取完成！');
  console.log(`成功: ${successCount} 天`);
  console.log(`失败/无数据: ${failCount} 天`);
  console.log('='.repeat(60));

  // 保存数据
  if (allKlineData.length > 0) {
    const filename = `usdjpy_1min_${startDate}_${endDate}_${PRICE_TYPE.toLowerCase()}.json`;
    saveToFile(allKlineData, filename);

    // 额外保存一份 CSV 格式（可选）
    saveToCsv(allKlineData, `usdjpy_1min_${startDate}_${endDate}_${PRICE_TYPE.toLowerCase()}.csv`);
  } else {
    console.log('\n没有数据可保存！');
  }
}

/**
 * 保存数据到 CSV 文件
 * @param {Object[]} allData - 所有 K 线数据
 * @param {string} filename - 文件名
 */
function saveToCsv(allData, filename) {
  const dataDir = path.join(__dirname, 'data');
  const filePath = path.join(dataDir, filename);

  // CSV 表头
  const header = 'timestamp,datetime,open,high,low,close\n';

  // 转换数据为 CSV 格式
  const rows = allData.map(item => {
    const datetime = new Date(parseInt(item.openTime)).toISOString();
    return `${item.openTime},${datetime},${item.open},${item.high},${item.low},${item.close}`;
  }).join('\n');

  fs.writeFileSync(filePath, header + rows, 'utf8');
  console.log(`CSV 数据已保存到: ${filePath}`);
}

// 运行主函数
main().catch(error => {
  console.error('程序执行出错:', error);
  process.exit(1);
});
