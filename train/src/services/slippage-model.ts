/**
 * Slippage Model - 滑点与点差建模 (基于GMO真实数据)
 *
 * GMO实际滑点:
 * - 正常时段: 0.5 pips
 * - 东京5-9点(JST,UTC 20:00-00:00): 10 pips
 * - 经济事件时: 0.5-10 pips (根据波动率)
 *
 * 成交价格计算:
 * - 做多入场: 信号价 × (1 + 总成本%)
 * - 做多出场: 信号价 × (1 - 总成本%)
 * - 做空入场: 信号价 × (1 - 总成本%)
 * - 做空出场: 信号价 × (1 + 总成本%)
 */

import type { KlineData } from '../types';

export interface SlippageConfig {
  readonly normalSlippage?: number;
  readonly tokyoSlippage?: number;
  readonly highVolatilitySlippage?: number;
  readonly volatilityThreshold?: number;
  readonly exitMultiplier?: number;
}

export interface CostBreakdown {
  readonly signalPrice: number;
  readonly executionPrice: number;
  readonly slippage: number;
  readonly slippageReason: string;
  readonly volatility: string;
  readonly isTokyoHour: boolean;
  readonly isHighVolatility: boolean;
  readonly exitMultiplier: number;
  readonly totalCostPips: number;
  readonly totalCostPercent: string;
  readonly priceDifference: string;
}

export class SlippageModel {
  private readonly normalSlippage: number;
  private readonly tokyoSlippage: number;
  private readonly highVolatilitySlippage: number;
  private readonly volatilityThreshold: number;
  private readonly exitMultiplier: number;

  constructor(config: SlippageConfig = {}) {
    this.normalSlippage = config.normalSlippage ?? 0.5; // 正常滑点 (pips)
    this.tokyoSlippage = config.tokyoSlippage ?? 10.0; // 东京5-9点滑点 (pips)
    this.highVolatilitySlippage = config.highVolatilitySlippage ?? 10.0; // 高波动滑点 (pips)
    this.volatilityThreshold = config.volatilityThreshold ?? 0.003; // 高波动阈值 (0.3%)
    this.exitMultiplier = config.exitMultiplier ?? 1.0; // 出场滑点倍数
  }

  /**
   * 检查是否为东京高滑点时段 (JST 5-9点 = UTC 20-24点)
   */
  isTokyoHighSlippageHour(kline: KlineData): boolean {
    const date = new Date(kline.open_time);
    const hour = date.getUTCHours();
    return hour >= 20 && hour < 24; // UTC 20:00-23:59 = JST 05:00-08:59
  }

  /**
   * 计算总交易成本 (滑点, 单位: pips)
   */
  calculateTotalCost(kline: KlineData, _direction: 'long' | 'short', isEntry: boolean = true): number {
    // 1. 基于时段和波动率计算滑点
    const volatility = this.calculateVolatility(kline);

    let slippage: number;
    if (this.isTokyoHighSlippageHour(kline)) {
      // 东京5-9点: 高滑点
      slippage = this.tokyoSlippage;
    } else if (volatility > this.volatilityThreshold) {
      // 高波动时段: 高滑点
      slippage = this.highVolatilitySlippage;
    } else {
      // 正常时段: 正常滑点
      slippage = this.normalSlippage;
    }

    // 2. 出场滑点通常更大
    const exitMultiplier = isEntry ? 1.0 : this.exitMultiplier;

    // 3. 总成本
    const totalCost = slippage * exitMultiplier;

    return totalCost;
  }

  /**
   * 计算波动率 (用于调整滑点)
   * @returns 波动率 (0-1之间的数值)
   */
  calculateVolatility(kline: KlineData): number {
    const high = parseFloat(kline.high);
    const low = parseFloat(kline.low);
    const close = parseFloat(kline.close);

    // 使用 (high-low) / close 作为波动率指标
    const range = high - low;
    const volatility = range / close;

    return volatility;
  }

  /**
   * 获取实际成交价格 (含滑点和点差)
   */
  getExecutionPrice(kline: KlineData, direction: 'long' | 'short', isEntry: boolean = true): number {
    const signalPrice = parseFloat(kline.close);
    const totalCostPips = this.calculateTotalCost(kline, direction, isEntry);

    // USDJPY: 1 pip = 0.01, 所以 1 pip = 0.01/价格 的百分比
    // 例如: 价格150, 1 pip = 0.01/150 ≈ 0.0067%
    const totalCostPercent = (totalCostPips * 0.01) / signalPrice;

    if (direction === 'long') {
      // 做多: 买入滑点向上, 卖出滑点向下
      return isEntry
        ? signalPrice * (1 + totalCostPercent) // 入场: 买入价更高
        : signalPrice * (1 - totalCostPercent); // 出场: 卖出价更低
    } else {
      // 做空: 卖出滑点向下, 买入滑点向上
      return isEntry
        ? signalPrice * (1 - totalCostPercent) // 入场: 卖出价更低
        : signalPrice * (1 + totalCostPercent); // 出场: 买入价更高
    }
  }

  /**
   * 计算交易成本的详细信息 (用于调试和日志)
   */
  getCostBreakdown(kline: KlineData, direction: 'long' | 'short', isEntry: boolean = true): CostBreakdown {
    const signalPrice = parseFloat(kline.close);
    const volatility = this.calculateVolatility(kline);
    const isTokyoHour = this.isTokyoHighSlippageHour(kline);
    const isHighVolatility = volatility > this.volatilityThreshold;

    let slippage: number;
    let slippageReason: string;
    if (isTokyoHour) {
      slippage = this.tokyoSlippage;
      slippageReason = 'Tokyo 5-9am (high slippage)';
    } else if (isHighVolatility) {
      slippage = this.highVolatilitySlippage;
      slippageReason = 'High volatility';
    } else {
      slippage = this.normalSlippage;
      slippageReason = 'Normal';
    }

    const exitMultiplier = isEntry ? 1.0 : this.exitMultiplier;
    const totalCost = slippage * exitMultiplier;
    const executionPrice = this.getExecutionPrice(kline, direction, isEntry);

    return {
      signalPrice,
      executionPrice,
      slippage,
      slippageReason,
      volatility: volatility.toFixed(6),
      isTokyoHour,
      isHighVolatility,
      exitMultiplier,
      totalCostPips: totalCost,
      totalCostPercent: ((totalCost * 0.01) / signalPrice * 100).toFixed(4) + '%',
      priceDifference: Math.abs(executionPrice - signalPrice).toFixed(5)
    };
  }
}
