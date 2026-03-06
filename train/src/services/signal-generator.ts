/**
 * Signal Generator - RSI-only 信号生成器
 */

import type {
  Strategy,
  KlineData,
  SignalGeneratorSignals,
  RSISignalInfo,
  CombinedSignal
} from '../types';
import { precalculateRSI, generateRSISignal, type RSIConfig } from './indicators/rsi';

export class SignalGenerator {
  private readonly strategy: Strategy;
  private readonly cachedRSI: readonly (number | null)[] | null;

  constructor(strategy: Strategy, klines: readonly KlineData[] | null = null) {
    this.strategy = strategy;
    this.cachedRSI = klines ? precalculateRSI(klines, strategy.parameters.rsi.period) : null;
  }

  generate(klines: readonly KlineData[], index: number): SignalGeneratorSignals {
    const rsiValue = this.cachedRSI ? this.cachedRSI[index] ?? null : null;
    const rsiConfig: RSIConfig = {
      oversold: this.strategy.parameters.rsi.oversold ?? 30,
      overbought: this.strategy.parameters.rsi.overbought ?? 70
    };

    const rsiSignal: RSISignalInfo = {
      value: rsiValue,
      signal: generateRSISignal(rsiValue, rsiConfig)
    };

    return {
      rsi: rsiSignal,
      macd: null,
      grid: null,
      combined: this.combineSignals(rsiSignal, klines[index] ?? null)
    };
  }

  private combineSignals(rsi: RSISignalInfo, kline: KlineData | null): CombinedSignal {
    if (!rsi.signal) {
      return { action: null, reason: 'no_rsi_signal' };
    }

    return {
      action: rsi.signal,
      reason: `rsi_${rsi.signal.toLowerCase()}`,
      confidence: 0.8,
      rsiValue: rsi.value ?? undefined,
      votes: kline ? { buy: rsi.signal === 'BUY' ? 1 : 0, sell: rsi.signal === 'SELL' ? 1 : 0 } : undefined
    };
  }
}
