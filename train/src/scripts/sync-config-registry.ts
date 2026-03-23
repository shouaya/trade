import db from '../configs/database';
import { ensureTrainConfigRegistryTable, syncTrainConfigsFromDisk } from '../services/train-config-registry';

async function main(): Promise<void> {
  try {
    console.log('📚 开始同步 train JSON 配置到数据库...');
    await ensureTrainConfigRegistryTable(db);
    const result = await syncTrainConfigsFromDisk(db);
    console.log(`✅ 同步完成: scanned=${result.scanned}, synced=${result.synced}`);
    await db.end();
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    console.error('❌ 配置同步失败:', message);
    console.error(stack);
    await db.end();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { main };
