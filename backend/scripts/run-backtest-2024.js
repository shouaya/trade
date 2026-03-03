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
    // 1. 创建临时表存储策略结果
    console.log('\n📊 准备数据库...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS backtest_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        strategy_name VARCHAR(200),
        strategy_type VARCHAR(50),
        total_trades INT,
        win_rate DECIMAL(5,4),
        total_pnl DECIMAL(12,2),
        avg_pnl DECIMAL(12,2),
        sharpe_ratio DECIMAL(8,3),
        profit_factor DECIMAL(8,3),
        max_drawdown DECIMAL(8,4),
        score DECIMAL(12,4),
        parameters JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_score (score DESC),
        INDEX idx_created (created_at)
      )
    `);

    // 清空旧数据
    await db.query('DELETE FROM backtest_results WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)');

    // 2. 加载K线数据 (2024年)
    console.log('\n📊 加载K线数据...');
    const startTime = new Date('2024-01-01T22:00:00Z').getTime();
    const endTime = new Date('2024-12-31T20:59:00Z').getTime();

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

    const startBacktestTime = Date.now();
    let lastProgressTime = Date.now();
    const progressInterval = 5000; // 每5秒显示一次进度
    let validCount = 0;

    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];

      try {
        const executor = new StrategyExecutor(strategy, klines);
        const result = await executor.execute();
        const stats = result.stats;

        // 只保存有交易的策略到数据库
        if (stats.totalTrades > 0) {
          const score = (stats.totalPnl * stats.winRate * Math.max(stats.sharpeRatio, 0.1)) / (stats.maxDrawdown + 1);

          await db.query(`
            INSERT INTO backtest_results
            (strategy_name, strategy_type, total_trades, win_rate, total_pnl, avg_pnl,
             sharpe_ratio, profit_factor, max_drawdown, score, parameters)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            strategy.name,
            strategy.type,
            stats.totalTrades,
            stats.winRate,
            stats.totalPnl,
            stats.avgPnl,
            stats.sharpeRatio,
            stats.profitFactor,
            stats.maxDrawdown,
            score,
            JSON.stringify(strategy.parameters)
          ]);

          validCount++;
        }

        // 每100个策略让出事件循环控制权,防止卡住
        if ((i + 1) % 100 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }

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

    // 4. 从数据库获取Top 10 (去重)
    console.log('\n📊 分析结果...');
    console.log(`   有效策略: ${validCount}/${strategies.length}`);

    if (validCount === 0) {
      console.error('❌ 没有策略产生交易,请检查策略参数或数据');
      process.exit(1);
    }

    // 使用 GROUP BY 去重,每个策略名只保留评分最高的一条记录
    const [top10Results] = await db.query(`
      SELECT
        strategy_name,
        strategy_type,
        MAX(total_trades) as total_trades,
        MAX(win_rate) as win_rate,
        MAX(total_pnl) as total_pnl,
        MAX(avg_pnl) as avg_pnl,
        MAX(sharpe_ratio) as sharpe_ratio,
        MAX(profit_factor) as profit_factor,
        MAX(max_drawdown) as max_drawdown,
        MAX(score) as score,
        (SELECT parameters FROM backtest_results br2
         WHERE br2.strategy_name = br1.strategy_name
         LIMIT 1) as parameters
      FROM backtest_results br1
      GROUP BY strategy_name, strategy_type
      ORDER BY MAX(score) DESC
      LIMIT 10
    `);

    // 5. 输出Top 10
    console.log('\n🏆 Top 10 最佳策略:\n');
    console.log('='.repeat(80));

    top10Results.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.strategy_name}`);
      console.log(`   类型: ${result.strategy_type}`);
      console.log(`   交易次数: ${result.total_trades}`);
      console.log(`   胜率: ${(result.win_rate * 100).toFixed(2)}%`);
      console.log(`   总盈亏: $${parseFloat(result.total_pnl).toFixed(2)}`);
      console.log(`   平均盈亏: $${parseFloat(result.avg_pnl).toFixed(2)}`);
      console.log(`   夏普比率: ${parseFloat(result.sharpe_ratio).toFixed(3)}`);
      console.log(`   盈利因子: ${parseFloat(result.profit_factor).toFixed(2)}`);
      console.log(`   最大回撤: ${(parseFloat(result.max_drawdown) * 100).toFixed(2)}%`);
      console.log(`   综合评分: ${parseFloat(result.score).toFixed(2)}`);
    });

    console.log('\n' + '='.repeat(80));

    // 6. 保存Top 10到数据库(重新执行以获取交易记录)
    console.log('\n💾 保存Top 10策略到数据库...\n');

    for (let i = 0; i < top10Results.length; i++) {
      const result = top10Results[i];
      // MySQL JSON字段可能已经被自动解析为对象
      const parameters = typeof result.parameters === 'string'
        ? JSON.parse(result.parameters)
        : result.parameters;

      // 重建strategy对象
      const strategy = {
        name: result.strategy_name,
        type: result.strategy_type,
        parameters: parameters
      };

      try {
        // 重新执行策略以获取交易记录
        const executor = new StrategyExecutor(strategy, klines);
        const rerunResult = await executor.execute();
        const trades = rerunResult.trades;

        // 保存策略 (添加2024-前缀)
        const strategyName = `2024-${strategy.name}`;
        const [strategyResult] = await db.query(`
          INSERT INTO strategies (name, description, parameters, is_active)
          VALUES (?, ?, ?, ?)
        `, [
          strategyName,
          `2024训练 | Rank #${i + 1} | ${strategy.type} | 胜率:${(result.win_rate * 100).toFixed(2)}% | 盈亏:$${parseFloat(result.total_pnl).toFixed(2)} | 夏普:${parseFloat(result.sharpe_ratio).toFixed(2)}`,
          JSON.stringify(strategy.parameters),
          false  // 默认不激活
        ]);

        const strategyId = strategyResult.insertId;

        // 保存交易记录
        if (trades && trades.length > 0) {
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
            strategyName,  // 使用带前缀的策略名
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

          console.log(`   ✅ #${i + 1} ${strategyName}: 保存 ${trades.length} 条交易记录`);
        } else {
          console.log(`   ⚠️  #${i + 1} ${strategy.name}: 无交易记录`);
        }

      } catch (error) {
        console.error(`   ❌ #${i + 1} 2024-${strategy.name}: 保存失败 - ${error.message}`);
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
