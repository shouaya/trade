#!/usr/bin/env node

const { clearKlineData } = require('../lib/kline-importer');

function parseArgs(argv) {
  const args = {};

  for (const rawArg of argv.slice(2)) {
    const arg = String(rawArg).trim();
    if (!arg) continue;

    const normalized = arg.startsWith('--') ? arg.slice(2) : arg;
    const separatorIndex = normalized.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    const value = normalized.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    args[key] = value;
  }

  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const result = await clearKlineData(args);

    console.log('✅ 清除完成');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(`❌ 清除失败: ${error.message}`);
    process.exit(1);
  }
}

void main();
