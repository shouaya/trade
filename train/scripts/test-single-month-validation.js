/**
 * 测试单月验证流程
 * 用于验证修复后的参数提取逻辑
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const TEST_MONTH = '2025_01';

/**
 * 从数据库获取最佳策略
 */
async function getBestStrategy(month) {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const tableName = `backtest_results_rolling_${month}_train`;

  try {
    const [results] = await db.query(`
      SELECT
        strategy_name,
        total_pnl,
        total_trades,
        win_rate,
        sharpe_ratio,
        profit_factor,
        parameters
      FROM ${tableName}
      ORDER BY total_pnl DESC
      LIMIT 1
    `);

    if (results.length === 0) {
      throw new Error(`No training results found in ${tableName}`);
    }

    const best = results[0];
    // MySQL returns parameters as an object directly (not JSON string)
    const params = best.parameters;

    await db.end();
    return {
      name: best.strategy_name,
      pnl: best.total_pnl,
      trades: best.total_trades,
      winRate: best.win_rate,
      sharpe: best.sharpe_ratio,
      profitFactor: best.profit_factor,
      maxHoldMinutes: params.risk.maxHoldMinutes,
      atrSlMultiplier: params.atr.slMultiplier,
      atrTpMultiplier: params.atr.tpMultiplier
    };
  } catch (error) {
    await db.end();
    throw error;
  }
}

/**
 * 生成验证配置文件
 */
function generateValidationConfig(month, bestStrategy) {
  const [year, mo] = month.split('_');
  const lastDay = new Date(parseInt(year), parseInt(mo), 0).getDate();

  const startDate = `${year}-${mo}-01T00:00:00.000Z`;
  const endDate = `${year}-${mo}-${lastDay}T23:59:00.000Z`;

  const config = {
    name: `ROLLING_${month}_VALIDATE_TEST`,
    description: `${year}-${mo}月验证测试 - 使用训练最佳策略`,
    timeRange: {
      startTimeMs: new Date(startDate).getTime(),
      endTimeMs: new Date(endDate).getTime(),
      startIso: startDate,
      endIso: endDate
    },
    market: {
      symbol: "USDJPY",
      intervalType: "1min"
    },
    database: {
      tableName: `backtest_results_rolling_${month}_validate_test`
    },
    strategy: {
      types: ["rsi_only"],
      parameters: {
        rsi: {
          period: [14],
          oversold: [30],
          overbought: [70]
        },
        risk: {
          maxPositions: [1],
          lotSize: [0.1],
          maxHoldMinutes: [bestStrategy.maxHoldMinutes]
        },
        atr: {
          slMultiplier: [bestStrategy.atrSlMultiplier],
          tpMultiplier: [bestStrategy.atrTpMultiplier]
        },
        tradingSchedule: "* 0-19 * * 1-5",
        tradingTimeRestriction: {
          enabled: true,
          utcExcludeStart: "19:30",
          utcExcludeEnd: "23:59"
        }
      }
    },
    executor: {
      version: "v3",
      options: {
        enableMA200Filter: true,
        enableMultiTimeframe: true,
        enableATRSizing: true,
        enableTrailingStop: true,
        enableRSIReversion: true
      }
    },
    bestStrategyFromTraining: bestStrategy
  };

  return config;
}

/**
 * 执行shell命令
 */
function runCommand(command) {
  return new Promise((resolve, reject) => {
    console.log(`\n执行: ${command}`);
    const child = exec(command, { maxBuffer: 10 * 1024 * 1024 });

    child.stdout.on('data', data => process.stdout.write(data));
    child.stderr.on('data', data => process.stderr.write(data));

    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
  });
}

/**
 * 主测试流程
 */
async function main() {
  console.log('🧪 测试单月验证流程');
  console.log(`   测试月份: ${TEST_MONTH.replace('_', '-')}`);
  console.log('='.repeat(80));

  try {
    // Step 1: 获取最佳策略
    console.log(`\n[1/3] 从数据库获取最佳策略...`);
    const bestStrategy = await getBestStrategy(TEST_MONTH);

    console.log(`\n✓ 最佳策略: ${bestStrategy.name}`);
    console.log(`  总盈亏: $${bestStrategy.pnl}`);
    console.log(`  交易次数: ${bestStrategy.trades}`);
    console.log(`  胜率: ${(bestStrategy.winRate * 100).toFixed(2)}%`);
    console.log(`  夏普比率: ${bestStrategy.sharpe}`);
    console.log(`  参数: H${bestStrategy.maxHoldMinutes} SL${bestStrategy.atrSlMultiplier}x TP${bestStrategy.atrTpMultiplier}x`);

    // Step 2: 生成验证配置
    console.log(`\n[2/3] 生成验证配置文件...`);
    const validateConfig = generateValidationConfig(TEST_MONTH, bestStrategy);
    const validateConfigPath = path.join(__dirname, '../configs/rolling_window/validation', `validate_${TEST_MONTH}_test.json`);
    fs.writeFileSync(validateConfigPath, JSON.stringify(validateConfig, null, 2));
    console.log(`✓ 配置文件已生成: ${validateConfigPath}`);

    // Step 3: 执行验证
    console.log(`\n[3/3] 执行验证...`);
    await runCommand(`node scripts/train.js ${validateConfigPath}`);

    console.log(`\n✅ 测试成功！验证流程工作正常`);
    console.log(`\n可以查看验证结果:`);
    console.log(`   表名: backtest_results_rolling_${TEST_MONTH}_validate_test`);

  } catch (error) {
    console.error(`\n❌ 测试失败:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行测试
main().catch(error => {
  console.error('❌ 执行失败:', error);
  process.exit(1);
});
