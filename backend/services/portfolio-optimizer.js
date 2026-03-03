/**
 * Portfolio Optimizer - 组合策略权重优化器
 *
 * 功能:
 * 1. Kelly公式计算最优仓位
 * 2. 多策略权重分配
 * 3. 风险平价(Risk Parity)
 * 4. 最大夏普比率优化
 * 5. 相关性分析与去相关
 *
 * 使用方式:
 * const optimizer = new PortfolioOptimizer(strategies, historicalResults);
 * const weights = optimizer.optimizeWeights('kelly'); // or 'sharpe', 'risk_parity'
 */

class PortfolioOptimizer {
  constructor(strategies, historicalResults) {
    this.strategies = strategies;
    this.historicalResults = historicalResults; // { strategyId: { trades: [...], stats: {...} } }
  }

  /**
   * Kelly公式计算单策略最优仓位比例
   * Kelly% = (p * b - q) / b
   * 其中: p=胜率, q=败率, b=平均盈利/平均亏损
   *
   * @param {string} strategyId - 策略ID
   * @returns {number} - Kelly百分比 (0-1)
   */
  calculateKellyPercentage(strategyId) {
    const result = this.historicalResults[strategyId];
    if (!result || !result.stats) return 0;

    const stats = result.stats;
    const winRate = stats.winRate;
    const lossRate = 1 - winRate;

    // 避免除零
    if (stats.avgLoss === 0) return 0;

    const b = Math.abs(stats.avgWin / stats.avgLoss); // 盈亏比

    // Kelly公式
    const kelly = (winRate * b - lossRate) / b;

    // 限制在合理范围内 (0-1)
    // 通常使用 Kelly/2 或 Kelly/4 来降低风险
    const fractionalKelly = Math.max(0, Math.min(1, kelly * 0.5));

    return fractionalKelly;
  }

