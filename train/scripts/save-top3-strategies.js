/**
 * 保存Top 3策略到strategies表
 */

const db = require('../config/database');
const { loadNamedConfig } = require('./_config');

async function main() {
  console.log('='.repeat(80));
  console.log('💾 保存Top 3策略到strategies表');
  console.log('='.repeat(80));
  console.log('');

  try {
    const topStrategies = loadNamedConfig('top-strategies', 'persist-top3');

    // 1. 检查strategies表是否存在
    const [tables] = await db.query(`SHOW TABLES LIKE 'strategies'`);

    if (tables.length === 0) {
      console.log('创建strategies表...');
      await db.query(`
        CREATE TABLE strategies (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          description TEXT,
          parameters JSON NOT NULL,
          type VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ strategies表创建成功\n');
    }

    // 2. 删除旧的Top策略(如果存在)
    console.log('清理旧的Top策略记录...');
    await db.query(`DELETE FROM strategies WHERE name LIKE 'TOP%'`);
    console.log('✅ 清理完成\n');

    // 3. 插入新的Top 3策略
    console.log('插入Top 3策略:\n');

    for (let i = 0; i < topStrategies.length; i++) {
      const strategy = topStrategies[i];

      await db.query(`
        INSERT INTO strategies (name, description, parameters, type)
        VALUES (?, ?, ?, ?)
      `, [strategy.name, strategy.description, JSON.stringify(strategy.parameters), strategy.type]);

      console.log(`${i + 1}. ${strategy.name}`);
      console.log(`   类型: ${strategy.type}`);
      console.log(`   描述: ${strategy.description}`);
      console.log('');
    }

    // 4. 验证插入结果
    const [result] = await db.query(`
      SELECT id, name, type, created_at
      FROM strategies
      WHERE name LIKE 'TOP%'
      ORDER BY name
    `);

    console.log('='.repeat(80));
    console.log('✅ 策略保存成功! 共', result.length, '条记录\n');

    result.forEach(row => {
      console.log(`  ID: ${row.id} | ${row.name} | ${row.type}`);
    });

    console.log('\n='.repeat(80));
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 保存失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

main();


