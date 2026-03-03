/**
 * Bucketed Analysis - 分桶统计分析工具
 *
 * 功能:
 * 1. 按时段分析 (小时/星期/月份)
 * 2. 按市场条件分析 (波动率/趋势强度)
 * 3. 按持仓时长分析
 * 4. 按RSI区间分析
 * 5. 识别最佳和最差交易时段
 *
 * 用途:
 * - 发现策略在特定条件下的表现
 * - 优化交易时间表
 * - 识别需要改进的场景
 */

class BucketedAnalysis {
  constructor(trades) {
    this.trades = trades;
  }

  /**
   * 按时段分桶分析
   * @param {string} period - 'hour' / 'day_of_week' / 'month'
   * @returns {Object} - 分桶结果
   */
  analyzeByTimePeriod(period = 'hour') {
    const buckets = {};

    this.trades.forEach(trade => {
      const entryDate = new Date(trade.entry_time);
      let key;

      switch (period) {
        case 'hour':
          key = entryDate.getUTCHours();
          break;
        case 'day_of_week':
          key = entryDate.getUTCDay(); // 0=周日
          break;
        case 'month':
          key = entryDate.getUTCMonth() + 1; // 1-12
          break;
        default:
          key = entryDate.getUTCHours();
      }

      if (!buckets[key]) {
        buckets[key] = {
          trades: [],
          count: 0,
          totalPnl: 0,
          wins: 0,
          losses: 0
        };
      }

      buckets[key].trades.push(trade);
      buckets[key].count++;
      buckets[key].totalPnl += trade.pnl;
      if (trade.pnl > 0) {
        buckets[key].wins++;
      } else if (trade.pnl < 0) {
        buckets[key].losses++;
      }
    });

    // 计算每个桶的统计数据
    const result = {};
    Object.entries(buckets).forEach(([key, bucket]) => {
      result[key] = {
        count: bucket.count,
        totalPnl: bucket.totalPnl,
        avgPnl: bucket.totalPnl / bucket.count,
        winRate: bucket.wins / bucket.count,
        wins: bucket.wins,
        losses: bucket.losses
      };
    });

    return this.sortAndRank(result);
  }

  /**
   * 按波动率分桶分析
   * @param {number} numBuckets - 桶数量
   * @returns {Object} - 分桶结果
   */
  analyzeByVolatility(numBuckets = 5) {
    // 计算每笔交易的隐含波动率 (用价格范围代理)
    const tradesWithVol = this.trades.map(trade => {
      // 简化计算: 使用入场价格的变化率作为波动率代理
      const volatility = Math.abs(trade.exit_price - trade.entry_price) / trade.entry_price;
      return { ...trade, volatility };
    });

    // 按波动率排序
    tradesWithVol.sort((a, b) => a.volatility - b.volatility);

    // 分桶
    const bucketSize = Math.ceil(tradesWithVol.length / numBuckets);
    const buckets = {};

    for (let i = 0; i < numBuckets; i++) {
      const start = i * bucketSize;
      const end = Math.min(start + bucketSize, tradesWithVol.length);
      const bucketTrades = tradesWithVol.slice(start, end);

      if (bucketTrades.length === 0) continue;

      const minVol = bucketTrades[0].volatility;
      const maxVol = bucketTrades[bucketTrades.length - 1].volatility;
      const label = `${(minVol * 100).toFixed(2)}%-${(maxVol * 100).toFixed(2)}%`;

      buckets[label] = this.calculateBucketStats(bucketTrades);
    }

    return buckets;
  }

  /**
   * 按持仓时长分桶分析
   * @param {Array} timeRanges - 时间范围 (分钟) e.g. [0, 15, 30, 60]
   * @returns {Object} - 分桶结果
   */
  analyzeByHoldTime(timeRanges = [0, 15, 30, 60, Infinity]) {
    const buckets = {};

    // 初始化桶
    for (let i = 0; i < timeRanges.length - 1; i++) {
      const label = timeRanges[i + 1] === Infinity
        ? `${timeRanges[i]}+ min`
        : `${timeRanges[i]}-${timeRanges[i + 1]} min`;
      buckets[label] = [];
    }

    // 分配交易到桶
    this.trades.forEach(trade => {
      const holdMinutes = trade.hold_minutes;

      for (let i = 0; i < timeRanges.length - 1; i++) {
        if (holdMinutes >= timeRanges[i] && holdMinutes < timeRanges[i + 1]) {
          const label = timeRanges[i + 1] === Infinity
            ? `${timeRanges[i]}+ min`
            : `${timeRanges[i]}-${timeRanges[i + 1]} min`;
          buckets[label].push(trade);
          break;
        }
      }
    });

    // 计算统计
    const result = {};
    Object.entries(buckets).forEach(([label, trades]) => {
      if (trades.length > 0) {
        result[label] = this.calculateBucketStats(trades);
      }
    });

    return result;
  }

