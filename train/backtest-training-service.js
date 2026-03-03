const db = require('./configs/database');
const StrategyExecutor = require('./services/strategy-executor');
const {
  generateStrategyCombinations,
  countByType
} = require('./services/strategy-parameter-generator');

const DEFAULT_PROGRESS_INTERVAL_MS = 5000;
const TRADE_BATCH_SIZE = 1000;

function assertSafeIdentifier(identifier, fieldName) {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`${fieldName} contains invalid characters: ${identifier}`);
  }
}

function assertPositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}

function assertValidTimestampRange(startTimeMs, endTimeMs) {
  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) {
    throw new Error('startTimeMs/endTimeMs must be valid numbers');
  }
  if (startTimeMs >= endTimeMs) {
    throw new Error('startTimeMs must be less than endTimeMs');
  }
}

async function ensureBacktestTable(tableName) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
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
}

async function cleanupOldBacktestRows(tableName, retainDays) {
  await db.query(
    `DELETE FROM ${tableName} WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [retainDays]
  );
}

async function loadKlines({ symbol, intervalType, startTimeMs, endTimeMs }) {
  const [klines] = await db.query(
    `
      SELECT * FROM klines
      WHERE symbol = ?
        AND interval_type = ?
        AND open_time >= ? AND open_time <= ?
      ORDER BY open_time ASC
    `,
    [symbol, intervalType, startTimeMs, endTimeMs]
  );
  return klines;
}

async function runBacktestAndStoreResults({ strategies, klines, tableName }) {
  const startBacktestTime = Date.now();
  let lastProgressTime = Date.now();
  const progressInterval = DEFAULT_PROGRESS_INTERVAL_MS;
  let validCount = 0;

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];

    try {
      const executor = new StrategyExecutor(strategy, klines);
      const result = await executor.execute();
      const stats = result.stats;

      if (stats.totalTrades > 0) {
        const score = (stats.totalPnl * stats.winRate * Math.max(stats.sharpeRatio, 0.1)) / (stats.maxDrawdown + 1);

        await db.query(
          `
            INSERT INTO ${tableName}
            (strategy_name, strategy_type, total_trades, win_rate, total_pnl, avg_pnl,
             sharpe_ratio, profit_factor, max_drawdown, score, parameters)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
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
          ]
        );

        validCount++;
      }

      if ((i + 1) % 100 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }

      const now = Date.now();
      if (now - lastProgressTime > progressInterval || (i + 1) % 10 === 0 || i === strategies.length - 1) {
        const elapsed = (now - startBacktestTime) / 1000;
        const avgTimePerStrategy = elapsed / (i + 1);
        const remaining = avgTimePerStrategy * (strategies.length - i - 1);
        const progress = ((i + 1) / strategies.length * 100).toFixed(1);

        console.log(
          `\r📊 进度: ${i + 1}/${strategies.length} (${progress}%) | ` +
          `已用时: ${(elapsed / 60).toFixed(1)}分 | ` +
          `剩余: ${(remaining / 60).toFixed(1)}分 | ` +
          `速度: ${avgTimePerStrategy.toFixed(2)}秒/策略`
        );
        lastProgressTime = now;
      }
    } catch (error) {
      console.error(`\n   ❌ 策略 #${i + 1} 执行失败: ${error.message}`);
    }
  }

  const totalBacktestTimeSeconds = (Date.now() - startBacktestTime) / 1000;
  return {
    validCount,
    totalBacktestTimeSeconds
  };
}

async function queryTopStrategies({ tableName, topN }) {
  const [rows] = await db.query(`
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
      (SELECT parameters FROM ${tableName} br2
       WHERE br2.strategy_name = br1.strategy_name
       LIMIT 1) as parameters
    FROM ${tableName} br1
    GROUP BY strategy_name, strategy_type
    ORDER BY MAX(score) DESC
    LIMIT ?
  `, [topN]);

  return rows;
}

async function insertTradesInBatches(tradeValues) {
  for (let i = 0; i < tradeValues.length; i += TRADE_BATCH_SIZE) {
    const batch = tradeValues.slice(i, i + TRADE_BATCH_SIZE);
    await db.query(
      `
        INSERT INTO trades (
          direction, entry_time, entry_price, entry_index,
          entry_rsi, entry_macd, entry_macd_signal, entry_macd_histogram,
          lot_size, hold_minutes, stop_loss, take_profit,
          exit_time, exit_price, exit_rsi, exit_macd,
          exit_macd_signal, exit_macd_histogram,
          exit_reason, pnl, pips, percent,
          actual_hold_minutes, strategy_name, symbol
        ) VALUES ?
      `,
      [batch]
    );
  }
}

