const fs = require('fs');
const path = require('path');
const readline = require('readline-sync');
const {
  TradingSimulator,
  printTradeResult,
  printBacktestStatistics
} = require('./trading-simulator');

/**
 * 加载 K线数据
 */
function loadKlineData() {
  const dataDir = path.join(__dirname, 'data');

  if (!fs.existsSync(dataDir)) {
    console.error('❌ data 目录不存在');
    console.log('请先运行 npm run fetch:sample 获取数据');
    process.exit(1);
  }

  // 查找所有 JSON 数据文件
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    console.error('❌ 没有找到数据文件');
    console.log('请先运行 npm run fetch:sample 获取数据');
    process.exit(1);
  }

  console.log('\n可用的数据文件:');
  files.forEach((file, index) => {
    const filePath = path.join(dataDir, file);
    const stats = fs.statSync(filePath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    console.log(`  ${index + 1}. ${file} (${sizeKB} KB)`);
  });

  const choice = readline.questionInt('\n选择数据文件 (输入编号): ');

  if (choice < 1 || choice > files.length) {
    console.error('❌ 无效的选择');
    process.exit(1);
  }

  const selectedFile = files[choice - 1];
  const dataPath = path.join(dataDir, selectedFile);
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  console.log(`✅ 已加载 ${data.length} 条 K线数据\n`);

  // 显示数据时间范围
  if (data.length > 0) {
    const startTime = new Date(parseInt(data[0].openTime)).toISOString();
    const endTime = new Date(parseInt(data[data.length - 1].openTime)).toISOString();
    console.log(`数据时间范围: ${startTime} 至 ${endTime}\n`);
  }

  return data;
}

/**
 * 交互式输入交易参数
 */
function inputTradeParameters(klineData) {
  console.log('═'.repeat(70));
  console.log('请输入交易参数:');
  console.log('═'.repeat(70));

  // 显示可用的时间范围
  const firstKline = klineData[0];
  const lastKline = klineData[klineData.length - 1];
  const startDate = new Date(parseInt(firstKline.openTime));
  const endDate = new Date(parseInt(lastKline.openTime));

  console.log(`\n📅 可用时间范围:`);
  console.log(`   从: ${startDate.toISOString()}`);
  console.log(`   到: ${endDate.toISOString()}`);

  // 输入入场时间
  console.log('\n🕐 入场时间 (格式: YYYY-MM-DDTHH:MM:SS.000Z)');
  console.log(`   示例: ${startDate.toISOString()}`);
  const entryTime = readline.question('   入场时间: ');

  // 验证时间格式
  const entryTimestamp = new Date(entryTime).getTime();
  if (isNaN(entryTimestamp)) {
    console.error('❌ 无效的时间格式');
    process.exit(1);
  }

  // 输入交易方向
  console.log('\n📊 交易方向:');
  console.log('   1. 做多 (long)');
  console.log('   2. 做空 (short)');
  const directionChoice = readline.questionInt('   选择方向 (1 或 2): ');
  const direction = directionChoice === 1 ? 'long' : 'short';

  // 输入入场价格（可选）
  console.log('\n💵 入场价格 (直接回车使用实际收盘价):');
  const entryPriceInput = readline.question('   入场价格: ');
  const entryPrice = entryPriceInput ? parseFloat(entryPriceInput) : null;

  // 输入持仓时间
  console.log('\n⏱️  持仓时间:');
  const holdMinutes = readline.questionInt('   持仓时间 (分钟): ');

  // 输入止损（可选）
  console.log('\n⛔ 止损价格 (直接回车跳过):');
  if (direction === 'long') {
    console.log('   提示: 做多时，止损应设置在入场价格下方');
  } else {
    console.log('   提示: 做空时，止损应设置在入场价格上方');
  }
  const stopLossInput = readline.question('   止损价格: ');
  const stopLoss = stopLossInput ? parseFloat(stopLossInput) : null;

  // 输入止盈（可选）
  console.log('\n🎯 止盈价格 (直接回车跳过):');
  if (direction === 'long') {
    console.log('   提示: 做多时，止盈应设置在入场价格上方');
  } else {
    console.log('   提示: 做空时，止盈应设置在入场价格下方');
  }
  const takeProfitInput = readline.question('   止盈价格: ');
  const takeProfit = takeProfitInput ? parseFloat(takeProfitInput) : null;

  // 输入仓位大小
  console.log('\n📦 仓位大小:');
  const lotSize = readline.questionFloat('   仓位大小 (手数, 默认 1): ', {
    defaultInput: '1'
  });

  return {
    entryTime,
    direction,
    entryPrice,
    holdMinutes,
    stopLoss,
    takeProfit,
    lotSize
  };
}

/**
 * 显示交易参数确认
 */
