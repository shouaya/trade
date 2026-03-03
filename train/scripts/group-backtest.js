const db = require('../config/database');
const StrategyExecutor = require('../services/strategy-executor');
const { generateStrategyCombinations } = require('../services/strategy-parameter-generator');
const { loadNamedConfig, extractConfigArg } = require('./_config');

function parseArgInt(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const config = {
    year: null,
    groupNumber: 1,
    totalGroups: null,
    startIndex: null,
    endIndex: null,
    batchSize: null,
    resultTable: null,
    startIso: null,
    endIso: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--year=')) config.year = parseArgInt(arg.split('=')[1], null);
    else if (arg === '--year') config.year = parseArgInt(args[++i], null);
    else if (arg.startsWith('--group=')) config.groupNumber = parseArgInt(arg.split('=')[1], 1);
    else if (arg === '--group') config.groupNumber = parseArgInt(args[++i], 1);
    else if (arg.startsWith('--groups=')) config.totalGroups = parseArgInt(arg.split('=')[1], null);
    else if (arg === '--groups') config.totalGroups = parseArgInt(args[++i], null);
    else if (arg.startsWith('--startIndex=')) config.startIndex = parseArgInt(arg.split('=')[1], null);
    else if (arg === '--startIndex') config.startIndex = parseArgInt(args[++i], null);
    else if (arg.startsWith('--endIndex=')) config.endIndex = parseArgInt(arg.split('=')[1], null);
    else if (arg === '--endIndex') config.endIndex = parseArgInt(args[++i], null);
    else if (arg.startsWith('--batchSize=')) config.batchSize = parseArgInt(arg.split('=')[1], null);
    else if (arg === '--batchSize') config.batchSize = parseArgInt(args[++i], null);
    else if (arg.startsWith('--resultTable=')) config.resultTable = arg.split('=')[1];
    else if (arg === '--resultTable') config.resultTable = args[++i];
    else if (arg.startsWith('--startIso=')) config.startIso = arg.split('=')[1];
    else if (arg === '--startIso') config.startIso = args[++i];
    else if (arg.startsWith('--endIso=')) config.endIso = arg.split('=')[1];
    else if (arg === '--endIso') config.endIso = args[++i];
  }

  return config;
}

function assertSafeIdentifier(identifier, fieldName) {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`${fieldName} contains invalid characters: ${identifier}`);
  }
}

function calculateGroupRange(totalStrategies, groupNumber, totalGroups) {
  const perGroup = Math.ceil(totalStrategies / totalGroups);
  const startIndex = (groupNumber - 1) * perGroup;
  const endIndex = Math.min(groupNumber * perGroup - 1, totalStrategies - 1);
  return { startIndex, endIndex };
}

function deriveDefaultsFromYear(baseConfig, year) {
  if (!Number.isInteger(year)) return baseConfig;
  return {
    ...baseConfig,
    year,
    resultTable: baseConfig.resultTable || `backtest_results_${year}_full`,
    startIso: baseConfig.startIso || `${year}-01-01T00:00:00Z`,
    endIso: baseConfig.endIso || `${year}-12-31T23:59:59Z`
  };
}