  /**
   * 按RSI区间分桶分析
   * @param {Array} rsiRanges - RSI范围 e.g. [0, 20, 30, 50, 70, 80, 100]
   * @returns {Object} - 分桶结果
   */
  analyzeByRSI(rsiRanges = [0, 20, 30, 50, 70, 80, 100]) {
    const buckets = {};

    // 初始化桶
    for (let i = 0; i < rsiRanges.length - 1; i++) {
      const label = `RSI ${rsiRanges[i]}-${rsiRanges[i + 1]}`;
      buckets[label] = [];
    }

    // 分配交易到桶
    this.trades.forEach(trade => {
      const rsi = trade.entry_rsi;
      if (!rsi) return;

      for (let i = 0; i < rsiRanges.length - 1; i++) {
        if (rsi >= rsiRanges[i] && rsi < rsiRanges[i + 1]) {
          const label = `RSI ${rsiRanges[i]}-${rsiRanges[i + 1]}`;
          buckets[label].push(trade);
          break;
        }
      }
    });

    // 计算统计
    const result = {};
    Object.entries(buckets).forEach(([label, trades]) => {
      if (trades.length > 0) {
        result[label] = this.calculateBucketStats(trades);
      }
    });

    return result;
  }

  /**
   * 按退出原因分桶分析
   * @returns {Object} - 分桶结果
   */
  analyzeByExitReason() {
    const buckets = {};

    this.trades.forEach(trade => {
      const reason = trade.exit_reason;

      if (!buckets[reason]) {
        buckets[reason] = [];
      }

      buckets[reason].push(trade);
    });

    // 计算统计
    const result = {};
    Object.entries(buckets).forEach(([reason, trades]) => {
      result[reason] = this.calculateBucketStats(trades);
    });

    return this.sortAndRank(result);
  }

  /**
   * 按交易方向分桶分析
   * @returns {Object} - 分桶结果
   */
  analyzeByDirection() {
    const buckets = {
      long: [],
      short: []
    };

    this.trades.forEach(trade => {
      buckets[trade.direction].push(trade);
    });

    return {
      long: this.calculateBucketStats(buckets.long),
      short: this.calculateBucketStats(buckets.short)
    };
  }

  /**
   * 计算桶的统计数据
   * @param {Array} trades - 交易列表
   * @returns {Object} - 统计数据
   */
  calculateBucketStats(trades) {
    if (trades.length === 0) {
      return {
        count: 0,
        totalPnl: 0,
        avgPnl: 0,
        winRate: 0,
        wins: 0,
        losses: 0,
        maxWin: 0,
        maxLoss: 0,
        avgHoldTime: 0
      };
    }

    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const wins = trades.filter(t => t.pnl > 0).length;
    const losses = trades.filter(t => t.pnl < 0).length;
    const winRate = wins / trades.length;

    const winTrades = trades.filter(t => t.pnl > 0);
    const lossTrades = trades.filter(t => t.pnl < 0);

    const maxWin = winTrades.length > 0 ? Math.max(...winTrades.map(t => t.pnl)) : 0;
    const maxLoss = lossTrades.length > 0 ? Math.min(...lossTrades.map(t => t.pnl)) : 0;

    const avgHoldTime = trades.reduce((sum, t) => sum + (t.hold_minutes || 0), 0) / trades.length;

    return {
      count: trades.length,
      totalPnl,
      avgPnl: totalPnl / trades.length,
      winRate,
      wins,
      losses,
      maxWin,
      maxLoss,
      avgHoldTime
    };
  }

  /**
   * 排序并排名
   * @param {Object} buckets - 桶数据
   * @returns {Object} - 排序后的结果
   */
  sortAndRank(buckets) {
    // 按总盈亏排序
    const sorted = Object.entries(buckets)
      .sort((a, b) => b[1].totalPnl - a[1].totalPnl)
      .map(([key, stats], index) => ({
        key,
        rank: index + 1,
        ...stats
      }));

    return {
      buckets: sorted,
      best: sorted[0],
      worst: sorted[sorted.length - 1]
    };
  }

