/**
 * MACD (Moving Average Convergence Divergence) 指标
 *
 * MACD线 = 快速EMA - 慢速EMA
 * 信号线 = MACD线的EMA
 * 柱状图 = MACD线 - 信号线
 */

/**
 * 计算EMA (指数移动平均)
 * @param {Array} prices - 价格数组
 * @param {number} period - 周期
 * @returns {Array} EMA值数组
 */
function calculateEMA(prices, period) {
  const emaValues = Array(prices.length).fill(null);

  if (prices.length < period) {
    return emaValues;
  }

  // 第一个EMA值使用SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  emaValues[period - 1] = sum / period;

  // 计算后续EMA
  const multiplier = 2 / (period + 1);
  for (let i = period; i < prices.length; i++) {
    emaValues[i] = (prices[i] - emaValues[i - 1]) * multiplier + emaValues[i - 1];
  }

  return emaValues;
}

/**
 * 计算MACD指标
 * @param {Array} prices - 价格数组 (通常使用收盘价)
 * @param {number} fastPeriod - 快速EMA周期 (默认12)
 * @param {number} slowPeriod - 慢速EMA周期 (默认26)
 * @param {number} signalPeriod - 信号线周期 (默认9)
 * @returns {Object} { macd, signal, histogram }
 */
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const length = prices.length;
  const macdLine = Array(length).fill(null);
  const signalLine = Array(length).fill(null);
  const histogram = Array(length).fill(null);

  if (length < slowPeriod) {
    return { macd: macdLine, signal: signalLine, histogram };
  }

  // 计算快速和慢速EMA
  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);

  // 计算MACD线
  for (let i = slowPeriod - 1; i < length; i++) {
    if (fastEMA[i] !== null && slowEMA[i] !== null) {
      macdLine[i] = fastEMA[i] - slowEMA[i];
    }
  }

  // 计算信号线 (MACD线的EMA)
  const macdValues = macdLine.filter(v => v !== null);
  const signalEMA = calculateEMA(macdValues, signalPeriod);

  let signalIndex = 0;
  for (let i = 0; i < length; i++) {
    if (macdLine[i] !== null) {
      if (signalIndex < signalEMA.length && signalEMA[signalIndex] !== null) {
        signalLine[i] = signalEMA[signalIndex];
        histogram[i] = macdLine[i] - signalLine[i];
      }
      signalIndex++;
    }
  }

  return {
    macd: macdLine,
    signal: signalLine,
    histogram
  };
}

/**
 * 预计算所有K线的MACD值 (性能优化)
 * @param {Array} klines - K线数据数组
 * @param {number} fastPeriod - 快速周期
 * @param {number} slowPeriod - 慢速周期
 * @param {number} signalPeriod - 信号周期
 * @returns {Object} { macd, signal, histogram } 数组
 */
function precalculateMACD(klines, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const prices = klines.map(k => parseFloat(k.close));
  return calculateMACD(prices, fastPeriod, slowPeriod, signalPeriod);
}

/**
 * 获取指定索引的MACD值
 * @param {Array} klines - K线数据数组
 * @param {number} index - 当前索引
 * @param {number} fastPeriod - 快速周期
 * @param {number} slowPeriod - 慢速周期
 * @param {number} signalPeriod - 信号周期
 * @returns {Object} { macd, signal, histogram }
 */
function getMACDAtIndex(klines, index, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (index < slowPeriod + signalPeriod) {
    return { macd: null, signal: null, histogram: null };
  }

  const prices = klines.slice(0, index + 1).map(k => parseFloat(k.close));
  const result = calculateMACD(prices, fastPeriod, slowPeriod, signalPeriod);

  return {
    macd: result.macd[result.macd.length - 1],
    signal: result.signal[result.signal.length - 1],
    histogram: result.histogram[result.histogram.length - 1]
  };
}

/**
 * 生成MACD交易信号
 * @param {Object} current - 当前MACD值 { macd, signal, histogram }
 * @param {Object} previous - 前一个MACD值 { macd, signal, histogram }
 * @returns {string|null} 'BUY', 'SELL', 或 null
 */
function generateMACDSignal(current, previous) {
  if (!current || !previous) {
    return null;
  }

  if (current.macd === null || current.signal === null ||
      previous.macd === null || previous.signal === null) {
    return null;
  }

  // 金叉: MACD线从下方穿越信号线
  if (previous.macd <= previous.signal && current.macd > current.signal) {
    return 'BUY';
  }

  // 死叉: MACD线从上方穿越信号线
  if (previous.macd >= previous.signal && current.macd < current.signal) {
    return 'SELL';
  }

  return null;
}

module.exports = {
  calculateEMA,
  calculateMACD,
  precalculateMACD,
  getMACDAtIndex,
  generateMACDSignal
};
