#!/usr/bin/env node

/**
 * 验证策略对比分析报告
 *
 * 对比不同训练方案的验证结果：
 * 1. 固定窗口策略（2024全年、2025全年）
 * 2. 滚动窗口策略（14个月）
 *
 * 分析维度：
 * - 总盈利 (Total PnL)
 * - 胜率 (Win Rate)
 * - 交易次数 (Total Trades)
 * - 夏普比率 (Sharpe Ratio)
 * - 最大回撤 (Max Drawdown)
 * - 综合评分 (Score)
 */

const mysql = require('mysql2/promise');
const fs = require('fs').promises;

// 数据库配置
const dbConfig = {
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'trader',
  password: process.env.DB_PASSWORD || 'traderpass',
  database: process.env.DB_NAME || 'trading',
};

// 验证配置
const VALIDATION_CONFIGS = [
  // 固定窗口
  { name: '2024全年', table: 'backtest_results_2024_validate', type: 'fixed' },
  { name: '2025全年', table: 'backtest_results_2025_validate', type: 'fixed' },

  // 滚动窗口
  { name: '2025-01滚动', table: 'backtest_results_rolling_2025_01_validate', type: 'rolling', month: '2025-01' },
  { name: '2025-02滚动', table: 'backtest_results_rolling_2025_02_validate', type: 'rolling', month: '2025-02' },
  { name: '2025-03滚动', table: 'backtest_results_rolling_2025_03_validate', type: 'rolling', month: '2025-03' },
  { name: '2025-04滚动', table: 'backtest_results_rolling_2025_04_validate', type: 'rolling', month: '2025-04' },
  { name: '2025-05滚动', table: 'backtest_results_rolling_2025_05_validate', type: 'rolling', month: '2025-05' },
  { name: '2025-06滚动', table: 'backtest_results_rolling_2025_06_validate', type: 'rolling', month: '2025-06' },
  { name: '2025-07滚动', table: 'backtest_results_rolling_2025_07_validate', type: 'rolling', month: '2025-07' },
  { name: '2025-08滚动', table: 'backtest_results_rolling_2025_08_validate', type: 'rolling', month: '2025-08' },
  { name: '2025-09滚动', table: 'backtest_results_rolling_2025_09_validate', type: 'rolling', month: '2025-09' },
  { name: '2025-10滚动', table: 'backtest_results_rolling_2025_10_validate', type: 'rolling', month: '2025-10' },
  { name: '2025-11滚动', table: 'backtest_results_rolling_2025_11_validate', type: 'rolling', month: '2025-11' },
  { name: '2025-12滚动', table: 'backtest_results_rolling_2025_12_validate', type: 'rolling', month: '2025-12' },
  { name: '2026-01滚动', table: 'backtest_results_rolling_2026_01_validate', type: 'rolling', month: '2026-01' },
  { name: '2026-02滚动', table: 'backtest_results_rolling_2026_02_validate', type: 'rolling', month: '2026-02' },
];

/**
 * 查询表的Top策略
 */
async function queryTopStrategy(connection, tableName) {
  try {
    // 检查表是否存在
    const [tables] = await connection.query(`SHOW TABLES LIKE '${tableName}'`);
    if (tables.length === 0) {
      return null;
    }

    // 查询Top 1策略
    const [rows] = await connection.query(
      `SELECT
        strategy_name,
        strategy_type,
        total_trades,
        winning_trades,
        losing_trades,
        win_rate,
        total_pnl,
        avg_pnl,
        sharpe_ratio,
        profit_factor,
        max_drawdown,
        score,
        parameters
      FROM ${tableName}
      WHERE total_trades > 0
      ORDER BY total_pnl DESC
      LIMIT 1`
    );

    if (rows.length === 0) {
      return null;
    }

    return rows[0];
  } catch (error) {
    console.error(`   ❌ 查询失败: ${error.message}`);
    return null;
  }
}

/**
 * 格式化数字
 */
function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined) return 'N/A';
  return Number(num).toFixed(decimals);
}

/**
 * 格式化百分比
 */
function formatPercent(num) {
  if (num === null || num === undefined) return 'N/A';
  return (Number(num) * 100).toFixed(2) + '%';
}

