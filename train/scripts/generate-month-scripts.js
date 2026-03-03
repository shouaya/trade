/**
 * 生成12个按月回测脚本
 * 从模板生成12个独立的月份脚本
 */

const fs = require('fs');
const path = require('path');

// 2025年每月的日期范围
const MONTHS = [
  { number: 1, str: '01', start: '2025-01-01', end: '2025-01-31', suffix: '2025_01' },
  { number: 2, str: '02', start: '2025-02-01', end: '2025-02-28', suffix: '2025_02' },
  { number: 3, str: '03', start: '2025-03-01', end: '2025-03-31', suffix: '2025_03' },
  { number: 4, str: '04', start: '2025-04-01', end: '2025-04-30', suffix: '2025_04' },
  { number: 5, str: '05', start: '2025-05-01', end: '2025-05-31', suffix: '2025_05' },
  { number: 6, str: '06', start: '2025-06-01', end: '2025-06-30', suffix: '2025_06' },
  { number: 7, str: '07', start: '2025-07-01', end: '2025-07-31', suffix: '2025_07' },
  { number: 8, str: '08', start: '2025-08-01', end: '2025-08-31', suffix: '2025_08' },
  { number: 9, str: '09', start: '2025-09-01', end: '2025-09-30', suffix: '2025_09' },
  { number: 10, str: '10', start: '2025-10-01', end: '2025-10-31', suffix: '2025_10' },
  { number: 11, str: '11', start: '2025-11-01', end: '2025-11-30', suffix: '2025_11' },
  { number: 12, str: '12', start: '2025-12-01', end: '2025-12-31', suffix: '2025_12' }
];

function main() {
  console.log('🔧 生成12个月份回测脚本...\n');

  // 读取模板
  const templatePath = path.join(__dirname, 'run-backtest-2025-month-template.js');
  if (!fs.existsSync(templatePath)) {
    console.error(`❌ 模板文件不存在: ${templatePath}`);
    process.exit(1);
  }

  const template = fs.readFileSync(templatePath, 'utf8');
  console.log(`✅ 读取模板: ${templatePath}\n`);

  // 为每个月生成脚本
  MONTHS.forEach(month => {
    const script = template
      .replace(/{{MONTH_NUMBER}}/g, month.number)
      .replace(/{{MONTH_STR}}/g, month.str)
      .replace(/{{START_DATE}}/g, month.start)
      .replace(/{{END_DATE}}/g, month.end)
      .replace(/{{TABLE_SUFFIX}}/g, month.suffix);

    const outputPath = path.join(__dirname, `run-backtest-2025-m${month.str}.js`);
    fs.writeFileSync(outputPath, script, 'utf8');

    console.log(`✅ 生成: run-backtest-2025-m${month.str}.js`);
    console.log(`   月份: ${month.number}月 (${month.start} ~ ${month.end})`);
    console.log(`   结果表: backtest_results_${month.suffix}\n`);
  });

  console.log('='.repeat(80));
  console.log('✨ 12个月份脚本生成完成!\n');
  console.log('执行方式:');
  console.log('  1. 单独运行某个月: node scripts/run-backtest-2025-m01.js');
  console.log('  2. 并行运行所有月: bash scripts/launch-parallel-backtest.sh');
  console.log('='.repeat(80));
}

main();


