/**
 * 只运行验证步骤（跳过训练）
 * 用于在训练数据已存在时，只执行验证
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

// 月份列表
const MONTHS = [
  '2025_01', '2025_02', '2025_03', '2025_04', '2025_05', '2025_06',
  '2025_07', '2025_08', '2025_09', '2025_10', '2025_11', '2025_12',
  '2026_01', '2026_02'
];

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
    name: `ROLLING_${month}_VALIDATE`,
    description: `${year}-${mo}月验证 - 使用训练最佳策略`,
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
      tableName: `backtest_results_rolling_${month}_validate`
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
 * 处理单个月份的验证
 */
async function validateMonth(month) {
  console.log('\n' + '='.repeat(80));
  console.log(`验证月份: ${month.replace('_', '-')}`);
  console.log('='.repeat(80));

  try {
    // Step 1: 获取最佳策略
    console.log(`\n[1/2] 获取训练最佳策略...`);
    const bestStrategy = await getBestStrategy(month);
    console.log(`\n✓ 最佳策略: ${bestStrategy.name}`);
    console.log(`  总盈亏: $${bestStrategy.pnl}`);
    console.log(`  交易次数: ${bestStrategy.trades}`);
    console.log(`  胜率: ${(bestStrategy.winRate * 100).toFixed(2)}%`);
    console.log(`  参数: H${bestStrategy.maxHoldMinutes} SL${bestStrategy.atrSlMultiplier}x TP${bestStrategy.atrTpMultiplier}x`);

    // Step 2: 生成并执行验证配置
    console.log(`\n[2/2] 验证阶段 - 在${month.replace('_', '-')}月验证...`);
    const validateConfig = generateValidationConfig(month, bestStrategy);
    const validateConfigPath = path.join(__dirname, '../configs/rolling_window/validation', `validate_${month}_auto.json`);
    fs.writeFileSync(validateConfigPath, JSON.stringify(validateConfig, null, 2));

    await runCommand(`node scripts/train.js ${validateConfigPath}`);

    console.log(`\n✅ ${month.replace('_', '-')} 验证完成！`);
    return {
      month: month.replace('_', '-'),
      bestStrategy,
      success: true
    };

  } catch (error) {
    console.error(`\n❌ ${month.replace('_', '-')} 验证失败:`, error.message);
    return {
      month: month.replace('_', '-'),
      success: false,
      error: error.message
    };
  }
}

/**
 * 生成汇总报告
 */
async function generateSummaryReport(results) {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log('\n' + '='.repeat(80));
  console.log('生成汇总报告...');
  console.log('='.repeat(80));

  const summary = [];

  for (const result of results) {
    if (!result.success) continue;

    const month = result.month.replace('-', '_');
    const tableName = `backtest_results_rolling_${month}_validate`;

    try {
      const [rows] = await db.query(`
        SELECT
          total_pnl,
          total_trades,
          win_rate,
          sharpe_ratio,
          profit_factor
        FROM ${tableName}
        ORDER BY total_pnl DESC
        LIMIT 1
      `);

      if (rows.length > 0) {
        summary.push({
          month: result.month,
          trainStrategy: result.bestStrategy.name,
          trainPnl: result.bestStrategy.pnl,
          trainWinRate: (result.bestStrategy.winRate * 100).toFixed(1) + '%',
          validatePnl: rows[0].total_pnl,
          validateTrades: rows[0].total_trades,
          validateWinRate: (rows[0].win_rate * 100).toFixed(1) + '%',
          validateSharpe: rows[0].sharpe_ratio,
          validateProfitFactor: rows[0].profit_factor
        });
      }
    } catch (error) {
      console.error(`Error querying ${tableName}:`, error.message);
    }
  }

  await db.end();

  // 打印汇总表格
  console.log('\n滚动窗口策略汇总 (训练 vs 验证):');
  console.log('─'.repeat(120));
  console.table(summary);

  // 计算总体统计
  if (summary.length > 0) {
    const totalValidatePnl = summary.reduce((sum, s) => sum + parseFloat(s.validatePnl), 0);
    const totalValidateTrades = summary.reduce((sum, s) => sum + s.validateTrades, 0);
    const avgValidatePnl = totalValidatePnl / summary.length;
    const profitableMonths = summary.filter(s => parseFloat(s.validatePnl) > 0).length;

    console.log('\n验证期总体统计:');
    console.log(`  总验证盈亏: $${totalValidatePnl.toFixed(2)}`);
    console.log(`  总验证交易数: ${totalValidateTrades}`);
    console.log(`  平均月度盈亏: $${avgValidatePnl.toFixed(2)}`);
    console.log(`  盈利月份: ${profitableMonths}/${summary.length}`);
    console.log(`  盈利月份率: ${(profitableMonths / summary.length * 100).toFixed(1)}%`);

    // 保存报告到文件
    const reportPath = path.join(__dirname, '../reports/rolling_window_validation_summary.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      summary,
      totals: {
        totalValidatePnl,
        totalValidateTrades,
        avgValidatePnl,
        profitableMonths,
        totalMonths: summary.length
      }
    }, null, 2));

    console.log(`\n报告已保存: ${reportPath}`);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🔄 开始滚动窗口验证流程（仅验证，跳过训练）...');
  console.log(`   总共 ${MONTHS.length} 个月需要验证`);
  console.log(`   每个月: 从训练结果提取最佳策略 -> 在当月验证`);
  console.log(`   预计耗时: 1-2小时`);

  const startTime = Date.now();
  const results = [];

  for (const month of MONTHS) {
    const result = await validateMonth(month);
    results.push(result);
  }

  // 生成汇总报告
  await generateSummaryReport(results);

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
  console.log(`\n\n✅ 全部完成！总耗时: ${elapsed} 分钟`);
  console.log(`成功: ${results.filter(r => r.success).length}/${results.length}`);
}

// 运行
main().catch(error => {
  console.error('❌ 执行失败:', error);
  process.exit(1);
});