async function saveTopStrategiesAndTrades({
  topResults,
  klines,
  symbol,
  strategyNamePrefix = '',
  descriptionPrefix = ''
}) {
  for (let i = 0; i < topResults.length; i++) {
    const result = topResults[i];
    const parameters = typeof result.parameters === 'string'
      ? JSON.parse(result.parameters)
      : result.parameters;

    const strategy = {
      name: result.strategy_name,
      type: result.strategy_type,
      parameters
    };

    const persistedStrategyName = strategyNamePrefix
      ? `${strategyNamePrefix}${strategy.name}`
      : strategy.name;

    try {
      const executor = new StrategyExecutor(strategy, klines);
      const rerunResult = await executor.execute();
      const trades = rerunResult.trades;

      const connection = await db.getConnection();

      try {
        await connection.beginTransaction();
        await connection.query(
          `
            INSERT INTO strategies (name, description, parameters, is_active)
            VALUES (?, ?, ?, ?)
          `,
          [
            persistedStrategyName,
            `${descriptionPrefix}Rank #${i + 1} | ${strategy.type} | 胜率:${(result.win_rate * 100).toFixed(2)}% | 盈亏:$${parseFloat(result.total_pnl).toFixed(2)} | 夏普:${parseFloat(result.sharpe_ratio).toFixed(2)}`,
            JSON.stringify(strategy.parameters),
            false
          ]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

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
          persistedStrategyName,
          symbol
        ]);
        await insertTradesInBatches(tradeValues);

        console.log(`   ✅ #${i + 1} ${persistedStrategyName}: 保存 ${trades.length} 条交易记录`);
      } else {
        console.log(`   ⚠️  #${i + 1} ${persistedStrategyName}: 无交易记录`);
      }
    } catch (error) {
      console.error(`   ❌ #${i + 1} ${persistedStrategyName}: 保存失败 - ${error.message}`);
    }
  }
}

async function runTrainingBacktest({
  startTimeMs,
  endTimeMs,
  symbol = 'USDJPY',
  intervalType = '1min',
  tableName = 'backtest_results',
  topN = 10,
  retainDays = 1,
  strategyNamePrefix = '',
  descriptionPrefix = '',
  limit = null,
  types = null
}) {
  assertValidTimestampRange(startTimeMs, endTimeMs);
  assertSafeIdentifier(tableName, 'tableName');
  assertPositiveInteger(topN, 'topN');
  assertNonNegativeInteger(retainDays, 'retainDays');

  console.log('🚀 多策略批量回测系统');
  console.log('='.repeat(80));
  console.log('\n📊 准备数据库...');

  await ensureBacktestTable(tableName);
  await cleanupOldBacktestRows(tableName, retainDays);

  console.log('\n📊 加载K线数据...');
  const klines = await loadKlines({ symbol, intervalType, startTimeMs, endTimeMs });

  if (klines.length === 0) {
    throw new Error('没有找到K线数据,请先导入数据');
  }

  console.log(`✅ 加载了 ${klines.length} 条K线数据`);
  console.log(`   时间范围: ${new Date(parseInt(klines[0].open_time)).toISOString()} ~ ${new Date(parseInt(klines[klines.length - 1].open_time)).toISOString()}`);

  console.log('\n🔧 生成策略组合...');
  const strategies = generateStrategyCombinations({ limit, types });
  const typeCounts = countByType(strategies);
  console.log('   策略类型分布:');
  Object.entries(typeCounts).forEach(([type, count]) => {
    console.log(`     - ${type}: ${count} 个`);
  });
  console.log(`\n📝 将测试 ${strategies.length} 个策略`);

  console.log('\n⚙️  开始批量回测...\n');
  console.log(`   预计耗时: ${(strategies.length * 0.5 / 60).toFixed(1)} 分钟 (假设每策略0.5秒)`);
  console.log('');

  const { validCount, totalBacktestTimeSeconds } = await runBacktestAndStoreResults({
    strategies,
    klines,
    tableName
  });

  console.log(`\n\n✅ 批量回测完成,总耗时 ${(totalBacktestTimeSeconds / 60).toFixed(2)} 分钟`);
  console.log('\n📊 分析结果...');
  console.log(`   有效策略: ${validCount}/${strategies.length}`);

  if (validCount === 0) {
    throw new Error('没有策略产生交易,请检查策略参数或数据');
  }

  const topResults = await queryTopStrategies({ tableName, topN });

  console.log(`\n🏆 Top ${topN} 最佳策略:\n`);
  console.log('='.repeat(80));
  topResults.forEach((result, index) => {
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

  console.log(`\n💾 保存Top ${topN}策略到数据库...\n`);
  await saveTopStrategiesAndTrades({
    topResults,
    klines,
    symbol,
    strategyNamePrefix,
    descriptionPrefix
  });

  console.log('\n✨ 回测完成!\n');
}

module.exports = {
  runTrainingBacktest
};

