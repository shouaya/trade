/**
 * Walk-Forward Validator - 前推验证框架
 *
 * 功能:
 * 1. 滚动时间窗口回测
 * 2. 训练集/测试集分离
 * 3. 避免过拟合
 * 4. 评估策略稳健性
 *
 * 方法:
 * - 将历史数据分为多个时间段
 * - 在训练期优化参数
 * - 在测试期验证性能
 * - 滚动前推,重复上述过程
 *
 * 使用方式:
 * const validator = new WalkForwardValidator(strategy, klines, {
 *   trainingMonths: 6,
 *   testingMonths: 1,
 *   totalPeriods: 12
 * });
 */

class WalkForwardValidator {
  constructor(strategy, klines, options = {}) {
    this.strategy = strategy;
    this.klines = klines;

    // 配置
    this.trainingMonths = options.trainingMonths || 6;   // 训练期长度(月)
    this.testingMonths = options.testingMonths || 1;     // 测试期长度(月)
    this.stepMonths = options.stepMonths || 1;           // 滚动步长(月)
    this.totalPeriods = options.totalPeriods || null;    // 总周期数(null=全部)

    this.results = [];
  }

  /**
   * 将K线数据按月份分段
   * @returns {Array} - 每月的K线数组
   */
  segmentByMonth() {
    const segments = {};

    this.klines.forEach(kline => {
      const date = new Date(kline.open_time);
      const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

      if (!segments[monthKey]) {
        segments[monthKey] = [];
      }
      segments[monthKey].push(kline);
    });

    // 转换为按时间排序的数组
    const sortedKeys = Object.keys(segments).sort();
    return sortedKeys.map(key => ({
      month: key,
      klines: segments[key]
    }));
  }

  /**
   * 执行Walk-Forward验证
   * @param {Object} StrategyExecutor - 策略执行器类
   * @returns {Object} - 验证结果
   */
  async validate(StrategyExecutor) {
    console.log('开始Walk-Forward验证...');
    console.log(`  训练期: ${this.trainingMonths}个月`);
    console.log(`  测试期: ${this.testingMonths}个月`);
    console.log(`  滚动步长: ${this.stepMonths}个月\n`);

    const monthlySegments = this.segmentByMonth();
    console.log(`总共 ${monthlySegments.length} 个月的数据\n`);

    let periodIndex = 0;
    let currentStartIdx = 0;

    while (true) {
      // 确定训练期和测试期的索引范围
      const trainingEndIdx = currentStartIdx + this.trainingMonths;
      const testingEndIdx = trainingEndIdx + this.testingMonths;

      // 检查是否有足够的数据
      if (testingEndIdx > monthlySegments.length) {
        console.log('数据不足,停止验证');
        break;
      }

      // 检查是否达到总周期数限制
      if (this.totalPeriods && periodIndex >= this.totalPeriods) {
        console.log('达到总周期数限制,停止验证');
        break;
      }

      periodIndex++;

      // 提取训练期和测试期数据
      const trainingSegments = monthlySegments.slice(currentStartIdx, trainingEndIdx);
      const testingSegments = monthlySegments.slice(trainingEndIdx, testingEndIdx);

      const trainingKlines = trainingSegments.flatMap(s => s.klines);
      const testingKlines = testingSegments.flatMap(s => s.klines);

      console.log(`=== 周期 ${periodIndex} ===`);
      console.log(`  训练期: ${trainingSegments[0].month} - ${trainingSegments[trainingSegments.length - 1].month}`);
      console.log(`  测试期: ${testingSegments[0].month} - ${testingSegments[testingSegments.length - 1].month}`);
      console.log(`  训练集K线数: ${trainingKlines.length}`);
      console.log(`  测试集K线数: ${testingKlines.length}`);

      // 在训练期回测
      console.log('  训练中...');
      const trainingExecutor = new StrategyExecutor(this.strategy, trainingKlines);
      const trainingResult = await trainingExecutor.execute();

      console.log(`    训练集表现: ${trainingResult.stats.totalTrades}笔, $${trainingResult.stats.totalPnl.toFixed(2)}, 胜率${(trainingResult.stats.winRate * 100).toFixed(2)}%`);

      // 在测试期验证
      console.log('  测试中...');
      const testingExecutor = new StrategyExecutor(this.strategy, testingKlines);
      const testingResult = await testingExecutor.execute();

      console.log(`    测试集表现: ${testingResult.stats.totalTrades}笔, $${testingResult.stats.totalPnl.toFixed(2)}, 胜率${(testingResult.stats.winRate * 100).toFixed(2)}%`);

      // 记录结果
      this.results.push({
        period: periodIndex,
        trainingPeriod: {
          start: trainingSegments[0].month,
          end: trainingSegments[trainingSegments.length - 1].month,
          klines: trainingKlines.length
        },
        testingPeriod: {
          start: testingSegments[0].month,
          end: testingSegments[testingSegments.length - 1].month,
          klines: testingKlines.length
        },
        trainingStats: trainingResult.stats,
        testingStats: testingResult.stats,
        degradation: this.calculateDegradation(trainingResult.stats, testingResult.stats)
      });

      console.log('');

      // 滚动到下一个窗口
      currentStartIdx += this.stepMonths;
    }

    return this.generateReport();
  }

