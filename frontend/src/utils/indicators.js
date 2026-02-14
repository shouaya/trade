/**
 * 技术指标计算工具
 */

/**
 * 计算 RSI (相对强弱指标)
 * @param {Array} data - K线数据 [{close: number}]
 * @param {number} period - 周期，默认 14
 * @returns {Array} RSI 值数组 [{time, value}]
 */
export function calculateRSI(data, period = 14) {
  if (data.length < period + 1) return [];

  const rsi = [];
  let gains = 0;
  let losses = 0;

  // 计算初始平均涨跌幅
  for (let i = 1; i <= period; i++) {
    const change = parseFloat(data[i].close) - parseFloat(data[i - 1].close);
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // 第一个 RSI 值
  const rs = avgGain / avgLoss;
  const rsiValue = 100 - (100 / (1 + rs));

  rsi.push({
    time: parseInt(data[period].openTime) / 1000,
    value: parseFloat(rsiValue.toFixed(2))
  });

  // 计算后续 RSI 值
  for (let i = period + 1; i < data.length; i++) {
    const change = parseFloat(data[i].close) - parseFloat(data[i - 1].close);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgGain / avgLoss;
    const rsiValue = 100 - (100 / (1 + rs));

    rsi.push({
      time: parseInt(data[i].openTime) / 1000,
      value: parseFloat(rsiValue.toFixed(2))
    });
  }

  return rsi;
}

/**
 * 计算 EMA (指数移动平均线)
 * @param {Array} data - K线数据
 * @param {number} period - 周期
 * @returns {Array} EMA 值数组
 */
function calculateEMA(data, period) {
  if (data.length < period) return [];

  const ema = [];
  const multiplier = 2 / (period + 1);

  // 第一个 EMA 值使用 SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += parseFloat(data[i].close);
  }
  let emaValue = sum / period;
  ema.push(emaValue);

  // 计算后续 EMA 值
  for (let i = period; i < data.length; i++) {
    emaValue = (parseFloat(data[i].close) - emaValue) * multiplier + emaValue;
    ema.push(emaValue);
  }

  return ema;
}

/**
 * 计算 MACD
 * @param {Array} data - K线数据 [{close: number}]
 * @param {number} fastPeriod - 快线周期，默认 12
 * @param {number} slowPeriod - 慢线周期，默认 26
 * @param {number} signalPeriod - 信号线周期，默认 9
 * @returns {Object} {macd: [], signal: [], histogram: []}
 */
export function calculateMACD(
  data,
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
) {
  if (data.length < slowPeriod + signalPeriod) {
    return { macd: [], signal: [], histogram: [] };
  }

  // 计算快线和慢线 EMA
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);

  // 计算 MACD 线 (DIF)
  const macdLine = [];
  const startIndex = slowPeriod - fastPeriod;

  for (let i = 0; i < slowEMA.length; i++) {
    const macdValue = fastEMA[i + startIndex] - slowEMA[i];
    macdLine.push(macdValue);
  }

  // 计算信号线 (DEA) - MACD 的 EMA
  const signalLine = [];
  const multiplier = 2 / (signalPeriod + 1);

  // 第一个信号线值使用 MACD 的 SMA
  let sum = 0;
  for (let i = 0; i < signalPeriod; i++) {
    sum += macdLine[i];
  }
  let signalValue = sum / signalPeriod;
  signalLine.push(signalValue);

  // 计算后续信号线值
  for (let i = signalPeriod; i < macdLine.length; i++) {
    signalValue = (macdLine[i] - signalValue) * multiplier + signalValue;
    signalLine.push(signalValue);
  }

  // 准备返回数据
  const result = {
    macd: [],
    signal: [],
    histogram: []
  };

  const dataStartIndex = slowPeriod - 1 + signalPeriod - 1;

  // 计算柱状图的颜色（带深浅变化）
  let prevHistogram = 0;

  for (let i = 0; i < signalLine.length; i++) {
    const time = parseInt(data[dataStartIndex + i].openTime) / 1000;
    const macdValue = parseFloat(macdLine[signalPeriod - 1 + i].toFixed(5));
    const signalValue = parseFloat(signalLine[i].toFixed(5));
    const histogramValue = parseFloat((macdValue - signalValue).toFixed(5));

    result.macd.push({ time, value: macdValue });
    result.signal.push({ time, value: signalValue });

    // 根据柱状图的变化趋势设置颜色
    let color;
    if (histogramValue >= 0) {
      // 正值（多头）
      if (histogramValue >= prevHistogram) {
        color = '#26a69a'; // 深绿色 - 增长
      } else {
        color = '#4ecdc4'; // 浅绿色 - 减弱
      }
    } else {
      // 负值（空头）
      if (histogramValue <= prevHistogram) {
        color = '#ef5350'; // 深红色 - 增长
      } else {
        color = '#ff7675'; // 浅红色 - 减弱
      }
    }

    result.histogram.push({
      time,
      value: histogramValue,
      color: color
    });

    prevHistogram = histogramValue;
  }

  return result;
}

/**
 * 计算 SMA (简单移动平均线)
 * @param {Array} data - K线数据
 * @param {number} period - 周期
 * @returns {Array} SMA 值数组
 */
export function calculateSMA(data, period) {
  if (data.length < period) return [];

  const sma = [];

  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += parseFloat(data[i - j].close);
    }
    sma.push({
      time: parseInt(data[i].openTime) / 1000,
      value: parseFloat((sum / period).toFixed(5))
    });
  }

  return sma;
}
