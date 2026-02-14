/**
 * 播放控制功能测试
 * 测试输入：UI 参数（symbol, interval, speed）
 * 测试操作：调用业务代码的播放事件
 * 测试职责：只记录开始时间、K 线输出、最后计算经过时间和数量
 */

import { loadKlineData, startPlayback } from '../src/services/playbackService.js';

console.log('🧪 播放控制测试\n');

// 输入：UI 参数
const uiParams = {
  symbol: 'USDJPY',
  interval: '1m',
  speed: 500,  // 1 秒 1 根 K 线
  limit: 10,     // 只加载 10 根 K 线
};

console.log('📝 输入参数（UI）:');
console.log(`  交易对: ${uiParams.symbol}`);
console.log(`  时间周期: ${uiParams.interval}`);
console.log(`  播放速度: ${uiParams.speed}ms\n`);

// 运行测试
async function runTest() {
  try {
    // 1. 调用业务代码：加载数据
    console.log('📡 调用业务代码：加载 K 线数据...\n');
    const klineData = await loadKlineData(uiParams);
    console.log(`✅ 加载成功: ${klineData.length} 根 K 线\n`);

    // 测试记录
    const outputLog = [];
    const startTime = Date.now();

    // 2. 调用业务代码：播放事件
    console.log('▶️  调用播放事件\n');
    console.log('📊 K 线输出:\n');

    startPlayback({
      klineData,
      speed: uiParams.speed,
      onUpdate: (index, kline) => {
        // 只记录输出
        outputLog.push({ index, kline, timestamp: Date.now() });
        console.log(JSON.stringify({
          index,
          openTime: kline.openTime,
          open: kline.open,
          close: kline.close,
        }));
      },
      onComplete: () => {
        // 播放完成后计算结果
        const endTime = Date.now();
        const totalTime = endTime - startTime;

        console.log('\n📊 测试结果:\n');
        console.log(`  K 线数量: ${outputLog.length} 根`);
        console.log(`  总耗时: ${totalTime}ms`);

        // 计算平均间隔（使用相邻 K 线之间的时间差）
        let avgInterval = 0;
        if (outputLog.length >= 2) {
          const intervals = [];
          for (let i = 1; i < outputLog.length; i++) {
            intervals.push(outputLog[i].timestamp - outputLog[i - 1].timestamp);
          }
          avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          console.log(`  平均间隔: ${avgInterval.toFixed(0)}ms`);
        }

        console.log('\n📊 验证结果:\n');

        // 验证 1: K 线数量
        const expectedCount = 10;
        if (outputLog.length === expectedCount) {
          console.log(`  ✅ 数量验证: ${outputLog.length} 根 = ${expectedCount} 根`);
        } else {
          console.log(`  ❌ 数量验证: ${outputLog.length} 根 ≠ ${expectedCount} 根`);
        }

        // 验证 2: 播放速度参数
        const tolerance = 100;
        const speedDiff = Math.abs(avgInterval - uiParams.speed);
        if (speedDiff <= tolerance) {
          console.log(`  ✅ 速度验证: ${avgInterval.toFixed(0)}ms ≈ ${uiParams.speed}ms (误差 ${speedDiff.toFixed(0)}ms)`);
        } else {
          console.log(`  ❌ 速度验证: ${avgInterval.toFixed(0)}ms ≠ ${uiParams.speed}ms (误差 ${speedDiff.toFixed(0)}ms)`);
        }

        // 总结
        if (outputLog.length === expectedCount && speedDiff <= tolerance) {
          console.log('\n✅ 测试通过');
          process.exit(0);
        } else {
          console.log('\n❌ 测试失败');
          process.exit(1);
        }
      }
    });
  } catch (error) {
    console.log(`\n❌ 测试失败: ${error.message}\n`);
    process.exit(1);
  }
}

runTest();
