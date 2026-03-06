#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const CORE_SNAPSHOTS = [
  'configs/top-strategies/2024_v3_atr_top3.snapshot.json',
  'configs/top-strategies/2025_v3_atr_top3.snapshot.json'
] as const;

const ROLLING_SNAPSHOTS = [
  'configs/top-strategies/2025_01_rolling_top3.snapshot.json',
  'configs/top-strategies/2025_02_rolling_top3.snapshot.json',
  'configs/top-strategies/2025_03_rolling_top3.snapshot.json',
  'configs/top-strategies/2025_04_rolling_top3.snapshot.json',
  'configs/top-strategies/2025_05_rolling_top3.snapshot.json',
  'configs/top-strategies/2025_06_rolling_top3.snapshot.json',
  'configs/top-strategies/2025_07_rolling_top3.snapshot.json',
  'configs/top-strategies/2025_08_rolling_top3.snapshot.json',
  'configs/top-strategies/2025_09_rolling_top3.snapshot.json',
  'configs/top-strategies/2025_10_rolling_top3.snapshot.json',
  'configs/top-strategies/2025_11_rolling_top3.snapshot.json',
  'configs/top-strategies/2025_12_rolling_top3.snapshot.json',
  'configs/top-strategies/2026_01_rolling_top3.snapshot.json',
  'configs/top-strategies/2026_02_rolling_top3.snapshot.json'
] as const;

type SuiteName = 'all' | 'core' | 'rolling';

function parseArgs(argv: readonly string[]): { readonly update: boolean; readonly suite: SuiteName } {
  const args = argv.slice(2);
  const suiteIndex = args.findIndex(arg => arg === '--suite');
  const suiteValue = suiteIndex >= 0 ? args[suiteIndex + 1] : 'all';

  if (suiteValue !== 'all' && suiteValue !== 'core' && suiteValue !== 'rolling') {
    throw new Error(`unknown suite: ${String(suiteValue)}`);
  }

  return {
    update: args.includes('--update'),
    suite: suiteValue
  };
}

function getSnapshots(suite: SuiteName): readonly string[] {
  if (suite === 'core') {
    return CORE_SNAPSHOTS;
  }

  if (suite === 'rolling') {
    return ROLLING_SNAPSHOTS;
  }

  return [...CORE_SNAPSHOTS, ...ROLLING_SNAPSHOTS];
}

function main(): void {
  const { update, suite } = parseArgs(process.argv);
  const snapshots = getSnapshots(suite);

  for (const snapshotPath of snapshots) {
    const scriptPath = path.resolve(__dirname, 'training-regression.js');
    const childArgs = [scriptPath, snapshotPath];
    if (update) {
      childArgs.push('--update');
    }

    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`回归用例: ${snapshotPath}`);
    console.log(`模式: ${update ? 'update' : 'verify'}`);
    console.log(`════════════════════════════════════════════════════════════\n`);

    const result = spawnSync(process.execPath, childArgs, {
      stdio: 'inherit'
    });

    if (result.status !== 0) {
      throw new Error(`regression suite failed on ${snapshotPath} with exit code ${result.status ?? 'unknown'}`);
    }
  }

  console.log(`\n✅ 回归套件完成，suite=${suite}，共 ${snapshots.length} 个用例`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ 回归套件失败: ${message}`);
  process.exit(1);
}