  /**
   * 生成完整分析报告
   * @returns {Object} - 完整报告
   */
  generateFullReport() {
    return {
      overview: {
        totalTrades: this.trades.length,
        totalPnl: this.trades.reduce((sum, t) => sum + t.pnl, 0),
        avgPnl: this.trades.reduce((sum, t) => sum + t.pnl, 0) / this.trades.length,
        winRate: this.trades.filter(t => t.pnl > 0).length / this.trades.length
      },
      byHour: this.analyzeByTimePeriod('hour'),
      byDayOfWeek: this.analyzeByTimePeriod('day_of_week'),
      byMonth: this.analyzeByTimePeriod('month'),
      byHoldTime: this.analyzeByHoldTime(),
      byRSI: this.analyzeByRSI(),
      byExitReason: this.analyzeByExitReason(),
      byDirection: this.analyzeByDirection(),
      byVolatility: this.analyzeByVolatility()
    };
  }

  /**
   * 识别最佳交易时段
   * @returns {Array} - 最佳时段建议
   */
  identifyBestTradingPeriods() {
    const recommendations = [];

    // 1. 按小时分析
    const hourlyAnalysis = this.analyzeByTimePeriod('hour');
    const profitableHours = hourlyAnalysis.buckets
      .filter(b => b.totalPnl > 0 && b.winRate > 0.5)
      .map(b => parseInt(b.key));

    if (profitableHours.length > 0) {
      recommendations.push({
        type: 'hour',
        suggestion: `最佳交易时段: UTC ${profitableHours.join(', ')} 时`,
        hours: profitableHours,
        avgPnl: hourlyAnalysis.buckets
          .filter(b => profitableHours.includes(parseInt(b.key)))
          .reduce((sum, b) => sum + b.avgPnl, 0) / profitableHours.length
      });
    }

    // 2. 按星期分析
    const dowAnalysis = this.analyzeByTimePeriod('day_of_week');
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const profitableDays = dowAnalysis.buckets
      .filter(b => b.totalPnl > 0 && b.winRate > 0.5)
      .map(b => ({ day: parseInt(b.key), name: dayNames[parseInt(b.key)] }));

    if (profitableDays.length > 0) {
      recommendations.push({
        type: 'day_of_week',
        suggestion: `最佳交易日: ${profitableDays.map(d => d.name).join(', ')}`,
        days: profitableDays
      });
    }

    // 3. 按RSI分析
    const rsiAnalysis = this.analyzeByRSI();
    const bestRSIRanges = Object.entries(rsiAnalysis)
      .filter(([_, stats]) => stats.winRate > 0.6)
      .map(([range, stats]) => ({ range, stats }));

    if (bestRSIRanges.length > 0) {
      recommendations.push({
        type: 'rsi',
        suggestion: `最佳RSI区间: ${bestRSIRanges.map(r => r.range).join(', ')}`,
        ranges: bestRSIRanges
      });
    }

    return recommendations;
  }

  /**
   * 识别需要改进的场景
   * @returns {Array} - 改进建议
   */
  identifyImprovementAreas() {
    const issues = [];

    // 1. 识别最差时段
    const hourlyAnalysis = this.analyzeByTimePeriod('hour');
    const worstHours = hourlyAnalysis.buckets
      .filter(b => b.totalPnl < 0 || b.winRate < 0.4)
      .map(b => parseInt(b.key));

    if (worstHours.length > 0) {
      issues.push({
        severity: 'high',
        type: 'hour',
        issue: `建议避免交易时段: UTC ${worstHours.join(', ')} 时`,
        hours: worstHours,
        avgLoss: hourlyAnalysis.buckets
          .filter(b => worstHours.includes(parseInt(b.key)))
          .reduce((sum, b) => sum + b.avgPnl, 0) / worstHours.length
      });
    }

    // 2. 识别问题退出原因
    const exitReasonAnalysis = this.analyzeByExitReason();
    const problematicReasons = exitReasonAnalysis.buckets
      .filter(b => b.totalPnl < 0 && b.count > 5)
      .map(b => b.key);

    if (problematicReasons.length > 0) {
      issues.push({
        severity: 'medium',
        type: 'exit_reason',
        issue: `需要优化的退出原因: ${problematicReasons.join(', ')}`,
        reasons: problematicReasons
      });
    }

    // 3. 识别方向偏差
    const directionAnalysis = this.analyzeByDirection();
    if (directionAnalysis.long.winRate < 0.4 || directionAnalysis.short.winRate < 0.4) {
      issues.push({
        severity: 'high',
        type: 'direction',
        issue: '交易方向表现不平衡',
        details: {
          long: { winRate: directionAnalysis.long.winRate, pnl: directionAnalysis.long.totalPnl },
          short: { winRate: directionAnalysis.short.winRate, pnl: directionAnalysis.short.totalPnl }
        }
      });
    }

    return issues;
  }
}

module.exports = BucketedAnalysis;