async function runGroupBacktest(config = {}) {
  const merged = {
    year: config.year,
    symbol: config.symbol || 'USDJPY',
    intervalType: config.intervalType || '1min',
    warmupDays: Number.isInteger(config.warmupDays) ? config.warmupDays : 60,
    startIso: config.startIso,
    endIso: config.endIso,
    resultTable: config.resultTable,
    groupNumber: config.groupNumber ?? 1,
    totalGroups: config.totalGroups ?? 10,
    startIndex: config.startIndex ?? null,
    endIndex: config.endIndex ?? null,
    batchSize: config.batchSize ?? 10
  };

  if (!Number.isInteger(merged.groupNumber) || merged.groupNumber < 1) {
    throw new Error(`invalid groupNumber: ${merged.groupNumber}`);
  }
  if (!Number.isInteger(merged.totalGroups) || merged.totalGroups < 1) {
    throw new Error(`invalid totalGroups: ${merged.totalGroups}`);
  }
  if (!Number.isInteger(merged.batchSize) || merged.batchSize < 1) {
    throw new Error(`invalid batchSize: ${merged.batchSize}`);
  }
  if (!merged.startIso || !merged.endIso) {
    throw new Error('startIso and endIso are required');
  }
  if (!merged.resultTable) {
    throw new Error('resultTable is required');
  }
  assertSafeIdentifier(merged.resultTable, 'resultTable');

  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 ${merged.year || '目标'}年策略组${merged.groupNumber}并行回测`);

  const overallStartTime = Date.now();

  try {
    console.log(`📊 加载K线数据 (含${merged.warmupDays}天预热期)...\n`);

    const yearStartTime = new Date(merged.startIso).getTime();
    const yearEndTime = new Date(merged.endIso).getTime();
    const warmupStartTime = yearStartTime - (merged.warmupDays * 24 * 60 * 60 * 1000);

    const [klines] = await db.query(
      `
      SELECT * FROM klines
      WHERE symbol = ? AND interval_type = ?
        AND open_time >= ? AND open_time <= ?
      ORDER BY open_time ASC
      `,
      [merged.symbol, merged.intervalType, warmupStartTime, yearEndTime]
    );

    if (klines.length === 0) {
      throw new Error('没有找到对应区间的K线数据');
    }

    const yearStartIndex = klines.findIndex(k => parseInt(k.open_time, 10) >= yearStartTime);
    const warmupBars = yearStartIndex >= 0 ? yearStartIndex : 0;

    console.log(`✅ 加载了 ${klines.length.toLocaleString()} 条K线数据`);
    console.log(`   完整范围: ${new Date(parseInt(klines[0].open_time, 10)).toISOString()}`);
    console.log(`            ~ ${new Date(parseInt(klines[klines.length - 1].open_time, 10)).toISOString()}`);
    console.log(`   预热期: ${warmupBars.toLocaleString()} 根K线`);
    console.log(`   有效数据: ${(klines.length - warmupBars).toLocaleString()} 根K线\n`);

    console.log('🔧 生成策略组合...');
    const allStrategies = generateStrategyCombinations();
    console.log(`✅ 总共 ${allStrategies.length.toLocaleString()} 个策略\n`);

    let startIndex = merged.startIndex;
    let endIndex = merged.endIndex;
    if (startIndex === null || endIndex === null) {
      const range = calculateGroupRange(allStrategies.length, merged.groupNumber, merged.totalGroups);
      startIndex = range.startIndex;
      endIndex = range.endIndex;
    }

    if (startIndex < 0 || endIndex < startIndex || endIndex >= allStrategies.length) {
      throw new Error(`invalid strategy range: ${startIndex} ~ ${endIndex}`);
    }

    const strategies = allStrategies.slice(startIndex, endIndex + 1);
    console.log(`   策略范围: #${startIndex} ~ #${endIndex}`);
    console.log(`📦 当前组策略数: ${strategies.length.toLocaleString()}\n`);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ${merged.resultTable} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        strategy_id INT NOT NULL,
        strategy_name VARCHAR(255) NOT NULL,
        strategy_type VARCHAR(50) NOT NULL,
        parameters JSON NOT NULL,
        total_trades INT DEFAULT 0,
        win_rate DECIMAL(5, 4) DEFAULT 0,
        total_pnl DECIMAL(10, 2) DEFAULT 0,
        avg_pnl DECIMAL(10, 2) DEFAULT 0,
        sharpe_ratio DECIMAL(10, 3) DEFAULT 0,
        profit_factor DECIMAL(10, 2) DEFAULT 0,
        max_drawdown DECIMAL(5, 4) DEFAULT 0,
        score DECIMAL(10, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_score (score DESC),
        INDEX idx_strategy_name (strategy_name),
        UNIQUE KEY unique_strategy_name (strategy_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log(`✅ 结果表 ${merged.resultTable} 已准备\n`);

    const placeholders = strategies.map(() => '?').join(',');
    const [completedStrategies] = await db.query(
      `
      SELECT strategy_name FROM ${merged.resultTable}
      WHERE strategy_name IN (${placeholders})
      `,
      strategies.map(s => s.name)
    );
    const completedSet = new Set(completedStrategies.map(s => s.strategy_name));
    console.log(`🔍 已完成策略: ${completedSet.size}\n`);

    const results = [];
    let validCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];

      if (completedSet.has(strategy.name)) {
        skippedCount++;
        continue;
      }

      try {
        const executor = new StrategyExecutor(strategy, klines);
        const result = await executor.execute();
        const stats = result.stats;

        const score = (
          stats.totalPnl * 0.3 +
          stats.winRate * 50 * 0.2 +
          stats.sharpeRatio * 10 * 0.25 +
          stats.profitFactor * 5 * 0.15 +
          (1 - stats.maxDrawdown) * 20 * 0.1
        );

        results.push([
          strategy.id,
          strategy.name,
          strategy.type,
          JSON.stringify(strategy.parameters),
          stats.totalTrades,
          stats.winRate,
          stats.totalPnl,
          stats.avgPnl,
          stats.sharpeRatio,
          stats.profitFactor,
          stats.maxDrawdown,
          score
        ]);

        validCount++;
      } catch (error) {
        errorCount++;
        if (errorCount <= 5) {
          console.error(`   ⚠️  策略 ${strategy.name} 失败: ${error.message}`);
        }
      }

      if (results.length >= merged.batchSize || i === strategies.length - 1) {
        if (results.length > 0) {
          await db.query(
            `
            INSERT IGNORE INTO ${merged.resultTable}
            (strategy_id, strategy_name, strategy_type, parameters,
             total_trades, win_rate, total_pnl, avg_pnl,
             sharpe_ratio, profit_factor, max_drawdown, score)
            VALUES ?
            `,
            [results]
          );
          results.length = 0;
          if (global.gc) global.gc();
        }
      }

      if ((i + 1) % 500 === 0 || i === strategies.length - 1) {
        const progress = i + 1;
        const percentage = ((progress / strategies.length) * 100).toFixed(1);
        const elapsedMs = Date.now() - overallStartTime;
        const elapsedMin = (elapsedMs / 60000).toFixed(2);
        const actualProcessed = validCount + errorCount;
        const rate = actualProcessed > 0 ? (actualProcessed / elapsedMs) * 1000 : 0;
        const remainingMin = rate > 0 ? ((strategies.length - progress) / rate) / 60 : 0;

        console.log(
          `[组${merged.groupNumber}] 进度: ${progress.toLocaleString()}/${strategies.length.toLocaleString()} (${percentage}%) | ` +
          `耗时: ${elapsedMin}分钟 | 剩余: ${remainingMin.toFixed(1)}分钟 | ` +
          `成功: ${validCount} | 失败: ${errorCount} | 跳过: ${skippedCount}`
        );
      }
    }

    console.log(`\n✅ 组${merged.groupNumber} 回测完成!`);
    console.log(`   有效策略: ${validCount}/${strategies.length}`);
    console.log(`   失败策略: ${errorCount}`);
    console.log(`   跳过策略: ${skippedCount}`);
  } catch (error) {
    console.error(`\n❌ 组${merged.groupNumber} 回测失败: ${error.message}`);
    throw error;
  }
}

if (require.main === module) {
  const { configName, passthroughArgv } = extractConfigArg(process.argv, 'default');
  const baseConfig = loadNamedConfig('group-backtest', configName);
  const cli = parseCliArgs(passthroughArgv);
  const withYearDefaults = deriveDefaultsFromYear(baseConfig, cli.year || baseConfig.year);
  const finalConfig = {
    ...withYearDefaults,
    ...Object.fromEntries(Object.entries(cli).filter(([, v]) => v !== null))
  };

  runGroupBacktest(finalConfig)
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err.stack);
      process.exit(1);
    });
}

module.exports = {
  runGroupBacktest,
  parseCliArgs
};
