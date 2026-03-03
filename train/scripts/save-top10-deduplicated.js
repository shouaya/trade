/**
 * Save Top 10 Deduplicated Strategies
 * 从现有的 backtest_results 表中提取去重后的 Top 10 策略并保存
 */

const db = require('../configs/database');
const StrategyExecutor = require('../services/strategy-executor');
const { loadNamedConfig } = require('./_config');

async function main() {
  console.log('🚀 保存去重后的 Top 10 策略');
  console.log('='.repeat(80));

  try {
    const period = loadNamedConfig('periods', 'default');

    // 1. 加载K线数据
    console.log('\n📊 加载K线数据...');
    const startTime = new Date(period.startIso).getTime();
    const endTime = new Date(period.endIso).getTime();

    const [klines] = await db.query(`
      SELECT * FROM klines
      WHERE symbol = ?
        AND interval_type = ?
        AND open_time >= ? AND open_time <= ?
      ORDER BY open_time ASC
    `, [period.symbol || 'USDJPY', period.intervalType || '1min', startTime, endTime]);

    console.log(`✅ 加载了 ${klines.length} 条K线数据`);

    // 2. 获取去重后的 Top 10 策略
    console.log('\n📊 查询去重后的 Top 10 策略...');

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

    console.log(`✅ 找到 ${top10Results.length} 个唯一策略\n`);

    // 3. 显示 Top 10
    console.log('🏆 Top 10 最佳策略 (去重后):\n');
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

    // 4. 保存到数据库
    console.log('\n💾 保存 Top 10 策略到数据库...\n');

    for (let i = 0; i < top10Results.length; i++) {
      const result = top10Results[i];
      const parameters = typeof result.parameters === 'string'
        ? JSON.parse(result.parameters)
        : result.parameters;

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

        // 保存策略
        const [strategyResult] = await db.query(`
          INSERT INTO strategies (name, description, parameters, is_active)
          VALUES (?, ?, ?, ?)
        `, [
          strategy.name,
          `Rank #${i + 1} | ${strategy.type} | 胜率:${(result.win_rate * 100).toFixed(2)}% | 盈亏:$${parseFloat(result.total_pnl).toFixed(2)} | 夏普:${parseFloat(result.sharpe_ratio).toFixed(2)}`,
          JSON.stringify(strategy.parameters),
          i === 0  // 只激活第1名策略
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
            t.hold_minutes || 0,
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
            period.symbol || 'USDJPY'
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

          console.log(`   ✅ #${i + 1} ${strategy.name}: 保存 ${trades.length} 条交易记录 ${i === 0 ? '(已激活)' : ''}`);
        } else {
          console.log(`   ⚠️  #${i + 1} ${strategy.name}: 无交易记录`);
        }

      } catch (error) {
        console.error(`   ❌ #${i + 1} ${strategy.name}: 保存失败 - ${error.message}`);
      }
    }

    console.log('\n✨ Top 10 去重策略保存完成!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ 执行失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行
main();