/**
 * 生成控制台表格
 */
function printTable(data, title) {
  console.log(`\n${'='.repeat(140)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(140));

  // 表头
  console.log(
    '类型'.padEnd(12) +
    '名称'.padEnd(16) +
    '策略名称'.padEnd(35) +
    '交易数'.padStart(8) +
    '胜率'.padStart(10) +
    '总盈亏'.padStart(12) +
    '平均盈亏'.padStart(12) +
    '夏普比率'.padStart(10) +
    '最大回撤'.padStart(12) +
    '评分'.padStart(10)
  );
  console.log('-'.repeat(140));

  // 数据行
  data.forEach(row => {
    if (!row.strategy) {
      console.log(`${row.type.padEnd(12)}${row.name.padEnd(16)}${'表不存在或无数据'.padEnd(35)}`);
      return;
    }

    const s = row.strategy;
    console.log(
      row.type.padEnd(12) +
      row.name.padEnd(16) +
      (s.strategy_name || 'N/A').substring(0, 34).padEnd(35) +
      (s.total_trades || 0).toString().padStart(8) +
      formatPercent(s.win_rate).padStart(10) +
      ('$' + formatNumber(s.total_pnl, 2)).padStart(12) +
      ('$' + formatNumber(s.avg_pnl, 2)).padStart(12) +
      formatNumber(s.sharpe_ratio, 4).padStart(10) +
      ('$' + formatNumber(Math.abs(s.max_drawdown || 0), 2)).padStart(12) +
      formatNumber(s.score, 2).padStart(10)
    );
  });

  console.log('='.repeat(140));
}

/**
 * 生成Markdown报告
 */
async function generateMarkdownReport(data) {
  let md = '# 策略验证对比分析报告\n\n';
  md += `生成时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n`;

  // 执行摘要
  md += '## 执行摘要\n\n';

  const validData = data.filter(d => d.strategy);
  const bestOverall = validData.reduce((best, curr) =>
    (curr.strategy.total_pnl > (best?.strategy?.total_pnl || 0)) ? curr : best
  , null);

  const bestFixed = data.filter(d => d.type === 'fixed' && d.strategy)
    .reduce((best, curr) =>
      (curr.strategy.total_pnl > (best?.strategy?.total_pnl || 0)) ? curr : best
    , null);

  const rollingData = data.filter(d => d.type === 'rolling' && d.strategy);
  const rollingTotalPnl = rollingData.reduce((sum, d) => sum + (d.strategy.total_pnl || 0), 0);
  const rollingAvgPnl = rollingTotalPnl / rollingData.length;

  md += `- **最佳整体策略**: ${bestOverall?.name || 'N/A'} (总盈亏: $${formatNumber(bestOverall?.strategy?.total_pnl || 0)})\n`;
  md += `- **最佳固定窗口**: ${bestFixed?.name || 'N/A'} (总盈亏: $${formatNumber(bestFixed?.strategy?.total_pnl || 0)})\n`;
  md += `- **滚动窗口平均**: 14个月平均盈亏 $${formatNumber(rollingAvgPnl)} (总计: $${formatNumber(rollingTotalPnl)})\n`;
  md += `- **有效验证数**: ${validData.length}/${data.length}\n\n`;

  // 固定窗口对比
  md += '## 1. 固定窗口策略对比\n\n';
  md += '| 训练窗口 | 策略名称 | 交易数 | 胜率 | 总盈亏 | 平均盈亏 | 夏普比率 | 最大回撤 | 评分 |\n';
  md += '|---------|---------|-------|------|--------|---------|---------|---------|------|\n';

  data.filter(d => d.type === 'fixed').forEach(row => {
    if (!row.strategy) {
      md += `| ${row.name} | 无数据 | - | - | - | - | - | - | - |\n`;
      return;
    }
    const s = row.strategy;
    md += `| ${row.name} | ${s.strategy_name?.substring(0, 30) || 'N/A'} | ${s.total_trades || 0} | ${formatPercent(s.win_rate)} | $${formatNumber(s.total_pnl)} | $${formatNumber(s.avg_pnl)} | ${formatNumber(s.sharpe_ratio, 4)} | $${formatNumber(Math.abs(s.max_drawdown || 0))} | ${formatNumber(s.score, 2)} |\n`;
  });

  // 滚动窗口详情
  md += '\n## 2. 滚动窗口策略详情 (按月)\n\n';
  md += '| 执行月份 | 策略名称 | 交易数 | 胜率 | 总盈亏 | 平均盈亏 | 夏普比率 | 最大回撤 | 评分 |\n';
  md += '|---------|---------|-------|------|--------|---------|---------|---------|------|\n';

  const rollingByMonth = data.filter(d => d.type === 'rolling').sort((a, b) => {
    if (!a.month || !b.month) return 0;
    return a.month.localeCompare(b.month);
  });

  rollingByMonth.forEach(row => {
    if (!row.strategy) {
      md += `| ${row.month || row.name} | 无数据 | - | - | - | - | - | - | - |\n`;
      return;
    }
    const s = row.strategy;
    md += `| ${row.month} | ${s.strategy_name?.substring(0, 30) || 'N/A'} | ${s.total_trades || 0} | ${formatPercent(s.win_rate)} | $${formatNumber(s.total_pnl)} | $${formatNumber(s.avg_pnl)} | ${formatNumber(s.sharpe_ratio, 4)} | $${formatNumber(Math.abs(s.max_drawdown || 0))} | ${formatNumber(s.score, 2)} |\n`;
  });

  // 滚动窗口统计
  md += '\n## 3. 滚动窗口统计分析\n\n';

  if (rollingData.length > 0) {
    const pnls = rollingData.map(d => d.strategy.total_pnl);
    const winRates = rollingData.map(d => d.strategy.win_rate);
    const trades = rollingData.map(d => d.strategy.total_trades);

    const maxPnl = Math.max(...pnls);
    const minPnl = Math.min(...pnls);
    const avgWinRate = winRates.reduce((a, b) => a + b, 0) / winRates.length;
    const totalTrades = trades.reduce((a, b) => a + b, 0);

    md += `- **盈亏范围**: $${formatNumber(minPnl)} ~ $${formatNumber(maxPnl)}\n`;
    md += `- **平均盈亏**: $${formatNumber(rollingAvgPnl)}\n`;
    md += `- **平均胜率**: ${formatPercent(avgWinRate)}\n`;
    md += `- **总交易次数**: ${totalTrades}\n`;
    md += `- **月均交易数**: ${formatNumber(totalTrades / rollingData.length, 0)}\n\n`;

    // 最佳月份
    const bestMonth = rollingData.reduce((best, curr) =>
      (curr.strategy.total_pnl > best.strategy.total_pnl) ? curr : best
    );
    const worstMonth = rollingData.reduce((worst, curr) =>
      (curr.strategy.total_pnl < worst.strategy.total_pnl) ? curr : worst
    );

    md += `- **最佳月份**: ${bestMonth.month} ($${formatNumber(bestMonth.strategy.total_pnl)})\n`;
    md += `- **最差月份**: ${worstMonth.month} ($${formatNumber(worstMonth.strategy.total_pnl)})\n`;
  }

  // 策略参数分析
  md += '\n## 4. 最佳策略参数分析\n\n';

  if (bestOverall?.strategy?.parameters) {
    try {
      const params = typeof bestOverall.strategy.parameters === 'string'
        ? JSON.parse(bestOverall.strategy.parameters)
        : bestOverall.strategy.parameters;

      md += '### 最佳整体策略参数\n\n';
      md += '```json\n';
      md += JSON.stringify(params, null, 2);
      md += '\n```\n\n';
    } catch (error) {
      md += '参数解析失败\n\n';
    }
  }

  // 推荐结论
  md += '## 5. 推荐结论\n\n';

  md += '### 策略选择建议\n\n';

  if (bestFixed && rollingAvgPnl > 0) {
    const fixedVsRolling = bestFixed.strategy.total_pnl / rollingAvgPnl;

    if (fixedVsRolling > 2) {
      md += `✅ **推荐固定窗口策略**\n\n`;
      md += `- 固定窗口策略 (${bestFixed.name}) 表现显著优于滚动窗口平均水平\n`;
      md += `- 盈亏比: ${formatNumber(fixedVsRolling, 2)}:1\n`;
      md += `- 建议使用: ${bestFixed.name} 的最佳策略\n`;
    } else if (fixedVsRolling < 0.5) {
      md += `✅ **推荐滚动窗口策略**\n\n`;
      md += `- 滚动窗口策略整体表现优于固定窗口\n`;
      md += `- 优势: 更好地适应市场变化，每月调整参数\n`;
      md += `- 建议使用: 滚动窗口策略，每月使用对应月份的最佳参数\n`;
    } else {
      md += `⚖️ **两种策略各有优势**\n\n`;
      md += `- 固定窗口: 简单稳定，适合长期持有\n`;
      md += `- 滚动窗口: 灵活适应，但需定期调整参数\n`;
      md += `- 建议: 根据您的交易风格和维护能力选择\n`;
    }
  }

  md += '\n### 风险提示\n\n';
  md += '- ⚠️ 历史表现不代表未来收益\n';
  md += '- ⚠️ 回测数据可能存在过拟合风险\n';
  md += '- ⚠️ 实盘交易需考虑滑点、手续费等因素\n';
  md += '- ⚠️ 建议从小资金开始验证策略有效性\n';
  md += '- ⚠️ 持续监控策略表现，及时调整\n\n';

  md += '---\n\n';
  md += '*此报告由自动化脚本生成，数据来源于回测验证结果*\n';

  return md;
}

