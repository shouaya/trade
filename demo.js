const fs = require('fs');
const path = require('path');
const {
  TradingSimulator,
  printTradeResult,
  printBacktestStatistics
} = require('./trading-simulator');

/**
 * 加载 K线数据
 */
function loadKlineData(filename = 'sample_data.json') {
  const dataPath = path.join(__dirname, 'data', filename);

  if (!fs.existsSync(dataPath)) {
    console.error(`❌ 数据文件不存在: ${dataPath}`);
    console.log('请先运行 npm run fetch:sample 获取数据');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`✅ 已加载 ${data.length} 条 K线数据\n`);
  return data;
}

/**
 * 示例 1: 简单的做多交易
 */
function example1_SimpleLong() {
  console.log('\n' + '═'.repeat(70));
  console.log('示例 1: 简单的做多交易（无止损止盈）');
  console.log('═'.repeat(70));

  const klineData = loadKlineData();
  const simulator = new TradingSimulator(klineData);

  // 在 2025-02-06 08:00 做多，持仓 60 分钟
  const trade = {
    entryTime: '2025-02-06T08:00:00.000Z',
    direction: 'long',
    holdMinutes: 60,
    lotSize: 1
  };

  const result = simulator.simulateTrade(trade);
  printTradeResult(result);
}

/**
 * 示例 2: 带止损止盈的做空交易
 */
function example2_ShortWithStops() {
  console.log('\n' + '═'.repeat(70));
  console.log('示例 2: 带止损止盈的做空交易');
  console.log('═'.repeat(70));

  const klineData = loadKlineData();
  const simulator = new TradingSimulator(klineData);

  // 在 2025-02-06 10:00 做空，入场价 152.5，止损 152.8，止盈 151.8
  const trade = {
    entryTime: '2025-02-06T10:00:00.000Z',
    direction: 'short',
    entryPrice: 152.5,
    holdMinutes: 120,
    stopLoss: 152.8,    // 止损：价格上涨到 152.8
    takeProfit: 151.8,  // 止盈：价格下跌到 151.8
    lotSize: 2
  };

  const result = simulator.simulateTrade(trade);
  printTradeResult(result);
}

/**
 * 示例 3: 触发止损的交易
 */
function example3_StopLossTrigger() {
  console.log('\n' + '═'.repeat(70));
  console.log('示例 3: 触发止损的交易示例');
  console.log('═'.repeat(70));

  const klineData = loadKlineData();
  const simulator = new TradingSimulator(klineData);

  // 做多但设置了较紧的止损
  const trade = {
    entryTime: '2025-02-06T12:00:00.000Z',
    direction: 'long',
    entryPrice: 152.0,
    holdMinutes: 180,
    stopLoss: 151.8,    // 止损：价格下跌到 151.8
    takeProfit: 153.0,  // 止盈：价格上涨到 153.0
    lotSize: 1
  };

  const result = simulator.simulateTrade(trade);
  printTradeResult(result);
}

/**
 * 示例 4: 批量回测多个交易
 */
function example4_Backtest() {
  console.log('\n' + '═'.repeat(70));
  console.log('示例 4: 批量回测多个交易');
  console.log('═'.repeat(70));

  const klineData = loadKlineData();
  const simulator = new TradingSimulator(klineData);

  // 定义多个交易策略
  const trades = [
    {
      entryTime: '2025-02-06T08:00:00.000Z',
      direction: 'long',
      holdMinutes: 60,
      stopLoss: 151.5,
      takeProfit: 153.0,
      lotSize: 1
    },
    {
      entryTime: '2025-02-06T12:00:00.000Z',
      direction: 'short',
      holdMinutes: 90,
      stopLoss: 152.5,
      takeProfit: 151.0,
      lotSize: 1
    },
    {
      entryTime: '2025-02-07T08:00:00.000Z',
      direction: 'long',
      holdMinutes: 120,
      stopLoss: 150.5,
      takeProfit: 152.5,
      lotSize: 2
    },
    {
      entryTime: '2025-02-07T14:00:00.000Z',
      direction: 'short',
      holdMinutes: 60,
      stopLoss: 152.0,
      takeProfit: 150.5,
      lotSize: 1
    }
  ];

  const backtest = simulator.backtestMultiple(trades);

  // 打印每个交易的结果
  backtest.results.forEach((result, index) => {
    printTradeResult(result, index);
    console.log('\n');
  });

  // 打印统计信息
  printBacktestStatistics(backtest.statistics);
}

/**
 * 主菜单
 */
function main() {
  const args = process.argv.slice(2);

  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║           USD/JPY 交易模拟器 - 使用示例                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  if (args.length === 0) {
    console.log('\n使用方法:');
    console.log('  node demo.js [示例编号]');
    console.log('\n可用示例:');
    console.log('  1 - 简单的做多交易（无止损止盈）');
    console.log('  2 - 带止损止盈的做空交易');
    console.log('  3 - 触发止损的交易示例');
    console.log('  4 - 批量回测多个交易');
    console.log('  all - 运行所有示例');
    console.log('\n示例:');
    console.log('  node demo.js 1');
    console.log('  node demo.js all');
    console.log('\n');
    return;
  }

  const example = args[0];

  switch (example) {
    case '1':
      example1_SimpleLong();
      break;
    case '2':
      example2_ShortWithStops();
      break;
    case '3':
      example3_StopLossTrigger();
      break;
    case '4':
      example4_Backtest();
      break;
    case 'all':
      example1_SimpleLong();
      example2_ShortWithStops();
      example3_StopLossTrigger();
      example4_Backtest();
      break;
    default:
      console.log(`\n❌ 未知示例: ${example}`);
      console.log('请使用 1、2、3、4 或 all\n');
  }
}

// 运行主程序
main();
