/**
 * 在2024年数据上验证2025年Top 3策略
 */

const db = require('../config/database');
const StrategyExecutor = require('../services/strategy-executor');

const SYMBOL = 'USDJPY';
const INTERVAL = '1min';
const YEAR = '2024';

// 2024年可用数据范围 (全年,含60天预热期)
const WARMUP_DAYS = 60;
const YEAR_START = '2024-01-01T00:00:00Z';
const YEAR_END = '2024-12-31T23:59:59Z';  // 只有全年数据

// Top 3策略定义 (来自2025年回测结果)
const TOP_3_STRATEGIES = [
  {
    name: 'RSI-P14-OS25-OB70-MP1-H60-SLnull-TPnull',
    type: 'rsi_only',
    description: '综合第一名 - 无止损止盈版本',
    parameters: {
      grid: { enabled: false },
      rsi: { enabled: true, period: 14, oversold: 25, overbought: 70 },
      macd: { enabled: false },
      risk: {
        maxPositions: 1,
        lotSize: 0.1,
        stopLossPercent: null,
        takeProfitPercent: null,
        maxHoldMinutes: 60
      }
    }
  },
  {
    name: 'RSI-P14-OS25-OB70-MP1-H60-SL0.3-TP1.5',
    type: 'rsi_only',
    description: '带止损止盈版本 (1:5风险回报)',
    parameters: {
      grid: { enabled: false },
      rsi: { enabled: true, period: 14, oversold: 25, overbought: 70 },
      macd: { enabled: false },
      risk: {
        maxPositions: 1,
        lotSize: 0.1,
        stopLossPercent: 0.3,
        takeProfitPercent: 1.5,
        maxHoldMinutes: 60
      }
    }
  },
  {
    name: 'RSI-P14-OS30-OB70-MP1-H30-SL0.3-TP0.2',
    type: 'rsi_only',
    description: '高频交易版本 - 30分钟持仓',
    parameters: {
      grid: { enabled: false },
      rsi: { enabled: true, period: 14, oversold: 30, overbought: 70 },
      macd: { enabled: false },
      risk: {
        maxPositions: 1,
        lotSize: 0.1,
        stopLossPercent: 0.3,
        takeProfitPercent: 0.2,
        maxHoldMinutes: 30
      }
    }
  }
];

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 2024年策略验证 (全年数据)');
  console.log('   验证2025年Top 3策略在2024年全年的表现');
  console.log('='.repeat(80) + '\n');

  const overallStartTime = Date.now();

  try {
    // 1. 加载2024年完整K线数据 (含60天预热期)
    console.log('📊 加载2024年全年K线数据 (含60天预热期)...\n');

    const yearStartTime = new Date(YEAR_START).getTime();
    const yearEndTime = new Date(YEAR_END).getTime();
    const warmupStartTime = yearStartTime - (WARMUP_DAYS * 24 * 60 * 60 * 1000);

    const [klines] = await db.query(`
      SELECT * FROM klines
      WHERE symbol = ? AND interval_type = ?
        AND open_time >= ? AND open_time <= ?
      ORDER BY open_time ASC
    `, [SYMBOL, INTERVAL, warmupStartTime, yearEndTime]);

    console.log('✅ 加载了', klines.length, '条K线数据');
    console.log('   时间范围:', new Date(warmupStartTime).toISOString(), '~', new Date(yearEndTime).toISOString());
    console.log('');

    // 2. 逐个测试Top 3策略
    const results = [];

    for (let i = 0; i < TOP_3_STRATEGIES.length; i++) {
      const strategy = TOP_3_STRATEGIES[i];

      console.log('='.repeat(80));
      console.log('\n策略', i + 1 + ':', strategy.name);
      console.log('描述:', strategy.description, '\n');
      console.log('='.repeat(80));

      const startTime = Date.now();

      const executor = new StrategyExecutor({
        name: strategy.name,
        type: strategy.type,
        parameters: strategy.parameters
      }, klines);

      const result = await executor.execute();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      // 计算统计指标
      const stats = result.stats;

      console.log('\n⏱️  执行耗时:', elapsed, '秒');
      console.log('\n📈 2024年全年回测结果:\n');
      console.log('   交易次数:', stats.totalTrades);
      console.log('   胜率:', (stats.winRate * 100).toFixed(2) + '%');
      console.log('   总盈亏: $' + (stats.totalPnl || 0).toFixed(2));
      console.log('   平均盈亏: $' + (stats.avgPnl || 0).toFixed(2));
      console.log('   夏普比率:', (stats.sharpeRatio || 0).toFixed(3));
      console.log('   盈利因子:', (stats.profitFactor || 0).toFixed(2));
      console.log('   最大回撤:', (stats.maxDrawdown * 100).toFixed(2) + '%');
      console.log('   综合评分:', (stats.score || 0).toFixed(2));
      console.log('');

      results.push({
        name: strategy.name,
        description: strategy.description,
        stats: stats,
        elapsed: elapsed
      });
    }

    // 3. 对比分析
    console.log('='.repeat(80));
    console.log('\n📊 2025年 vs 2024年 对比分析\n');
    console.log('='.repeat(80));
    console.log('');

    // 2025年数据 (从之前的回测结果)
    const results2025 = [
      { name: 'RSI-P14-OS25-OB70-MP1-H60-SLnull-TPnull', trades: 3596, winRate: 51.42, pnl: 37.55, score: 18.71 },
      { name: 'RSI-P14-OS25-OB70-MP1-H60-SL0.3-TP1.5', trades: 3656, winRate: 51.23, pnl: 37.69, score: 18.67 },
      { name: 'RSI-P14-OS30-OB70-MP1-H30-SL0.3-TP0.2', trades: 6318, winRate: 50.06, pnl: 35.71, score: 18.43 }
    ];

    for (let i = 0; i < results.length; i++) {
      const result2025 = results2025[i];
      const result2024 = results[i];

      console.log('策略', i + 1 + ':', result2024.name, '\n');

      console.log('  指标对比:');
      const tradeChange = result2025.trades > 0 ? ((result2024.stats.totalTrades - result2025.trades) / result2025.trades * 100).toFixed(1) : 'N/A';
      const winRateChange = (result2024.stats.winRate * 100 - result2025.winRate).toFixed(2);
      const pnlChange = result2025.pnl !== 0 ? ((result2024.stats.totalPnl - result2025.pnl) / result2025.pnl * 100).toFixed(1) : 'N/A';
      const scoreChange = result2025.score !== 0 ? (((result2024.stats.score || 0) - result2025.score) / result2025.score * 100).toFixed(1) : 'N/A';

      console.log('    交易次数:', result2025.trades, '(2025) →', result2024.stats.totalTrades, '(2024) [' + (result2024.stats.totalTrades > result2025.trades ? '↑' : '↓'), tradeChange + '%]');
      console.log('    胜率:', result2025.winRate.toFixed(2) + '% (2025) →', (result2024.stats.winRate * 100).toFixed(2) + '% (2024) [' + (result2024.stats.winRate * 100 > result2025.winRate ? '↑' : '↓'), winRateChange + '%]');
      console.log('    总盈亏: $' + result2025.pnl, '(2025) → $' + result2024.stats.totalPnl.toFixed(2), '(2024) [' + (result2024.stats.totalPnl > result2025.pnl ? '↑' : '↓'), pnlChange + '%]');
      console.log('    综合评分:', result2025.score, '(2025) →', (result2024.stats.score || 0).toFixed(2), '(2024) [' + ((result2024.stats.score || 0) > result2025.score ? '↑' : '↓'), scoreChange + '%]');
      console.log('');

      // 一致性评估
      const isConsistent =
        result2024.stats.totalPnl > 0 &&
        result2024.stats.winRate > 0.48 &&
        result2024.stats.profitFactor > 1.0;

      console.log('  一致性评估:', isConsistent ? '✅ 通过' : '❌ 未通过');
      console.log('');
    }

    // 4. 总结
    console.log('='.repeat(80));
    console.log('\n📝 验证总结\n');
    console.log('='.repeat(80));
    console.log('');

    const allProfitable = results.every(r => r.stats.totalPnl > 0);
    const allPositiveWinRate = results.every(r => r.stats.winRate > 0.48);
    const allPositiveProfitFactor = results.every(r => r.stats.profitFactor > 1.0);

    console.log('  所有策略盈利:', allProfitable ? '✅ 是' : '❌ 否');
    console.log('  所有策略胜率>48%:', allPositiveWinRate ? '✅ 是' : '❌ 否');
    console.log('  所有策略盈利因子>1.0:', allPositiveProfitFactor ? '✅ 是' : '❌ 否');
    console.log('');

    if (allProfitable && allPositiveWinRate && allPositiveProfitFactor) {
      console.log('  🎉 结论: Top 3策略在2024年表现一致,可以考虑实盘测试!');
    } else {
      console.log('  ⚠️  结论: 部分策略在2024年表现不佳,需要进一步分析或优化。');
    }
    console.log('');

    const overallElapsed = ((Date.now() - overallStartTime) / 1000 / 60).toFixed(2);
    console.log('='.repeat(80));
    console.log('✨ 验证完成! 总耗时:', overallElapsed, '分钟');
    console.log('='.repeat(80));
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 验证失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
