const db = require('./configs/database');
const StrategyExecutor = require('./services/strategy-executor');

function inferStrategyType(parameters = {}) {
  const rsiEnabled = Boolean(parameters.rsi && parameters.rsi.enabled);
  const macdEnabled = Boolean(parameters.macd && parameters.macd.enabled);

  if (rsiEnabled && macdEnabled) {
    return parameters.entryLogic === 'AND' ? 'rsi_and_macd' : 'rsi_or_macd';
  }
  if (rsiEnabled) return 'rsi_only';
  if (macdEnabled) return 'macd_only';
  return 'grid_only';
}

function parseParameters(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') return JSON.parse(raw);
  return raw;
}

function assertSafeIdentifier(identifier, fieldName) {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`${fieldName} contains invalid characters: ${identifier}`);
  }
}

function assertSafeOrderBy(orderBy) {
  if (!/^[A-Za-z0-9_]+(?:\s+(?:ASC|DESC))?$/i.test(orderBy.trim())) {
    throw new Error(`invalid strategyOrderBy: ${orderBy}`);
  }
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

async function loadStrategies({ strategyTable, strategyOrderBy = 'id ASC' }) {
  assertSafeIdentifier(strategyTable, 'strategyTable');
  assertSafeOrderBy(strategyOrderBy);

  const [strategies] = await db.query(
    `
    SELECT id, name, description, parameters
    FROM ${strategyTable}
    ORDER BY ${strategyOrderBy}
    `
  );
  return strategies;
}

async function runStrategyValidation({
  title,
  periodLabel,
  startTimeMs,
  endTimeMs,
  symbol = 'USDJPY',
  intervalType = '1min',
  strategyTable = 'strategies',
  strategyOrderBy = 'id ASC'
}) {
  console.log(`🚀 ${title}`);
  console.log('='.repeat(80));

  console.log(`\n📊 加载${periodLabel}K线数据...`);
  const klines = await loadKlines({ symbol, intervalType, startTimeMs, endTimeMs });

  if (klines.length === 0) {
    throw new Error(`没有找到${periodLabel}的K线数据`);
  }

  console.log(`✅ 加载了 ${klines.length.toLocaleString()} 条K线数据`);
  console.log(`   时间范围: ${new Date(parseInt(klines[0].open_time, 10)).toISOString()} ~ ${new Date(parseInt(klines[klines.length - 1].open_time, 10)).toISOString()}`);

  console.log('\n📊 加载策略...');
  const strategies = await loadStrategies({ strategyTable, strategyOrderBy });
  console.log(`✅ 找到 ${strategies.length} 个策略\n`);

  if (strategies.length === 0) {
    throw new Error('数据库中没有保存的策略');
  }

  console.log(`⚙️  开始在${periodLabel}数据上验证...\n`);
  console.log('='.repeat(80));

  const results = [];

  for (let i = 0; i < strategies.length; i++) {
    const strategyRow = strategies[i];
    const parameters = parseParameters(strategyRow.parameters);
    const strategy = {
      name: strategyRow.name,
      type: inferStrategyType(parameters),
      parameters
    };

    console.log(`\n${i + 1}. ${strategy.name}`);
    console.log(`   类型: ${strategy.type}`);

    try {
      const start = Date.now();
      const executor = new StrategyExecutor(strategy, klines);
      const result = await executor.execute();
      const stats = result.stats;
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);

      console.log(`   交易次数: ${stats.totalTrades}`);
      console.log(`   胜率: ${(stats.winRate * 100).toFixed(2)}%`);
      console.log(`   总盈亏: $${stats.totalPnl.toFixed(2)}`);
      console.log(`   平均盈亏: $${stats.avgPnl.toFixed(2)}`);
      console.log(`   夏普比率: ${stats.sharpeRatio.toFixed(3)}`);
      console.log(`   盈利因子: ${stats.profitFactor.toFixed(2)}`);
      console.log(`   最大回撤: ${(stats.maxDrawdown * 100).toFixed(2)}%`);
      console.log(`   耗时: ${elapsed}秒`);

      results.push({
        strategyId: strategyRow.id,
        strategyName: strategy.name,
        description: strategyRow.description,
        ...stats
      });
    } catch (error) {
      console.error(`   ❌ 验证失败: ${error.message}`);
      results.push({
        strategyId: strategyRow.id,
        strategyName: strategy.name,
        description: strategyRow.description,
        error: error.message
      });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 ${periodLabel}验证汇总报告\n`);
  console.log('='.repeat(80));

  results.sort((a, b) => (b.totalPnl || -Infinity) - (a.totalPnl || -Infinity));
  console.log('\n按总盈亏排序:\n');

  results.forEach((result, index) => {
    if (result.error) {
      console.log(`${index + 1}. ${result.strategyName} - ❌ ${result.error}`);
      return;
    }
    console.log(`${index + 1}. ${result.strategyName}`);
    console.log(`   训练期: ${result.description}`);
    console.log(`   交易次数: ${result.totalTrades}`);
    console.log(`   胜率: ${(result.winRate * 100).toFixed(2)}%`);
    console.log(`   总盈亏: $${result.totalPnl.toFixed(2)}`);
    console.log(`   夏普比率: ${result.sharpeRatio.toFixed(3)}`);
    console.log(`   盈利因子: ${result.profitFactor.toFixed(2)}`);
    console.log(`   最大回撤: ${(result.maxDrawdown * 100).toFixed(2)}%`);
    console.log('');
  });

  const validResults = results.filter(r => !r.error && r.totalTrades > 0);
  if (validResults.length > 0) {
    const avgWinRate = validResults.reduce((sum, r) => sum + r.winRate, 0) / validResults.length;
    const totalPnl = validResults.reduce((sum, r) => sum + r.totalPnl, 0);
    const avgSharpe = validResults.reduce((sum, r) => sum + r.sharpeRatio, 0) / validResults.length;
    const avgDrawdown = validResults.reduce((sum, r) => sum + r.maxDrawdown, 0) / validResults.length;

    console.log(`\n📈 整体统计 (${periodLabel}):`);
    console.log(`   有效策略: ${validResults.length}/${results.length}`);
    console.log(`   平均胜率: ${(avgWinRate * 100).toFixed(2)}%`);
    console.log(`   总盈亏: $${totalPnl.toFixed(2)}`);
    console.log(`   平均夏普比率: ${avgSharpe.toFixed(3)}`);
    console.log(`   平均最大回撤: ${(avgDrawdown * 100).toFixed(2)}%`);
    console.log(`   盈利策略: ${validResults.filter(r => r.totalPnl > 0).length}/${validResults.length}`);
    console.log('');
  }

  console.log(`✨ ${periodLabel}验证完成!\n`);
}

module.exports = {
  runStrategyValidation
};
