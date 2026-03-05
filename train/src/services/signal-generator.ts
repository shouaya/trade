/**
 * Signal Generator - 交易信号生成器
 * 整合RSI、MACD、网格等多种信号源
 */

import type {
  Strategy,
  KlineData,
  SignalGeneratorSignals,
  RSISignalInfo,
  MACDSignalInfo,
  GridSignalInfo,
  CombinedSignal
} from '../types';
import { precalculateRSI, generateRSISignal, type RSIConfig } from './indicators/rsi';
import { precalculateMACD, generateMACDSignal, type MACDResult, type MACDValue } from './indicators/macd';
import { generateGridSignal, type Grid, type GridPosition } from './indicators/grid';

export class SignalGenerator {
  private readonly strategy: Strategy;
  private readonly grid: Grid | null;
  private previousMACD: MACDValue | null;
  private readonly cachedRSI: readonly (number | null)[] | null;
  private readonly cachedMACD: MACDResult | null;

  constructor(strategy: Strategy, grid: Grid | null = null, klines: readonly KlineData[] | null = null) {
    this.strategy = strategy;
    this.grid = grid;
    this.previousMACD = null;

    // 预计算RSI和MACD值以提升性能
    this.cachedRSI = null;
    this.cachedMACD = null;

    if (klines) {
      const params = strategy.parameters;

      // 如果策略需要RSI,预计算所有RSI值
      if (params.rsi && params.rsi.enabled) {
        this.cachedRSI = precalculateRSI(klines, params.rsi.period);
      }

      // 如果策略需要MACD,预计算所有MACD值
      if (params.macd && params.macd.enabled) {
        this.cachedMACD = precalculateMACD(
          klines,
          params.macd.fastPeriod ?? 12,
          params.macd.slowPeriod ?? 26,
          params.macd.signalPeriod ?? 9
        );
      }
    }
  }

  /**
   * 生成综合交易信号
   */
  generate(klines: readonly KlineData[], index: number, openPositions: readonly GridPosition[] = []): SignalGeneratorSignals {
    const params = this.strategy.parameters;
    let rsiSignal: RSISignalInfo | null = null;
    let macdSignal: MACDSignalInfo | null = null;
    let gridSignal: GridSignalInfo | null = null;

    // 1. 生成RSI信号
    if (params.rsi && params.rsi.enabled) {
      const rsiValue = this.cachedRSI ? this.cachedRSI[index] ?? null : null;
      const rsiConfig: RSIConfig = {
        oversold: params.rsi.oversold ?? 30,
        overbought: params.rsi.overbought ?? 70
      };
      const rsignal = generateRSISignal(rsiValue, rsiConfig);

      rsiSignal = {
        value: rsiValue,
        signal: rsignal
      };
    }

    // 2. 生成MACD信号
    if (params.macd && params.macd.enabled) {
      const currentMACD: MACDValue | null = this.cachedMACD
        ? {
            macd: this.cachedMACD.macd[index] ?? null,
            signal: this.cachedMACD.signal[index] ?? null,
            histogram: this.cachedMACD.histogram[index] ?? null
          }
        : null;

      const previousMACD: MACDValue | null =
        this.cachedMACD && index > 0
          ? {
              macd: this.cachedMACD.macd[index - 1] ?? null,
              signal: this.cachedMACD.signal[index - 1] ?? null,
              histogram: this.cachedMACD.histogram[index - 1] ?? null
            }
          : this.previousMACD;

      const msignal = generateMACDSignal(currentMACD, previousMACD);

      macdSignal = {
        current: currentMACD,
        signal: msignal,
        crossSignal: msignal
      };

      // 更新上一个MACD值
      this.previousMACD = currentMACD;
    }

    // 3. 生成网格信号
    if (params.grid && params.grid.enabled && this.grid) {
      const kline = klines[index];
      if (kline) {
        const currentPrice = parseFloat(kline.close);
        gridSignal = generateGridSignal(this.grid, currentPrice, openPositions);
      }
    }

    // 4. 组合信号
    const combined = this.combineSignals({ rsi: rsiSignal, macd: macdSignal, grid: gridSignal });

    return {
      rsi: rsiSignal,
      macd: macdSignal,
      grid: gridSignal,
      combined
    };
  }

  /**
   * 组合多个信号源
   */
  private combineSignals(signals: Omit<SignalGeneratorSignals, 'combined'>): CombinedSignal {
    const { rsi, macd, grid } = signals;
    const type = this.strategy.type;

    // 根据策略类型组合信号
    switch (type) {
      case 'grid_only':
        return this.gridOnlyLogic(grid);

      case 'rsi_only':
        return this.rsiOnlyLogic(rsi);

      case 'macd_only':
        return this.macdOnlyLogic(macd);

      case 'rsi_and_macd':
        return this.rsiAndMacdLogic(rsi, macd);

      case 'rsi_or_macd':
        return this.rsiOrMacdLogic(rsi, macd);

      default:
        return { action: null, reason: 'unknown_strategy_type' };
    }
  }

  // ========== 组合逻辑实现 ==========

  private gridOnlyLogic(grid: GridSignalInfo | null): CombinedSignal {
    if (!grid || !grid.action) {
      return { action: null, reason: 'no_grid_signal' };
    }

    return {
      action: grid.action,
      reason: grid.reason ?? 'grid_signal',
      confidence: 0.7,
      gridLevel: grid.level
    };
  }

  private rsiOnlyLogic(rsi: RSISignalInfo | null): CombinedSignal {
    if (!rsi || !rsi.signal) {
      return { action: null, reason: 'no_rsi_signal' };
    }

    return {
      action: rsi.signal,
      reason: `rsi_${rsi.signal.toLowerCase()}`,
      confidence: 0.8,
      rsiValue: rsi.value ?? undefined
    };
  }

  private macdOnlyLogic(macd: MACDSignalInfo | null): CombinedSignal {
    if (!macd || !macd.crossSignal) {
      return { action: null, reason: 'no_macd_signal' };
    }

    return {
      action: macd.crossSignal,
      reason: `macd_${macd.crossSignal.toLowerCase()}`,
      confidence: 0.75,
      macdValue: macd.value
    };
  }

  private rsiAndMacdLogic(rsi: RSISignalInfo | null, macd: MACDSignalInfo | null): CombinedSignal {
    // 必须两个信号都存在且方向一致
    if (!rsi || !macd || !rsi.signal || !macd.crossSignal) {
      return { action: null, reason: 'waiting_for_both_signals' };
    }

    if (rsi.signal === macd.crossSignal) {
      return {
        action: rsi.signal,
        reason: 'rsi_and_macd_agree',
        confidence: 0.9,
        rsiValue: rsi.value ?? undefined,
        macdValue: macd.value
      };
    }

    return { action: null, reason: 'rsi_macd_disagree' };
  }

  private rsiOrMacdLogic(rsi: RSISignalInfo | null, macd: MACDSignalInfo | null): CombinedSignal {
    // 任一信号触发即可
    if (rsi && rsi.signal) {
      return {
        action: rsi.signal,
        reason: 'rsi_triggered',
        confidence: 0.7,
        rsiValue: rsi.value ?? undefined
      };
    }

    if (macd && macd.crossSignal) {
      return {
        action: macd.crossSignal,
        reason: 'macd_triggered',
        confidence: 0.7,
        macdValue: macd.value
      };
    }

    return { action: null, reason: 'no_signal' };
  }
}
