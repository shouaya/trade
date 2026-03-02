/**
 * Grid Trading 网格交易策略
 *
 * 在价格范围内划分N个网格
 * 价格下穿网格线 -> 买入
 * 价格上穿网格线 -> 卖出
 */

/**
 * 初始化网格
 * @param {Array} klines - K线数据 (用于计算价格范围)
 * @param {Object} config - 网格配置
 *   { levels: 网格层数, rangePercent: 范围百分比, profitPerGrid: 每格利润% }
 * @returns {Object} 网格信息
 */
function initializeGrid(klines, config) {
  const { levels, rangePercent, profitPerGrid } = config;

  // 计算价格范围 (使用最近一段时间的价格)
  const recentKlines = klines.slice(-Math.min(1000, klines.length));
  const prices = recentKlines.map(k => parseFloat(k.close));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = (minPrice + maxPrice) / 2;

  // 根据rangePercent调整价格范围
  const range = avgPrice * (rangePercent / 100);
  const gridMin = avgPrice - range;
  const gridMax = avgPrice + range;

  // 计算每个网格线的价格
  const gridStep = (gridMax - gridMin) / levels;
  const gridLines = [];

  for (let i = 0; i <= levels; i++) {
    gridLines.push({
      level: i,
      price: gridMin + (gridStep * i),
      triggered: false
    });
  }

  return {
    levels,
    gridMin,
    gridMax,
    gridStep,
    gridLines,
    profitPerGrid,
    avgPrice
  };
}

/**
 * 检查价格是否触碰网格线
 * @param {Object} grid - 网格信息
 * @param {number} previousPrice - 前一个价格
 * @param {number} currentPrice - 当前价格
 * @returns {Array} 触发的网格信号 [{ level, action: 'BUY'|'SELL', price }]
 */
function checkGridTriggers(grid, previousPrice, currentPrice) {
  const signals = [];

  if (!previousPrice || !currentPrice) {
    return signals;
  }

  // 检查每个网格线
  for (let i = 0; i < grid.gridLines.length; i++) {
    const gridLine = grid.gridLines[i];
    const gridPrice = gridLine.price;

    // 价格向下穿越网格线 -> 买入信号
    if (previousPrice >= gridPrice && currentPrice < gridPrice) {
      signals.push({
        level: gridLine.level,
        action: 'BUY',
        price: gridPrice,
        gridType: 'down_cross'
      });
    }

    // 价格向上穿越网格线 -> 卖出信号
    if (previousPrice <= gridPrice && currentPrice > gridPrice) {
      signals.push({
        level: gridLine.level,
        action: 'SELL',
        price: gridPrice,
        gridType: 'up_cross'
      });
    }
  }

  return signals;
}

/**
 * 生成网格交易信号 (改进版: 区间交易策略)
 * @param {Object} grid - 网格信息
 * @param {number} currentPrice - 当前价格
 * @param {Array} openPositions - 当前持仓
 * @returns {Object|null} 交易信号
 */
function generateGridSignal(grid, currentPrice, openPositions) {
  if (!currentPrice || currentPrice < grid.gridMin || currentPrice > grid.gridMax) {
    return null;
  }

  // 计算当前价格所在的网格层级
  const currentLevel = Math.floor((currentPrice - grid.gridMin) / grid.gridStep);

  // 策略1: 价格在下半区 -> 买入
  // 策略2: 价格在上半区 -> 卖出(平仓)
  const midLevel = grid.levels / 2;

  if (currentLevel < midLevel) {
    // 下半区,考虑买入
    // 检查是否已有该层级的持仓
    const hasPositionAtLevel = openPositions.some(p =>
      p.gridLevel === currentLevel && p.direction === 'long'
    );

    if (!hasPositionAtLevel) {
      return {
        action: 'BUY',
        level: currentLevel,
        price: currentPrice,
        reason: 'grid_lower_zone'
      };
    }
  } else if (currentLevel > midLevel) {
    // 上半区,考虑卖出
    // 如果有低位买入的持仓,则考虑卖出
    const lowerPositions = openPositions.filter(p =>
      p.direction === 'long' && p.gridLevel < currentLevel
    );

    if (lowerPositions.length > 0) {
      return {
        action: 'SELL',
        level: currentLevel,
        price: currentPrice,
        reason: 'grid_upper_zone',
        closePosition: lowerPositions[0]  // 平掉最早的低位持仓
      };
    }
  }

  return null;
}

/**
 * 计算网格止盈价格
 * @param {number} entryPrice - 入场价格
 * @param {number} profitPerGrid - 每格利润百分比
 * @param {string} direction - 方向 'long' | 'short'
 * @returns {number} 止盈价格
 */
function calculateGridTakeProfit(entryPrice, profitPerGrid, direction) {
  const multiplier = 1 + (profitPerGrid / 100);

  if (direction === 'long') {
    return entryPrice * multiplier;
  } else {
    return entryPrice / multiplier;
  }
}

module.exports = {
  initializeGrid,
  checkGridTriggers,
  generateGridSignal,
  calculateGridTakeProfit
};
