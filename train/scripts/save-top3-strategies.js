/**
 * 保存Top 3策略到strategies表
 * 这些策略已经在2024、2025、2026年验证通过
 */

const db = require('../config/database');

const TOP_3_STRATEGIES = [
  {
    name: 'TOP1-RSI-P14-OS25-OB70-MP1-H60-NoSLTP',
    description: '2025年综合第一名 - RSI无止损止盈版本。2025: 3596次交易/51.42%胜率/$37.55盈利; 2024: 3231次/50.20%/$21.11; 2026(1-2月): 1035次/49.08%/$3.71',
    parameters: JSON.stringify({
      grid: { enabled: false },
      rsi: { enabled: true, period: 14, oversold: 25, overbought: 70 },
      macd: { enabled: false },
      risk: {
        maxPositions: 1,
        lotSize: 0.1,
        stopLossPercent: null,
        takeProfitPercent: null,
        maxHoldMinutes: 60
      }
    }),
    type: 'rsi_only'
  },
  {
    name: 'TOP2-RSI-P14-OS25-OB70-MP1-H60-SL0.3-TP1.5',
    description: '2025年第二名 - RSI带止损止盈(1:5风险回报)。2025: 3656次交易/51.23%胜率/$37.69盈利; 2024: 3312次/49.82%/$14.15; 2026(1-2月): 1042次/48.75%/$1.66',
    parameters: JSON.stringify({
      grid: { enabled: false },
      rsi: { enabled: true, period: 14, oversold: 25, overbought: 70 },
      macd: { enabled: false },
      risk: {
        maxPositions: 1,
        lotSize: 0.1,
        stopLossPercent: 0.3,
        takeProfitPercent: 1.5,
        maxHoldMinutes: 60
      }
    }),
    type: 'rsi_only'
  },
  {
    name: 'TOP3-RSI-P14-OS30-OB70-MP1-H30-SL0.3-TP0.2',
    description: '2025年第三名 - RSI高频交易版本(30分钟持仓)。2025: 6318次交易/50.06%胜率/$35.71盈利; 2024: 5706次/49.39%/$7.19; 2026(1-2月): 1794次/50.11%/$19.13',
    parameters: JSON.stringify({
      grid: { enabled: false },
      rsi: { enabled: true, period: 14, oversold: 30, overbought: 70 },
      macd: { enabled: false },
      risk: {
        maxPositions: 1,
        lotSize: 0.1,
        stopLossPercent: 0.3,
        takeProfitPercent: 0.2,
        maxHoldMinutes: 30
      }
    }),
    type: 'rsi_only'
  }
];

async function main() {
  console.log('='.repeat(80));
  console.log('💾 保存Top 3策略到strategies表');
  console.log('='.repeat(80));
  console.log('');

  try {
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

    for (let i = 0; i < TOP_3_STRATEGIES.length; i++) {
      const strategy = TOP_3_STRATEGIES[i];

      await db.query(`
        INSERT INTO strategies (name, description, parameters, type)
        VALUES (?, ?, ?, ?)
      `, [strategy.name, strategy.description, strategy.parameters, strategy.type]);

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


