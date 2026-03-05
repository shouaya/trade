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

import type { KlineData, SignalDirection } from '../types';
import { calculateRSI } from './indicators/rsi';

export interface MultiTimeframeConfig {
  readonly oversold: number;
  readonly overbought: number;
  readonly trendOversold: number;
  readonly trendOverbought: number;
}

export interface TrendStrength {
  readonly type: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
}

export interface Divergence {
  readonly bullish: boolean;
  readonly bearish: boolean;
}

export interface AnalysisReport {
  readonly rsi1min: number | null;
  readonly rsi5min: number | null;
  readonly trendStrength: TrendStrength['type'];
  readonly divergence: Divergence;
  readonly recommendation: SignalDirection;
}

export class MultiTimeframeAnalyzer {
  private readonly klines1min: readonly KlineData[];
  private readonly klines5min: readonly KlineData[];
  private readonly rsi1min: readonly (number | null)[];
  private readonly rsi5min: readonly (number | null)[];

  constructor(klines1min: readonly KlineData[], rsiPeriod: number = 14) {
    this.klines1min = klines1min;

    // 预计算1分钟和5分钟K线
    this.klines5min = this.aggregate1minTo5min(klines1min);

    // 预计算RSI值
    this.rsi1min = calculateRSI(
      klines1min.map(k => parseFloat(k.close)),
      rsiPeriod
    );

    this.rsi5min = calculateRSI(
      this.klines5min.map(k => parseFloat(k.close)),
      rsiPeriod
    );
  }

  /**
   * 将1分钟K线聚合为5分钟K线
   */
  private aggregate1minTo5min(klines1min: readonly KlineData[]): readonly KlineData[] {
    const klines5min: KlineData[] = [];

    for (let i = 0; i < klines1min.length; i += 5) {
      const slice = klines1min.slice(i, Math.min(i + 5, klines1min.length));

      if (slice.length === 0) continue;

      const firstKline = slice[0]!;
      const lastKline = slice[slice.length - 1]!;

      const kline5min: KlineData = {
        id: firstKline.id,
        open_time: firstKline.open_time,
        open: firstKline.open,
        high: Math.max(...slice.map(k => parseFloat(k.high))).toString(),
        low: Math.min(...slice.map(k => parseFloat(k.low))).toString(),
        close: lastKline.close,
        volume: slice.reduce((sum, k) => sum + (parseFloat(k.volume ?? '0')), 0).toString(),
        symbol: firstKline.symbol,
        interval_type: '5m'
      };

      klines5min.push(kline5min);
    }

    return klines5min;
  }

  /**
   * 获取指定1分钟索引对应的5分钟索引
   */
  private get5minIndex(index1min: number): number {
    return Math.floor(index1min / 5);
  }

  /**
   * 获取多时间框架确认信号
   */
  getMultiTimeframeSignal(index1min: number, config: Partial<MultiTimeframeConfig> = {}): SignalDirection {
    const {
      oversold = 25,
      overbought = 70,
      trendOversold = 40, // 5分钟趋势判断的阈值
      trendOverbought = 60
    } = config;

    const rsi1 = this.rsi1min[index1min] ?? null;
    const index5 = this.get5minIndex(index1min);
    const rsi5 = this.rsi5min[index5] ?? null;

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
   */
  getTrendStrength(index1min: number): TrendStrength['type'] {
    const index5 = this.get5minIndex(index1min);
    const rsi5 = this.rsi5min[index5] ?? null;

    if (!rsi5) return 'neutral';

    if (rsi5 > 70) return 'strong_bullish';
    if (rsi5 > 55) return 'bullish';
    if (rsi5 < 30) return 'strong_bearish';
    if (rsi5 < 45) return 'bearish';
    return 'neutral';
  }

  /**
   * 检查是否存在RSI背离 (价格新高/新低但RSI未确认)
   */
  checkDivergence(index1min: number, lookback: number = 20): Divergence {
    if (index1min < lookback + 1) {
      return { bullish: false, bearish: false };
    }

    const currentKline = this.klines1min[index1min];
    if (!currentKline) {
      return { bullish: false, bearish: false };
    }

    const currentPrice = parseFloat(currentKline.close);
    const currentRSI = this.rsi1min[index1min] ?? null;

    if (!currentRSI) {
      return { bullish: false, bearish: false };
    }

    // 查找回看期内的价格和RSI极值
    let maxPrice = currentPrice;
    let minPrice = currentPrice;
    let maxPriceRSI = currentRSI;
    let minPriceRSI = currentRSI;

    for (let i = index1min - lookback; i < index1min; i++) {
      const kline = this.klines1min[i];
      const rsi = this.rsi1min[i];

      if (!kline || !rsi) continue;

      const price = parseFloat(kline.close);

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
   */
  getAnalysisReport(index1min: number): AnalysisReport {
    const index5 = this.get5minIndex(index1min);
    const rsi1 = this.rsi1min[index1min] ?? null;
    const rsi5 = this.rsi5min[index5] ?? null;
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
