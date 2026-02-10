const axios = require('axios');

// 测试 GMO Coin Forex API
async function testAPI() {
  const BASE_URL = 'https://forex-api.coin.z.com/public';

  // 测试拉取 2025 年 1 月 1 日的数据
  const testDate = '20250101';

  try {
    console.log('测试 GMO Coin Forex API...');
    console.log(`拉取日期: ${testDate}`);
    console.log();

    const url = `${BASE_URL}/v1/klines`;
    const params = {
      symbol: 'USD_JPY',
      priceType: 'BID',
      interval: '1min',
      date: testDate
    };

    console.log('请求 URL:', url);
    console.log('参数:', params);
    console.log();

    const response = await axios.get(url, { params });

    console.log('响应状态:', response.status);
    console.log('响应数据:');
    console.log(JSON.stringify(response.data, null, 2));

    if (response.data && response.data.data) {
      console.log(`\n成功！获取到 ${response.data.data.length} 条数据`);
      if (response.data.data.length > 0) {
        console.log('\n第一条数据示例:');
        console.log(response.data.data[0]);
      }
    }
  } catch (error) {
    console.error('请求失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    }
  }
}

testAPI();
