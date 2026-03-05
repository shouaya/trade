#!/usr/bin/env node

/**
 * 滚动窗口验证配置检查脚本
 *
 * 用途：检查所有验证配置中的占位符，并从训练结果中提取实际参数值
 *
 * 使用方法：
 *   node train/scripts/rolling-verify.js
 */

const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

// 数据库配置
const dbConfig = {
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'trader',
  password: process.env.DB_PASSWORD || 'traderpass',
  database: process.env.DB_NAME || 'trading',
};

// 月份列表
const MONTHS = [
  '2025_01', '2025_02', '2025_03', '2025_04', '2025_05', '2025_06',
  '2025_07', '2025_08', '2025_09', '2025_10', '2025_11', '2025_12',
  '2026_01', '2026_02'
];

/**
 * 从训练结果表中提取 Top N 策略的参数值
 */
async function extractTopParameters(connection, tableName, topN = 10) {
  console.log(`\n📊 提取 ${tableName} 的 Top ${topN} 参数...`);

  const [rows] = await connection.query(
    `SELECT
      JSON_EXTRACT(parameters, '$.risk.maxHoldMinutes') as maxHoldMinutes,
      JSON_EXTRACT(parameters, '$.atr.slMultiplier') as slMultiplier,
      JSON_EXTRACT(parameters, '$.atr.tpMultiplier') as tpMultiplier,
      total_pnl
    FROM ${tableName}
    WHERE total_trades > 0
    ORDER BY total_pnl DESC
    LIMIT ?`,
    [topN]
  );

  if (rows.length === 0) {
    console.log(`   ⚠️  没有找到训练结果`);
    return null;
  }

  // 提取唯一值
  const maxHoldMinutes = [...new Set(rows.map(r => r.maxHoldMinutes))].sort((a, b) => a - b);
  const slMultiplier = [...new Set(rows.map(r => r.slMultiplier))].sort((a, b) => a - b);
  const tpMultiplier = [...new Set(rows.map(r => r.tpMultiplier))].sort((a, b) => a - b);

  console.log(`   ✅ maxHoldMinutes: [${maxHoldMinutes.join(', ')}]`);
  console.log(`   ✅ slMultiplier: [${slMultiplier.join(', ')}]`);
  console.log(`   ✅ tpMultiplier: [${tpMultiplier.join(', ')}]`);

  return {
    maxHoldMinutes,
    slMultiplier,
    tpMultiplier,
    combinations: maxHoldMinutes.length * slMultiplier.length * tpMultiplier.length
  };
}

/**
 * 更新验证配置文件
 */
async function updateValidationConfig(month, parameters) {
  const configPath = path.join(
    __dirname,
    '..',
    'configs',
    'validation',
    `${month}_rolling_${month}_validation.json`
  );

  console.log(`\n📝 更新配置: ${month}_rolling_${month}_validation.json`);

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    // 检查是否需要更新
    const hasPlaceholder =
      config.strategy?.parameters?.risk?.maxHoldMinutes === "{{FROM_TRAINING_RESULT}}" ||
      config.strategy?.parameters?.atr?.slMultiplier === "{{FROM_TRAINING_RESULT}}" ||
      config.strategy?.parameters?.atr?.tpMultiplier === "{{FROM_TRAINING_RESULT}}";

    if (!hasPlaceholder) {
      console.log(`   ℹ️  配置已更新，跳过`);
      return false;
    }

    // 更新参数
    config.strategy.parameters.risk.maxHoldMinutes = parameters.maxHoldMinutes;
    config.strategy.parameters.atr.slMultiplier = parameters.slMultiplier;
    config.strategy.parameters.atr.tpMultiplier = parameters.tpMultiplier;

    // 添加 output 部分（如果不存在）
    if (!config.output) {
      const [year, monthNum] = month.split('_');
      config.output = {
        topN: 10,
        strategyNamePrefix: `ROLLING_${year}_${monthNum}_`,
        descriptionPrefix: `验证最佳 - ${year}-${monthNum}`
      };
    }

    // 写回文件
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log(`   ✅ 配置已更新 (${parameters.combinations} 个策略组合)`);
    return true;

  } catch (error) {
    console.error(`   ❌ 更新失败: ${error.message}`);
    return false;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           滚动窗口验证配置更新工具                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  let connection;
  try {
    // 连接数据库
    console.log('🔌 连接数据库...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功\n');

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    // 处理每个月份
    for (const month of MONTHS) {
      const trainingTable = `backtest_results_rolling_${month}_train`;

      try {
        // 检查训练表是否存在
        const [tables] = await connection.query(
          `SHOW TABLES LIKE '${trainingTable}'`
        );

        if (tables.length === 0) {
          console.log(`\n⚠️  ${month}: 训练表不存在，跳过`);
          skipped++;
          continue;
        }

        // 提取参数
        const parameters = await extractTopParameters(connection, trainingTable);

        if (!parameters) {
          console.log(`   ⚠️  跳过配置更新`);
          skipped++;
          continue;
        }

        // 更新配置
        const wasUpdated = await updateValidationConfig(month, parameters);
        if (wasUpdated) {
          updated++;
        } else {
          skipped++;
        }

      } catch (error) {
        console.error(`\n❌ ${month} 处理失败: ${error.message}`);
        failed++;
      }
    }

    // 汇总
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                      处理完成                              ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log(`📊 总计: ${MONTHS.length} 个月份`);
    console.log(`   ✅ 已更新: ${updated}`);
    console.log(`   ⏭️  跳过: ${skipped}`);
    console.log(`   ❌ 失败: ${failed}\n`);

    if (updated > 0) {
      console.log('💡 下一步: 运行验证');
      console.log('   make rolling-validate\n');
    }

  } catch (error) {
    console.error(`❌ 错误: ${error.message}`);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 执行
main().catch(console.error);
