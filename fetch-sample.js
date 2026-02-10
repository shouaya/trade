const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 测试脚本 - 只拉取最近 3 天的数据
const BASE_URL = 'https://forex-api.coin.z.com/public';
const SYMBOL = 'USD_JPY';
const INTERVAL = '1min';
const PRICE_TYPE = 'BID';

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
      console.log(`✗ ${date}: 无数据`);
      return [];
    }
  } catch (error) {
    console.error(`✗ ${date}: 请求出错 - ${error.message}`);
    return [];
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('='.repeat(60));
  console.log('GMO Coin 数据拉取测试（最近3天）');
  console.log('='.repeat(60));
  console.log();

  // 拉取最近 3 天的数据
  const testDates = ['20250206', '20250207', '20250210'];
  const allData = [];

  for (const date of testDates) {
    const data = await fetchKlineData(date);
    allData.push(...data);
    await delay(500);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`总计获取 ${allData.length} 条数据`);
  console.log('='.repeat(60));

  // 保存示例数据
  if (allData.length > 0) {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const sampleFile = path.join(dataDir, 'sample_data.json');
    fs.writeFileSync(sampleFile, JSON.stringify(allData, null, 2), 'utf8');
    console.log(`\n示例数据已保存到: ${sampleFile}`);

    // 显示前 3 条数据
    console.log('\n前 3 条数据示例:');
    allData.slice(0, 3).forEach((item, index) => {
      const datetime = new Date(parseInt(item.openTime)).toISOString();
      console.log(`${index + 1}. ${datetime} - O:${item.open} H:${item.high} L:${item.low} C:${item.close}`);
    });
  }
}

main();