  /**
   * 计算性能衰减指标
   * @param {Object} trainingStats - 训练集统计
   * @param {Object} testingStats - 测试集统计
   * @returns {Object} - 衰减指标
   */
  calculateDegradation(trainingStats, testingStats) {
    const pnlDegradation = trainingStats.totalPnl !== 0
      ? ((testingStats.totalPnl - trainingStats.totalPnl) / Math.abs(trainingStats.totalPnl)) * 100
      : 0;

    const winRateDegradation = (testingStats.winRate - trainingStats.winRate) * 100;

    const sharpeDegradation = trainingStats.sharpeRatio !== 0
      ? ((testingStats.sharpeRatio - trainingStats.sharpeRatio) / Math.abs(trainingStats.sharpeRatio)) * 100
      : 0;

    return {
      pnlDegradation,
      winRateDegradation,
      sharpeDegradation
    };
  }

  /**
   * 生成Walk-Forward验证报告
   * @returns {Object} - 验证报告
   */
  generateReport() {
    const totalPeriods = this.results.length;

    // 聚合训练集和测试集统计
    let totalTrainingPnl = 0;
    let totalTestingPnl = 0;
    let totalTrainingTrades = 0;
    let totalTestingTrades = 0;
    let totalTrainingWins = 0;
    let totalTestingWins = 0;

    const pnlDegradations = [];
    const winRateDegradations = [];
    const sharpeDegradations = [];

    this.results.forEach(result => {
      totalTrainingPnl += result.trainingStats.totalPnl;
      totalTestingPnl += result.testingStats.totalPnl;
      totalTrainingTrades += result.trainingStats.totalTrades;
      totalTestingTrades += result.testingStats.totalTrades;
      totalTrainingWins += result.trainingStats.totalTrades * result.trainingStats.winRate;
      totalTestingWins += result.testingStats.totalTrades * result.testingStats.winRate;

      pnlDegradations.push(result.degradation.pnlDegradation);
      winRateDegradations.push(result.degradation.winRateDegradation);
      sharpeDegradations.push(result.degradation.sharpeDegradation);
    });

    const avgTrainingWinRate = totalTrainingTrades > 0 ? totalTrainingWins / totalTrainingTrades : 0;
    const avgTestingWinRate = totalTestingTrades > 0 ? totalTestingWins / totalTestingTrades : 0;

    const avgPnlDegradation = pnlDegradations.reduce((a, b) => a + b, 0) / totalPeriods;
    const avgWinRateDegradation = winRateDegradations.reduce((a, b) => a + b, 0) / totalPeriods;
    const avgSharpeDegradation = sharpeDegradations.reduce((a, b) => a + b, 0) / totalPeriods;

    // 计算一致性 (测试期盈利的比例)
    const profitablePeriods = this.results.filter(r => r.testingStats.totalPnl > 0).length;
    const consistency = (profitablePeriods / totalPeriods) * 100;

    // 评估稳健性
    const robustness = this.evaluateRobustness({
      avgPnlDegradation,
      avgWinRateDegradation,
      consistency
    });

    return {
      summary: {
        totalPeriods,
        trainingPeriodLength: `${this.trainingMonths} 个月`,
        testingPeriodLength: `${this.testingMonths} 个月`,
        stepLength: `${this.stepMonths} 个月`
      },
      aggregated: {
        training: {
          totalPnl: totalTrainingPnl,
          totalTrades: totalTrainingTrades,
          winRate: avgTrainingWinRate
        },
        testing: {
          totalPnl: totalTestingPnl,
          totalTrades: totalTestingTrades,
          winRate: avgTestingWinRate
        }
      },
      degradation: {
        avgPnlDegradation,
        avgWinRateDegradation,
        avgSharpeDegradation
      },
      consistency: {
        profitablePeriods,
        totalPeriods,
        percentage: consistency
      },
      robustness,
      periods: this.results
    };
  }

  /**
   * 评估策略稳健性
   * @param {Object} metrics - 评估指标
   * @returns {Object} - 稳健性评估
   */
  evaluateRobustness(metrics) {
    let score = 0;
    const reasons = [];

    // 1. PnL衰减评估 (权重: 40%)
    if (metrics.avgPnlDegradation >= -10) {
      score += 40;
      reasons.push('✅ PnL衰减在可接受范围 (≥-10%)');
    } else if (metrics.avgPnlDegradation >= -30) {
      score += 20;
      reasons.push('⚠️  PnL衰减较大 (-30%到-10%)');
    } else {
      reasons.push('❌ PnL衰减严重 (<-30%)');
    }

    // 2. 胜率衰减评估 (权重: 30%)
    if (Math.abs(metrics.avgWinRateDegradation) <= 5) {
      score += 30;
      reasons.push('✅ 胜率稳定 (变化≤5%)');
    } else if (Math.abs(metrics.avgWinRateDegradation) <= 10) {
      score += 15;
      reasons.push('⚠️  胜率有波动 (变化5-10%)');
    } else {
      reasons.push('❌ 胜率不稳定 (变化>10%)');
    }

    // 3. 一致性评估 (权重: 30%)
    if (metrics.consistency >= 70) {
      score += 30;
      reasons.push('✅ 高一致性 (≥70%周期盈利)');
    } else if (metrics.consistency >= 50) {
      score += 15;
      reasons.push('⚠️  中等一致性 (50-70%周期盈利)');
    } else {
      reasons.push('❌ 低一致性 (<50%周期盈利)');
    }

    let rating;
    if (score >= 80) {
      rating = '优秀 (Excellent)';
    } else if (score >= 60) {
      rating = '良好 (Good)';
    } else if (score >= 40) {
      rating = '一般 (Fair)';
    } else {
      rating = '较差 (Poor)';
    }

    return {
      score,
      rating,
      reasons
    };
  }
}

module.exports = WalkForwardValidator;
