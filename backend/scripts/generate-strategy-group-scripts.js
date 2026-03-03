/**
 * 生成10个策略组的回测脚本
 * 将18,480个策略分成10组,每组约1,848个策略
 */

const fs = require('fs');
const path = require('path');

const TOTAL_STRATEGIES = 18480;  // 优化后: RSI=14, maxPos=1, MACD标准参数, 去掉1440
const NUM_GROUPS = 10;
const STRATEGIES_PER_GROUP = Math.ceil(TOTAL_STRATEGIES / NUM_GROUPS);

console.log('================================================================================');
console.log('🔧 生成10个策略组的回测脚本');
console.log('================================================================================\n');

console.log(`总策略数: ${TOTAL_STRATEGIES.toLocaleString()}`);
console.log(`分组数: ${NUM_GROUPS}`);
console.log(`每组策略数: ~${STRATEGIES_PER_GROUP.toLocaleString()}\n`);

// 读取模板
const templatePath = path.join(__dirname, 'run-backtest-2025-strategy-group-template.js');
const template = fs.readFileSync(templatePath, 'utf8');

// 生成10个脚本
for (let group = 1; group <= NUM_GROUPS; group++) {
  const startIndex = (group - 1) * STRATEGIES_PER_GROUP;
  const endIndex = Math.min(group * STRATEGIES_PER_GROUP - 1, TOTAL_STRATEGIES - 1);
  const actualCount = endIndex - startIndex + 1;

  // 替换模板中的占位符
  let script = template;
  script = script.replace('{{GROUP_NUMBER}}', group);
  script = script.replace('{{START_INDEX}}', startIndex);
  script = script.replace('{{END_INDEX}}', endIndex);

  // 写入文件
  const scriptName = `run-backtest-2025-group${group.toString().padStart(2, '0')}.js`;
  const scriptPath = path.join(__dirname, scriptName);
  fs.writeFileSync(scriptPath, script);

  console.log(`✅ 组${group}: ${scriptName}`);
  console.log(`   策略范围: #${startIndex.toLocaleString()} ~ #${endIndex.toLocaleString()}`);
  console.log(`   策略数量: ${actualCount.toLocaleString()}\n`);
}

console.log('================================================================================');
console.log('✨ 所有脚本生成完成!\n');
console.log('下一步:');
console.log('  bash scripts/launch-strategy-group-backtest.sh');
console.log('');
