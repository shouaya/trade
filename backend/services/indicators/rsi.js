/**
 * RSI (Relative Strength Index) 相对强弱指标
 *
 * RSI = 100 - (100 / (1 + RS))
 * RS = 平均涨幅 / 平均跌幅
 */

/**
 * 计算RSI指标
 * @param {Array} prices - 价格数组 (通常使用收盘价)
 * @param {number} period - RSI周期 (默认14)
 * @returns {Array} RSI值数组
 */
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) {
    return Array(prices.length).fill(null);
  }

  const rsiValues = Array(prices.length).fill(null);
  let gains = 0;
  let losses = 0;

  // 计算初始周期的平均涨跌幅
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // 计算第一个RSI值
  let rs = avgGain / (avgLoss || 1);
  rsiValues[period] = 100 - (100 / (1 + rs));

  // 使用Wilder平滑法计算后续RSI
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgGain / (avgLoss || 1);
    rsiValues[i] = 100 - (100 / (1 + rs));
  }

  return rsiValues;
}

/**
 * 获取指定索引的RSI值
 * @param {Array} klines - K线数据数组
 * @param {number} index - 当前索引
 * @param {number} period - RSI周期
 * @returns {number|null} RSI值
 */
function getRSIAtIndex(klines, index, period = 14) {
  if (index < period) {
    return null;
  }

  const prices = klines.slice(0, index + 1).map(k => parseFloat(k.close));
  const rsiValues = calculateRSI(prices, period);
  return rsiValues[rsiValues.length - 1];
}

/**
 * 生成RSI交易信号
 * @param {number} rsi - RSI值
 * @param {Object} config - RSI配置 { oversold, overbought }
 * @returns {string|null} 'BUY', 'SELL', 或 null
 */
function generateRSISignal(rsi, config) {
  if (rsi === null || rsi === undefined) {
    return null;
  }

  const { oversold, overbought } = config;

  if (rsi < oversold) {
    return 'BUY';  // 超卖,买入信号
  } else if (rsi > overbought) {
    return 'SELL'; // 超买,卖出信号
  }

  return null;
}

module.exports = {
  calculateRSI,
  getRSIAtIndex,
  generateRSISignal
};