/**
 * 主函数
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              策略验证对比分析报告                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  let connection;
  try {
    // 连接数据库
    console.log('🔌 连接数据库...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功\n');

    // 收集所有数据
    const results = [];

    for (const config of VALIDATION_CONFIGS) {
      console.log(`📊 查询: ${config.name}...`);
      const strategy = await queryTopStrategy(connection, config.table);

      results.push({
        type: config.type,
        name: config.name,
        month: config.month,
        table: config.table,
        strategy: strategy
      });

      if (strategy) {
        console.log(`   ✅ 找到策略 (盈亏: $${formatNumber(strategy.total_pnl)})`);
      } else {
        console.log(`   ⚠️  无数据`);
      }
    }

    // 打印控制台表格
    console.log('\n');
    const fixedResults = results.filter(r => r.type === 'fixed');
    const rollingResults = results.filter(r => r.type === 'rolling');

    printTable(fixedResults, '固定窗口策略');
    printTable(rollingResults, '滚动窗口策略 (按月)');

    // 生成Markdown报告
    console.log('\n📝 生成Markdown报告...');
    const markdown = await generateMarkdownReport(results);

    const reportPath = '/app/reports/strategy_comparison_fixed_vs_rolling.md';
    await fs.writeFile(reportPath, markdown, 'utf-8');
    console.log(`✅ 报告已保存: ${reportPath}\n`);

    // 总结
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                      分析完成                              ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const validCount = results.filter(r => r.strategy).length;
    console.log(`📊 验证结果: ${validCount}/${results.length} 个验证有数据\n`);

    const bestResult = results
      .filter(r => r.strategy)
      .reduce((best, curr) =>
        (curr.strategy.total_pnl > (best?.strategy?.total_pnl || 0)) ? curr : best
      , null);

    if (bestResult) {
      console.log('🏆 最佳策略:');
      console.log(`   - 类型: ${bestResult.type === 'fixed' ? '固定窗口' : '滚动窗口'}`);
      console.log(`   - 名称: ${bestResult.name}`);
      console.log(`   - 策略: ${bestResult.strategy.strategy_name}`);
      console.log(`   - 总盈亏: $${formatNumber(bestResult.strategy.total_pnl)}`);
      console.log(`   - 胜率: ${formatPercent(bestResult.strategy.win_rate)}`);
      console.log(`   - 交易数: ${bestResult.strategy.total_trades}\n`);
    }

    console.log('💡 查看完整报告:');
    console.log(`   cat train/reports/strategy_comparison_fixed_vs_rolling.md\n`);

  } catch (error) {
    console.error(`❌ 错误: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 执行
main().catch(console.error);
