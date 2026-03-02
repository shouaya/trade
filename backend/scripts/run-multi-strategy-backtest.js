/**
 * Multi-Strategy Backtest Script
 * 批量回测多个策略组合,找出最优策略
 */

const db = require('../config/database');
const StrategyExecutor = require('../services/strategy-executor');
const { generateStrategyCombinations, countByType } = require('../services/strategy-parameter-generator');
const fs = require('fs');
const path = require('path');

/**
 * 主函数
 */
async function main() {
  console.log('🚀 多策略批量回测系统');
  console.log('='.repeat(80));

  try {
    // 1. 加载K线数据
    console.log('\n📊 加载K线数据...');
    const startTime = new Date('2026-01-02T07:00:00Z').getTime();
    const endTime = new Date('2026-02-28T05:59:00Z').getTime();

    const [klines] = await db.query(`
      SELECT * FROM klines
      WHERE symbol = 'USDJPY'
        AND interval_type = '1min'
        AND open_time >= ? AND open_time <= ?
      ORDER BY open_time ASC
    `, [startTime, endTime]);

    console.log(`✅ 加载了 ${klines.length} 条K线数据`);
    console.log(`   时间范围: ${new Date(parseInt(klines[0].open_time)).toISOString()} ~ ${new Date(parseInt(klines[klines.length - 1].open_time)).toISOString()}`);

    if (klines.length === 0) {
      console.error('❌ 没有找到K线数据,请先导入数据');
      process.exit(1);
    }

    // 2. 生成策略组合
    console.log('\n🔧 生成策略组合...');

    // 从命令行参数获取配置
    const args = process.argv.slice(2);
    const limit = args[0] ? parseInt(args[0]) : null;
    const types = args[1] ? args[1].split(',') : null;

    const strategies = generateStrategyCombinations({ limit, types });

    const typeCounts = countByType(strategies);
    console.log('   策略类型分布:');
    Object.entries(typeCounts).forEach(([type, count]) => {
      console.log(`     - ${type}: ${count} 个`);
    });

    console.log(`\n📝 将测试 ${strategies.length} 个策略`);

    // 3. 批量回测
    console.log('\n⚙️  开始批量回测...\n');
    console.log(`   预计耗时: ${(strategies.length * 0.5 / 60).toFixed(1)} 分钟 (假设每策略0.5秒)`);
    console.log('');

    const results = [];
    const startBacktestTime = Date.now();
    let lastProgressTime = Date.now();
    const progressInterval = 5000; // 每5秒显示一次进度

    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];

      try {
        const executor = new StrategyExecutor(strategy, klines);
        const result = await executor.execute();

        results.push({
          strategy,
          stats: result.stats,
          trades: result.trades
        });

        // 每5秒或每10个策略显示一次进度
        const now = Date.now();
        if (now - lastProgressTime > progressInterval || (i + 1) % 10 === 0 || i === strategies.length - 1) {
          const elapsed = (now - startBacktestTime) / 1000;
          const avgTimePerStrategy = elapsed / (i + 1);
          const remaining = avgTimePerStrategy * (strategies.length - i - 1);
          const progress = ((i + 1) / strategies.length * 100).toFixed(1);

          console.log(`\r📊 进度: ${i + 1}/${strategies.length} (${progress}%) | ` +
                     `已用时: ${(elapsed / 60).toFixed(1)}分 | ` +
                     `剩余: ${(remaining / 60).toFixed(1)}分 | ` +
                     `速度: ${avgTimePerStrategy.toFixed(2)}秒/策略`);

          lastProgressTime = now;
        }

      } catch (error) {
        console.error(`\n   ❌ 策略 #${i + 1} 执行失败: ${error.message}`);
      }
    }

    const totalBacktestTime = ((Date.now() - startBacktestTime) / 1000).toFixed(2);
    console.log(`\n\n✅ 批量回测完成,总耗时 ${(totalBacktestTime / 60).toFixed(2)} 分钟`);

    // 4. 性能排序
    console.log('\n📊 分析结果...');

    // 过滤掉没有交易的策略
    const validResults = results.filter(r => r.stats.totalTrades > 0);
    console.log(`   有效策略: ${validResults.length}/${results.length}`);

    if (validResults.length === 0) {
      console.error('❌ 没有策略产生交易,请检查策略参数或数据');
      process.exit(1);
    }

    // 按综合评分排序
    validResults.sort((a, b) => {
      // 综合评分 = 总盈亏 * 胜率 * 夏普比率 / (最大回撤 + 1)
      const scoreA = (a.stats.totalPnl || 0) * (a.stats.winRate || 0) * Math.max(a.stats.sharpeRatio || 0, 0.1) / (a.stats.maxDrawdown + 1);
      const scoreB = (b.stats.totalPnl || 0) * (b.stats.winRate || 0) * Math.max(b.stats.sharpeRatio || 0, 0.1) / (b.stats.maxDrawdown + 1);
      return scoreB - scoreA;
    });

    // 5. 输出Top 10
    console.log('\n🏆 Top 10 最佳策略:\n');
    console.log('='.repeat(80));

    const top10 = validResults.slice(0, 10);

    top10.forEach((result, index) => {
      const { strategy, stats } = result;
      const score = (stats.totalPnl * stats.winRate * Math.max(stats.sharpeRatio, 0.1)) / (stats.maxDrawdown + 1);

      console.log(`\n${index + 1}. ${strategy.name}`);
      console.log(`   类型: ${strategy.type}`);
      console.log(`   交易次数: ${stats.totalTrades}`);
      console.log(`   胜率: ${(stats.winRate * 100).toFixed(2)}% (${stats.winningTrades}胜 / ${stats.losingTrades}负)`);
      console.log(`   总盈亏: $${stats.totalPnl.toFixed(2)}`);
      console.log(`   平均盈亏: $${stats.avgPnl.toFixed(2)}`);
      console.log(`   夏普比率: ${stats.sharpeRatio.toFixed(3)}`);
      console.log(`   盈利因子: ${stats.profitFactor.toFixed(2)}`);
      console.log(`   最大回撤: ${(stats.maxDrawdown * 100).toFixed(2)}%`);
      console.log(`   综合评分: ${score.toFixed(2)}`);
    });

    console.log('\n' + '='.repeat(80));

    // 6. 保存完整结果到JSON
    const resultsDir = path.join(__dirname, '../backtest-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsFile = path.join(resultsDir, `backtest-${timestamp}.json`);

    fs.writeFileSync(resultsFile, JSON.stringify({
      meta: {
        timestamp: new Date().toISOString(),
        totalStrategies: strategies.length,
        validStrategies: validResults.length,
        klineCount: klines.length,
        timeRange: {
          start: new Date(parseInt(klines[0].open_time)).toISOString(),
          end: new Date(parseInt(klines[klines.length - 1].open_time)).toISOString()
        },
        executionTime: totalBacktestTime
      },
      results: validResults.map(r => ({
        strategy: r.strategy,
        stats: r.stats
      }))
    }, null, 2));

    console.log(`\n💾 完整结果已保存到: ${resultsFile}`);

    // 7. 保存Top 10到数据库
    console.log('\n💾 保存Top 10策略到数据库...\n');

    for (let i = 0; i < top10.length; i++) {
      const result = top10[i];
      const { strategy, stats, trades } = result;

      try {
        // 保存策略
        const [strategyResult] = await db.query(`
          INSERT INTO strategies (name, description, parameters, is_active)
          VALUES (?, ?, ?, ?)
        `, [
          strategy.name,
          `Rank #${i + 1} | ${strategy.type} | 胜率:${(stats.winRate * 100).toFixed(2)}% | 盈亏:$${stats.totalPnl.toFixed(2)} | 夏普:${stats.sharpeRatio.toFixed(2)}`,
          JSON.stringify(strategy.parameters),
          false  // 默认不激活
        ]);

        const strategyId = strategyResult.insertId;

        // 保存交易记录
        if (trades.length > 0) {
          const tradeValues = trades.map(t => [
            t.direction,
            t.entry_time,
            t.entry_price,
            t.entry_index,
            t.entry_rsi,
            t.entry_macd,
            t.entry_macd_signal,
            t.entry_macd_histogram,
            t.lot_size,
            t.hold_minutes || 0,  // 添加 hold_minutes
            t.stop_loss,
            t.take_profit,
            t.exit_time,
            t.exit_price,
            t.exit_rsi,
            t.exit_macd,
            t.exit_macd_signal,
            t.exit_macd_histogram,
            t.exit_reason,
            t.pnl,
            t.pips,
            t.percent,
            t.actual_hold_minutes,
            strategy.name,
            'USDJPY'
          ]);

          await db.query(`
            INSERT INTO trades (
              direction, entry_time, entry_price, entry_index,
              entry_rsi, entry_macd, entry_macd_signal, entry_macd_histogram,
              lot_size, hold_minutes, stop_loss, take_profit,
              exit_time, exit_price, exit_rsi, exit_macd,
              exit_macd_signal, exit_macd_histogram,
              exit_reason, pnl, pips, percent,
              actual_hold_minutes, strategy_name, symbol
            ) VALUES ?
          `, [tradeValues]);

          console.log(`   ✅ #${i + 1} ${strategy.name}: 保存 ${trades.length} 条交易记录`);
        } else {
          console.log(`   ⚠️  #${i + 1} ${strategy.name}: 无交易记录`);
        }

      } catch (error) {
        console.error(`   ❌ #${i + 1} ${strategy.name}: 保存失败 - ${error.message}`);
      }
    }

    console.log('\n✨ 回测完成!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ 执行失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行
main();
