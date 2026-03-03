/**
 * Multi-Timeframe Analyzer - 多时间框架分析器
 *
 * 用于在不同时间周期上分析技术指标，提高信号质量
 *
 * 策略:
 * - 5分钟RSI判断趋势方向
 * - 1分钟RSI寻找入场时机
 * - 双重确认减少假突破
 */

const RSICalculator = require('./indicators/rsi');

class MultiTimeframeAnalyzer {
  constructor(klines1min, rsiPeriod = 14) {
    this.klines1min = klines1min;
    this.rsiPeriod = rsiPeriod;

    // 预计算1分钟和5分钟K线
    this.klines5min = this.aggregate1minTo5min(klines1min);

    // 预计算RSI值
    this.rsi1min = RSICalculator.calculateRSI(
      klines1min.map(k => parseFloat(k.close)),
      rsiPeriod
    );

    this.rsi5min = RSICalculator.calculateRSI(
      this.klines5min.map(k => parseFloat(k.close)),
      rsiPeriod
    );
  }

  /**
   * 将1分钟K线聚合为5分钟K线
   * @param {Array} klines1min - 1分钟K线数据
   * @returns {Array} - 5分钟K线数据
   */
  aggregate1minTo5min(klines1min) {
    const klines5min = [];

    for (let i = 0; i < klines1min.length; i += 5) {
      const slice = klines1min.slice(i, Math.min(i + 5, klines1min.length));

      if (slice.length === 0) continue;

      const kline5min = {
        open_time: slice[0].open_time,
        close_time: slice[slice.length - 1].close_time || slice[slice.length - 1].open_time,
        open: slice[0].open,
        high: Math.max(...slice.map(k => parseFloat(k.high))).toString(),
        low: Math.min(...slice.map(k => parseFloat(k.low))).toString(),
        close: slice[slice.length - 1].close,
        volume: slice.reduce((sum, k) => sum + (parseFloat(k.volume) || 0), 0).toString()
      };

      klines5min.push(kline5min);
    }

    return klines5min;
  }

  /**
   * 获取指定1分钟索引对应的5分钟索引
   * @param {number} index1min - 1分钟K线索引
   * @returns {number} - 5分钟K线索引
   */
  get5minIndex(index1min) {
    return Math.floor(index1min / 5);
  }

  /**
   * 获取多时间框架确认信号
   * @param {number} index1min - 当前1分钟K线索引
   * @param {Object} config - RSI配置 { oversold, overbought, trendOversold, trendOverbought }
   * @returns {string} - 'long' / 'short' / 'hold'
   */
  getMultiTimeframeSignal(index1min, config) {
    const {
      oversold = 25,
      overbought = 70,
      trendOversold = 40,   // 5分钟趋势判断的阈值
      trendOverbought = 60
    } = config;

    const rsi1 = this.rsi1min[index1min];
    const index5 = this.get5minIndex(index1min);
    const rsi5 = this.rsi5min[index5];

    if (!rsi1 || !rsi5) return 'hold';

    // 多头信号: 5分钟RSI < 40 (趋势偏空) + 1分钟RSI < 25 (超卖反弹)
    if (rsi5 < trendOversold && rsi1 < oversold) {
      return 'long';
    }

    // 空头信号: 5分钟RSI > 60 (趋势偏多) + 1分钟RSI > 70 (超买回调)
    if (rsi5 > trendOverbought && rsi1 > overbought) {
      return 'short';
    }

    return 'hold';
  }

  /**
   * 获取趋势强度 (基于5分钟RSI)
   * @param {number} index1min - 当前1分钟K线索引
   * @returns {string} - 'strong_bullish' / 'bullish' / 'neutral' / 'bearish' / 'strong_bearish'
   */
  getTrendStrength(index1min) {
    const index5 = this.get5minIndex(index1min);
    const rsi5 = this.rsi5min[index5];

    if (!rsi5) return 'neutral';

    if (rsi5 > 70) return 'strong_bullish';
    if (rsi5 > 55) return 'bullish';
    if (rsi5 < 30) return 'strong_bearish';
    if (rsi5 < 45) return 'bearish';
    return 'neutral';
  }

  /**
   * 检查是否存在RSI背离 (价格新高/新低但RSI未确认)
   * @param {number} index1min - 当前1分钟K线索引
   * @param {number} lookback - 回看周期 (默认20)
   * @returns {Object} - { bullish: boolean, bearish: boolean }
   */
  checkDivergence(index1min, lookback = 20) {
    if (index1min < lookback + 1) {
      return { bullish: false, bearish: false };
    }

    const currentPrice = parseFloat(this.klines1min[index1min].close);
    const currentRSI = this.rsi1min[index1min];

    // 查找回看期内的价格和RSI极值
    let maxPrice = currentPrice;
    let minPrice = currentPrice;
    let maxPriceRSI = currentRSI;
    let minPriceRSI = currentRSI;

    for (let i = index1min - lookback; i < index1min; i++) {
      const price = parseFloat(this.klines1min[i].close);
      const rsi = this.rsi1min[i];

      if (price > maxPrice) {
        maxPrice = price;
        maxPriceRSI = rsi;
      }

      if (price < minPrice) {
        minPrice = price;
        minPriceRSI = rsi;
      }
    }

    // 看涨背离: 价格创新低但RSI未创新低
    const bullishDivergence = currentPrice < minPrice && currentRSI > minPriceRSI;

    // 看跌背离: 价格创新高但RSI未创新高
    const bearishDivergence = currentPrice > maxPrice && currentRSI < maxPriceRSI;

    return {
      bullish: bullishDivergence,
      bearish: bearishDivergence
    };
  }

  /**
   * 获取详细的多时间框架分析报告
   * @param {number} index1min - 当前1分钟K线索引
   * @returns {Object} - 分析报告
   */
  getAnalysisReport(index1min) {
    const index5 = this.get5minIndex(index1min);
    const rsi1 = this.rsi1min[index1min];
    const rsi5 = this.rsi5min[index5];
    const trend = this.getTrendStrength(index1min);
    const divergence = this.checkDivergence(index1min);

    return {
      rsi1min: rsi1,
      rsi5min: rsi5,
      trendStrength: trend,
      divergence,
      recommendation: this.getMultiTimeframeSignal(index1min, {
        oversold: 25,
        overbought: 70,
        trendOversold: 40,
        trendOverbought: 60
      })
    };
  }
}

module.exports = MultiTimeframeAnalyzer;
