/**
 * MACD (Moving Average Convergence Divergence) 指标
 *
 * MACD线 = 快速EMA - 慢速EMA
 * 信号线 = MACD线的EMA
 * 柱状图 = MACD线 - 信号线
 */

import type { KlineData } from '../../types';

export interface MACDResult {
  readonly macd: readonly (number | null)[];
  readonly signal: readonly (number | null)[];
  readonly histogram: readonly (number | null)[];
}

export interface MACDValue {
  readonly macd: number | null;
  readonly signal: number | null;
  readonly histogram: number | null;
}

export type MACDSignal = 'BUY' | 'SELL' | null;

/**
 * 计算EMA (指数移动平均)
 */
export function calculateEMA(prices: readonly number[], period: number): readonly (number | null)[] {
  const emaValues: (number | null)[] = Array<null>(prices.length).fill(null);

  if (prices.length < period) {
    return emaValues;
  }

  // 第一个EMA值使用SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i]!;
  }
  emaValues[period - 1] = sum / period;

  // 计算后续EMA
  const multiplier = 2 / (period + 1);
  for (let i = period; i < prices.length; i++) {
    const prevEma = emaValues[i - 1]!;
    emaValues[i] = (prices[i]! - prevEma) * multiplier + prevEma;
  }

  return emaValues;
}

/**
 * 计算MACD指标
 */
export function calculateMACD(
  prices: readonly number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const length = prices.length;
  const macdLine: (number | null)[] = Array<null>(length).fill(null);
  const signalLine: (number | null)[] = Array<null>(length).fill(null);
  const histogram: (number | null)[] = Array<null>(length).fill(null);

  if (length < slowPeriod) {
    return { macd: macdLine, signal: signalLine, histogram };
  }

  // 计算快速和慢速EMA
  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);

  // 计算MACD线
  for (let i = slowPeriod - 1; i < length; i++) {
    const fast = fastEMA[i];
    const slow = slowEMA[i];
    if (fast !== null && fast !== undefined && slow !== null && slow !== undefined) {
      macdLine[i] = fast - slow;
    }
  }

  // 计算信号线 (MACD线的EMA)
  const macdValues = macdLine.filter((v): v is number => v !== null);
  const signalEMA = calculateEMA(macdValues, signalPeriod);

  let signalIndex = 0;
  for (let i = 0; i < length; i++) {
    const macd = macdLine[i];
    if (macd !== null && macd !== undefined) {
      const signal = signalEMA[signalIndex];
      if (signalIndex < signalEMA.length && signal !== null && signal !== undefined) {
        signalLine[i] = signal;
        histogram[i] = macd - signal;
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
 */
export function precalculateMACD(
  klines: readonly KlineData[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const prices = klines.map(k => parseFloat(k.close));
  return calculateMACD(prices, fastPeriod, slowPeriod, signalPeriod);
}

/**
 * 获取指定索引的MACD值
 */
export function getMACDAtIndex(
  klines: readonly KlineData[],
  index: number,
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDValue {
  if (index < slowPeriod + signalPeriod) {
    return { macd: null, signal: null, histogram: null };
  }

  const prices = klines.slice(0, index + 1).map(k => parseFloat(k.close));
  const result = calculateMACD(prices, fastPeriod, slowPeriod, signalPeriod);
  const lastIdx = result.macd.length - 1;

  return {
    macd: result.macd[lastIdx] ?? null,
    signal: result.signal[lastIdx] ?? null,
    histogram: result.histogram[lastIdx] ?? null
  };
}

/**
 * 生成MACD交易信号
 */
export function generateMACDSignal(current: MACDValue | null, previous: MACDValue | null): MACDSignal {
  if (!current || !previous) {
    return null;
  }

  if (
    current.macd === null ||
    current.signal === null ||
    previous.macd === null ||
    previous.signal === null
  ) {
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
