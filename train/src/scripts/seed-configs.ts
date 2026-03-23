import * as fs from 'fs';
import * as path from 'path';
import db from '../configs/database';
import { ensureTrainConfigRegistryTable, upsertTrainConfigFromFile } from '../services/train-config-registry';

const TRAIN_ROOT = path.resolve(__dirname, '..', '..');
const CONFIGS_ROOT = path.join(TRAIN_ROOT, 'configs');

function parseArgs(argv: readonly string[]): { readonly includeGenerated: boolean } {
  return {
    includeGenerated: argv.includes('--include-generated')
  };
}

function listJsonFiles(dirPath: string): readonly string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.json')) {
      files.push(fullPath);
    }
  }

  return files;
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function toConfigKey(filePath: string): string {
  return toPosix(path.relative(TRAIN_ROOT, filePath));
}

function shouldSeedConfig(configKey: string, includeGenerated: boolean): boolean {
  if (configKey.startsWith('configs/training/')) {
    return true;
  }

  if (configKey === 'configs/periods/default.json') {
    return true;
  }

  if (!includeGenerated) {
    return false;
  }

  return configKey.startsWith('configs/validation/')
    || configKey.startsWith('configs/top-strategies/')
    || configKey.startsWith('configs/generated/');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  try {
    console.log('🌱 开始导入 seed 配置到 train_configs...');
    console.log(`📁 configs root: ${CONFIGS_ROOT}`);
    console.log(`🧹 include generated: ${args.includeGenerated ? 'yes' : 'no'}`);
    await ensureTrainConfigRegistryTable(db);

    const files = listJsonFiles(CONFIGS_ROOT)
      .filter((filePath) => shouldSeedConfig(toConfigKey(filePath), args.includeGenerated))
      .sort();

    let imported = 0;
    for (const filePath of files) {
      await upsertTrainConfigFromFile(db, filePath);
      imported += 1;
      console.log(`  - imported ${toConfigKey(filePath)}`);
    }

    console.log(`✅ seed 导入完成: imported=${imported}`);
    console.log('ℹ️  默认只导入 training / 基础配置；如需连 validation/top-strategies 一起导入，请追加 --include-generated。');
    await db.end();
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    console.error('❌ 导入 seed 配置失败:', message);
    console.error(stack);
    await db.end();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { main };
