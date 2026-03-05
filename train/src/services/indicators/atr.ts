/**
 * ATR (Average True Range) 平均真实波幅
 *
 * ATR用于衡量市场波动性
 * True Range = max(high - low, abs(high - prev_close), abs(low - prev_close))
 * ATR = TR的移动平均
 */

import type { KlineData, SLTPPrices } from '../../types';

export interface ATRConfig {
  readonly slMultiplier: number;
  readonly tpMultiplier: number;
}

/**
 * 计算True Range
 * @param current - 当前K线
 * @param previous - 前一根K线
 * @returns True Range值
 */
function calculateTrueRange(current: KlineData, previous: KlineData | null): number {
  const high = parseFloat(current.high);
  const low = parseFloat(current.low);
  const prevClose = previous ? parseFloat(previous.close) : parseFloat(current.close);

  const tr1 = high - low;
  const tr2 = Math.abs(high - prevClose);
  const tr3 = Math.abs(low - prevClose);

  return Math.max(tr1, tr2, tr3);
}

/**
 * 计算ATR指标
 * @param klines - K线数据数组
 * @param period - ATR周期 (默认14)
 * @returns ATR值数组
 */
export function calculateATR(klines: readonly KlineData[], period: number = 14): readonly (number | null)[] {
  if (klines.length < period) {
    return Array<null>(klines.length).fill(null);
  }

  const atrValues: (number | null)[] = Array<null>(klines.length).fill(null);
  const trValues: number[] = [];

  // 计算所有True Range
  for (let i = 0; i < klines.length; i++) {
    const previous = i > 0 ? klines[i - 1]! : null;
    trValues.push(calculateTrueRange(klines[i]!, previous));
  }

  // 计算初始ATR (简单移动平均)
  let atr = 0;
  for (let i = 0; i < period; i++) {
    atr += trValues[i]!;
  }
  atr = atr / period;
  atrValues[period - 1] = atr;

  // 使用Wilder平滑法计算后续ATR
  for (let i = period; i < klines.length; i++) {
    atr = ((atr * (period - 1)) + trValues[i]!) / period;
    atrValues[i] = atr;
  }

  return atrValues;
}

/**
 * 根据ATR计算动态止损止盈
 * @param atr - ATR值
 * @param entryPrice - 入场价格
 * @param direction - 交易方向 ('long' / 'short')
 * @param config - 配置 { slMultiplier, tpMultiplier }
 * @returns { stopLoss, takeProfit }
 */
export function calculateDynamicSLTP(
  atr: number,
  entryPrice: number,
  direction: 'long' | 'short',
  config: Partial<ATRConfig> = {}
): SLTPPrices {
  const slMultiplier = config.slMultiplier ?? 2.0;  // 止损 = 2×ATR
  const tpMultiplier = config.tpMultiplier ?? 3.0;  // 止盈 = 3×ATR

  const slDistance = atr * slMultiplier;
  const tpDistance = atr * tpMultiplier;

  if (direction === 'long') {
    return {
      stopLoss: entryPrice - slDistance,
      takeProfit: entryPrice + tpDistance
    };
  } else {
    return {
      stopLoss: entryPrice + slDistance,
      takeProfit: entryPrice - tpDistance
    };
  }
}

/**
 * 根据ATR计算动态仓位大小
 * @param atr - ATR值
 * @param accountBalance - 账户余额
 * @param riskPercent - 风险百分比 (例如: 0.01 = 1%)
 * @param slMultiplier - 止损倍数
 * @returns 建议手数
 */
export function calculatePositionSize(
  atr: number,
  accountBalance: number,
  riskPercent: number = 0.01,
  slMultiplier: number = 2.0
): number {
  const riskAmount = accountBalance * riskPercent;
  const stopLossPips = atr * slMultiplier * 100; // 转换为pips

  // USDJPY: 0.01手 = $0.01/pip
  // 所以: lotSize = riskAmount / (stopLossPips × $0.01)
  const pipValue = 0.01;
  const lotSize = riskAmount / (stopLossPips * pipValue);

  // 限制最大仓位
  return Math.min(Math.max(lotSize, 0.01), 0.5);
}

/**
 * 获取指定索引的ATR值
 * @param klines - K线数据数组
 * @param index - 当前索引
 * @param period - ATR周期
 * @returns ATR值
 */
export function getATRAtIndex(klines: readonly KlineData[], index: number, period: number = 14): number | null {
  if (index < period) {
    return null;
  }

  const subset = klines.slice(0, index + 1);
  const atrValues = calculateATR(subset, period);
  const lastValue = atrValues[atrValues.length - 1];
  return lastValue ?? null;
}