  /**
   * 计算策略之间的相关性矩阵
   * 使用每日收益序列计算Pearson相关系数
   *
   * @returns {Object} - { matrix: [[]], strategyIds: [] }
   */
  calculateCorrelationMatrix() {
    const strategyIds = Object.keys(this.historicalResults);
    const n = strategyIds.length;

    // 构建每日收益序列
    const dailyReturns = {};
    strategyIds.forEach(id => {
      const trades = this.historicalResults[id].trades || [];
      dailyReturns[id] = this.aggregateDailyReturns(trades);
    });

    // 计算相关性矩阵
    const matrix = [];
    for (let i = 0; i < n; i++) {
      matrix[i] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[i][j] = 1.0;
        } else {
          const corr = this.pearsonCorrelation(
            dailyReturns[strategyIds[i]],
            dailyReturns[strategyIds[j]]
          );
          matrix[i][j] = corr;
        }
      }
    }

    return { matrix, strategyIds };
  }

  /**
   * 将交易聚合为每日收益
   * @param {Array} trades - 交易列表
   * @returns {Array} - 每日收益数组
   */
  aggregateDailyReturns(trades) {
    const dailyMap = {};

    trades.forEach(trade => {
      const date = new Date(trade.exit_time);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD

      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = 0;
      }
      dailyMap[dateKey] += trade.pnl;
    });

    return Object.values(dailyMap);
  }

  /**
   * 计算Pearson相关系数
   * @param {Array} x - 数据序列1
   * @param {Array} y - 数据序列2
   * @returns {number} - 相关系数 (-1 to 1)
   */
  pearsonCorrelation(x, y) {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;

    const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let sumSqX = 0;
    let sumSqY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      sumSqX += dx * dx;
      sumSqY += dy * dy;
    }

    const denominator = Math.sqrt(sumSqX * sumSqY);
    if (denominator === 0) return 0;

    return numerator / denominator;
  }

  /**
   * 基于Kelly公式优化权重
   * 考虑相关性,降低高度相关策略的权重
   *
   * @returns {Object} - { strategyId: weight }
   */
  optimizeWeightsKelly() {
    const strategyIds = Object.keys(this.historicalResults);
    const weights = {};

    // 计算每个策略的原始Kelly百分比
    const rawKelly = {};
    strategyIds.forEach(id => {
      rawKelly[id] = this.calculateKellyPercentage(id);
    });

    // 计算相关性矩阵
    const { matrix, strategyIds: corrStrategyIds } = this.calculateCorrelationMatrix();

    // 调整Kelly权重以考虑相关性
    // 如果策略A和B高度相关,降低其中一个的权重
    strategyIds.forEach((id, i) => {
      let adjustedKelly = rawKelly[id];

      // 计算该策略与其他策略的平均相关性
      let avgCorr = 0;
      let count = 0;
      corrStrategyIds.forEach((otherId, j) => {
        if (id !== otherId) {
          avgCorr += Math.abs(matrix[i][j]);
          count++;
        }
      });
      avgCorr = count > 0 ? avgCorr / count : 0;

      // 高相关性降低权重 (相关性越高,惩罚越大)
      const corrPenalty = 1 - (avgCorr * 0.5); // 最多降低50%
      adjustedKelly *= corrPenalty;

      weights[id] = adjustedKelly;
    });

    // 归一化权重
    return this.normalizeWeights(weights);
  }

  /**
   * 基于最大夏普比率优化权重
   * 使用简单的均值-方差优化
   *
   * @returns {Object} - { strategyId: weight }
   */
  optimizeWeightsSharpe() {
    const strategyIds = Object.keys(this.historicalResults);
    const weights = {};

    // 提取每个策略的夏普比率
    const sharpes = {};
    strategyIds.forEach(id => {
      const stats = this.historicalResults[id].stats;
      sharpes[id] = stats.sharpeRatio || 0;
    });

    // 仅保留夏普比率为正的策略
    const positiveSharpes = {};
    Object.entries(sharpes).forEach(([id, sharpe]) => {
      if (sharpe > 0) {
        positiveSharpes[id] = sharpe;
      }
    });

    // 按夏普比率分配权重 (夏普越高,权重越大)
    // 使用夏普比率的平方来强化差异
    strategyIds.forEach(id => {
      const sharpe = positiveSharpes[id] || 0;
      weights[id] = sharpe > 0 ? Math.pow(sharpe, 2) : 0;
    });

    return this.normalizeWeights(weights);
  }

  /**
   * 风险平价(Risk Parity)权重优化
   * 每个策略贡献相同的风险
   *
   * @returns {Object} - { strategyId: weight }
   */
  optimizeWeightsRiskParity() {
    const strategyIds = Object.keys(this.historicalResults);
    const weights = {};

    // 计算每个策略的波动率 (风险)
    const volatilities = {};
    strategyIds.forEach(id => {
      const trades = this.historicalResults[id].trades || [];
      volatilities[id] = this.calculateVolatility(trades);
    });

    // 风险平价: 权重与波动率成反比
    // 波动率越高,权重越低
    strategyIds.forEach(id => {
      const vol = volatilities[id];
      weights[id] = vol > 0 ? 1 / vol : 0;
    });

    return this.normalizeWeights(weights);
  }

  /**
   * 计算策略的波动率
   * @param {Array} trades - 交易列表
   * @returns {number} - 波动率
   */
  calculateVolatility(trades) {
    if (trades.length === 0) return 0;

    const returns = trades.map(t => t.pnl);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;

    return Math.sqrt(variance);
  }

  /**
   * 归一化权重,使总和为1
   * @param {Object} weights - { strategyId: weight }
   * @returns {Object} - 归一化后的权重
   */
  normalizeWeights(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);

    if (total === 0) {
      // 如果所有权重为0,返回均等权重
      const strategyIds = Object.keys(weights);
      const equalWeight = 1.0 / strategyIds.length;
      const result = {};
      strategyIds.forEach(id => {
        result[id] = equalWeight;
      });
      return result;
    }

    const normalized = {};
    Object.entries(weights).forEach(([id, weight]) => {
      normalized[id] = weight / total;
    });

    return normalized;
  }

  /**
   * 优化权重 (统一接口)
   * @param {string} method - 优化方法: 'kelly', 'sharpe', 'risk_parity', 'equal'
   * @returns {Object} - { strategyId: weight }
   */
  optimizeWeights(method = 'kelly') {
    switch (method) {
      case 'kelly':
        return this.optimizeWeightsKelly();
      case 'sharpe':
        return this.optimizeWeightsSharpe();
      case 'risk_parity':
        return this.optimizeWeightsRiskParity();
      case 'equal':
        return this.equalWeights();
      default:
        throw new Error(`Unknown optimization method: ${method}`);
    }
  }

  /**
   * 均等权重
   * @returns {Object} - { strategyId: weight }
   */
  equalWeights() {
    const strategyIds = Object.keys(this.historicalResults);
    const weight = 1.0 / strategyIds.length;
    const weights = {};
    strategyIds.forEach(id => {
      weights[id] = weight;
    });
    return weights;
  }

  /**
   * 计算组合的预期统计数据
   * @param {Object} weights - { strategyId: weight }
   * @returns {Object} - 组合统计数据
   */
  calculatePortfolioStats(weights) {
    let totalPnl = 0;
    let totalTrades = 0;
    let totalWins = 0;
    let allReturns = [];

    Object.entries(weights).forEach(([strategyId, weight]) => {
      const result = this.historicalResults[strategyId];
      if (!result || !result.stats) return;

      const stats = result.stats;
      const trades = result.trades || [];

      totalPnl += stats.totalPnl * weight;
      totalTrades += stats.totalTrades * weight;
      totalWins += (stats.totalTrades * stats.winRate) * weight;

      // 收集加权收益
      trades.forEach(trade => {
        allReturns.push(trade.pnl * weight);
      });
    });

    const winRate = totalTrades > 0 ? totalWins / totalTrades : 0;

    // 计算组合夏普比率
    const avgReturn = allReturns.length > 0
      ? allReturns.reduce((a, b) => a + b, 0) / allReturns.length
      : 0;
    const variance = allReturns.length > 0
      ? allReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / allReturns.length
      : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

    return {
      totalPnl,
      totalTrades: Math.round(totalTrades),
      winRate,
      sharpeRatio,
      avgReturn,
      stdDev
    };
  }

  /**
   * 生成优化报告
   * @returns {Object} - 优化报告
   */
  generateReport() {
    const methods = ['equal', 'kelly', 'sharpe', 'risk_parity'];
    const report = {
      strategies: Object.keys(this.historicalResults),
      correlationMatrix: this.calculateCorrelationMatrix(),
      optimizations: {}
    };

    methods.forEach(method => {
      const weights = this.optimizeWeights(method);
      const portfolioStats = this.calculatePortfolioStats(weights);

      report.optimizations[method] = {
        weights,
        portfolioStats
      };
    });

    return report;
  }
}

module.exports = PortfolioOptimizer;