function confirmTrade(trade) {
  console.log('\n');
  console.log('═'.repeat(70));
  console.log('📋 交易参数确认:');
  console.log('═'.repeat(70));
  console.log(`入场时间: ${trade.entryTime}`);
  console.log(`交易方向: ${trade.direction === 'long' ? '做多 📈' : '做空 📉'}`);
  console.log(`入场价格: ${trade.entryPrice || '使用实际收盘价'}`);
  console.log(`持仓时间: ${trade.holdMinutes} 分钟`);
  console.log(`止损价格: ${trade.stopLoss || '未设置'}`);
  console.log(`止盈价格: ${trade.takeProfit || '未设置'}`);
  console.log(`仓位大小: ${trade.lotSize} 手`);
  console.log('═'.repeat(70));

  const confirm = readline.keyInYNStrict('\n确认执行模拟? ');
  return confirm;
}

/**
 * 保存交易历史
 */
function saveTradeHistory(result) {
  const historyDir = path.join(__dirname, 'data');
  const historyFile = path.join(historyDir, 'trade_history.json');

  let history = [];
  if (fs.existsSync(historyFile)) {
    history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  }

  history.push({
    timestamp: new Date().toISOString(),
    result
  });

  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf8');
  console.log(`\n💾 交易记录已保存到: ${historyFile}`);
}

/**
 * 快速交易模式
 */
function quickTradeMode(klineData) {
  console.log('\n⚡ 快速交易模式');
  console.log('使用最新数据的倒数第120分钟作为入场点\n');

  const simulator = new TradingSimulator(klineData);

  // 使用倒数第120分钟的数据
  const entryIndex = Math.max(0, klineData.length - 120);
  const entryKline = klineData[entryIndex];
  const entryTime = parseInt(entryKline.openTime);
  const currentPrice = parseFloat(entryKline.close);

  console.log(`当前价格: ${currentPrice}`);
  console.log(`入场时间: ${new Date(entryTime).toISOString()}\n`);

  // 输入交易方向
  console.log('交易方向:');
  console.log('  1. 做多 (long)');
  console.log('  2. 做空 (short)');
  const directionChoice = readline.questionInt('选择方向: ');
  const direction = directionChoice === 1 ? 'long' : 'short';

  // 简单的止损止盈设置
  const stopLossPips = readline.questionInt('止损点数 (pips, 例如: 50): ');
  const takeProfitPips = readline.questionInt('止盈点数 (pips, 例如: 100): ');
  const holdMinutes = readline.questionInt('持仓时间 (分钟, 例如: 60): ');

  const stopLoss = direction === 'long'
    ? currentPrice - (stopLossPips / 100)
    : currentPrice + (stopLossPips / 100);

  const takeProfit = direction === 'long'
    ? currentPrice + (takeProfitPips / 100)
    : currentPrice - (takeProfitPips / 100);

  const trade = {
    entryTime,
    direction,
    entryPrice: currentPrice,
    holdMinutes,
    stopLoss,
    takeProfit,
    lotSize: 1
  };

  const result = simulator.simulateTrade(trade);
  printTradeResult(result);

  if (result.success) {
    const save = readline.keyInYNStrict('\n保存此交易记录? ');
    if (save) {
      saveTradeHistory(result);
    }
  }
}

/**
 * 主菜单
 */
function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              USD/JPY 交易模拟器 - 交互式命令行工具                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('\n');

  // 加载数据
  const klineData = loadKlineData();
  const simulator = new TradingSimulator(klineData);

  while (true) {
    console.log('\n');
    console.log('═'.repeat(70));
    console.log('主菜单:');
    console.log('═'.repeat(70));
    console.log('  1. 📝 手动输入交易参数');
    console.log('  2. ⚡ 快速交易模式');
    console.log('  3. 📊 查看使用示例');
    console.log('  4. 🚪 退出');
    console.log('═'.repeat(70));

    const choice = readline.questionInt('\n请选择 (1-4): ');

    if (choice === 1) {
      // 手动输入模式
      const trade = inputTradeParameters(klineData);

      if (confirmTrade(trade)) {
        console.log('\n⏳ 正在执行交易模拟...\n');
        const result = simulator.simulateTrade(trade);
        printTradeResult(result);

        if (result.success) {
          const save = readline.keyInYNStrict('\n保存此交易记录? ');
          if (save) {
            saveTradeHistory(result);
          }
        }
      } else {
        console.log('❌ 已取消');
      }
    } else if (choice === 2) {
      // 快速交易模式
      quickTradeMode(klineData);
    } else if (choice === 3) {
      // 显示使用示例
      console.log('\n请运行以下命令查看使用示例:');
      console.log('  node demo.js 1  - 简单的做多交易');
      console.log('  node demo.js 2  - 带止损止盈的做空交易');
      console.log('  node demo.js 3  - 触发止损的交易示例');
      console.log('  node demo.js 4  - 批量回测多个交易');
      console.log('  node demo.js all - 运行所有示例');
    } else if (choice === 4) {
      console.log('\n👋 再见！\n');
      break;
    } else {
      console.log('\n❌ 无效的选择，请重新输入\n');
    }

    const continueChoice = readline.keyInYNStrict('\n继续使用模拟器? ');
    if (!continueChoice) {
      console.log('\n👋 再见！\n');
      break;
    }
  }
}

// 运行主程序
main();
