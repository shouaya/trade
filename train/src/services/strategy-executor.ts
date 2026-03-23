/**
 * Strategy Executor
 *
 * Latest execution mode only:
 * - RSI + MACD entries
 * - ATR-based stop loss / take profit
 * - Intraday time-boxed exits
 */

import type {
  Strategy,
  KlineData,
  Position,
  BacktestResult,
  BacktestStats,
  TradeRecord,
  ExitReason,
  FeeModelConfig,
  ExecutorOptions,
  TimeRestriction,
  SymbolSpec
} from '../types';
import { calculateRSI } from './indicators/rsi';
import { calculateATR, calculateDynamicSLTP } from './indicators/atr';
import { precalculateMACD, generateMACDSignal } from './indicators/macd';
import { SlippageModel, type SlippageConfig } from './slippage-model';
import { TradingSchedule } from './trading-schedule';

type SignalDirection = 'long' | 'short' | 'hold';

const FX_LOT_SYMBOLS = new Set([
  'USDJPY',
  'EURJPY',
  'GBPJPY',
  'AUDJPY',
  'NZDJPY',
  'CADJPY',
  'CHFJPY',
  'EURUSD',
  'GBPUSD',
  'AUDUSD',
  'NZDUSD',
  'USDCAD',
  'USDCHF'
]);

interface InternalPosition extends Position {}

export class StrategyExecutor {
  private readonly strategy: Strategy;
  private readonly klines: readonly KlineData[];
  private readonly positions: InternalPosition[];
  private readonly closedTrades: TradeRecord[];
  private readonly enableSlippage: boolean;
  private readonly enableATRSizing: boolean;
  private readonly slippageModel: SlippageModel | null;
  private readonly feeModel: FeeModelConfig | null;
  private readonly symbolSpec: SymbolSpec;
  private readonly tradingSchedule: TradingSchedule;
  private readonly timeRestriction: TimeRestriction | null;
  private readonly rsiValues: readonly (number | null)[];
  private readonly atrValues: readonly (number | null)[];
  private readonly macdValues: {
    readonly macd: readonly (number | null)[];
    readonly signal: readonly (number | null)[];
    readonly histogram: readonly (number | null)[];
  };

  constructor(
    strategy: Strategy,
    klines: readonly KlineData[],
    options: ExecutorOptions & {
      readonly slippageConfig?: SlippageConfig;
    } = {}
  ) {
    this.strategy = strategy;
    this.klines = klines;
    this.positions = [];
    this.closedTrades = [];
    this.enableSlippage = options.enableSlippage ?? false;
    this.enableATRSizing = options.enableATRSizing ?? true;

    this.slippageModel = this.enableSlippage
      ? new SlippageModel({
        normalSlippage: 0.3,
        tokyoSlippage: 10.0,
        highVolatilitySlippage: 10.0,
        volatilityThreshold: 0.5,
        exitMultiplier: 1.2,
        ...options.slippageConfig
      })
      : null;

    this.feeModel = options.feeModel ?? null;
    this.symbolSpec = this.resolveSymbolSpec(options.symbolSpec);
    this.tradingSchedule = new TradingSchedule(strategy.parameters.tradingSchedule ?? '* 0-19 * * 1-5');
    this.timeRestriction = strategy.parameters.tradingTimeRestriction ?? null;
    this.rsiValues = this.calculateRSI();
    this.atrValues = calculateATR(this.klines, 14);
    this.macdValues = precalculateMACD(
      this.klines,
      strategy.parameters.macd.fastPeriod ?? 12,
      strategy.parameters.macd.slowPeriod ?? 26,
      strategy.parameters.macd.signalPeriod ?? 9
    );
  }

  private resolveSymbolSpec(override: SymbolSpec | undefined): SymbolSpec {
    if (override) {
      return {
        ...override,
        symbol: override.symbol.toUpperCase(),
        unitsPerLot: override.unitsPerLot > 0 ? override.unitsPerLot : 1
      };
    }

    const rawSymbol = this.klines[0]?.symbol ?? this.strategy.name;
    const symbol = String(rawSymbol || 'USDJPY').toUpperCase();
    const quoteCurrency = symbol.slice(-3);

    if (FX_LOT_SYMBOLS.has(symbol)) {
      return {
        symbol,
        marketType: 'fx',
        quantityMode: 'lot',
        unitsPerLot: 100000,
        pipSize: quoteCurrency === 'JPY' ? 0.01 : 0.0001,
        quoteCurrency,
        initialCapital: quoteCurrency === 'JPY' ? 1_000_000 : 10_000
      };
    }

    return {
      symbol,
      marketType: 'coin',
      quantityMode: 'base',
      unitsPerLot: 1,
      pipSize: quoteCurrency === 'JPY' ? 1 : 0.01,
      quoteCurrency,
      initialCapital: quoteCurrency === 'JPY' ? 1_000_000 : 10_000
    };
  }

  private calculateRSI(): readonly (number | null)[] {
    const closes = this.klines.map(k => parseFloat(k.close));
    return calculateRSI(closes, this.strategy.parameters.rsi.period ?? 14);
  }

  private isTradingAllowed(currentTime: Date): boolean {
    if (!this.tradingSchedule.isAllowed(currentTime)) {
      return false;
    }

    if (!this.timeRestriction?.enabled) {
      return true;
    }

    const excludeStart = this.timeRestriction.utcExcludeStart;
    const excludeEnd = this.timeRestriction.utcExcludeEnd;
    if (!excludeStart || !excludeEnd) {
      return true;
    }

    const hour = currentTime.getUTCHours();
    const minute = currentTime.getUTCMinutes();
    const currentMinutes = hour * 60 + minute;

    const [startHourText, startMinuteText] = excludeStart.split(':');
    const [endHourText, endMinuteText] = excludeEnd.split(':');
    const startMinutes = parseInt(startHourText ?? '0', 10) * 60 + parseInt(startMinuteText ?? '0', 10);
    const endMinutes = parseInt(endHourText ?? '0', 10) * 60 + parseInt(endMinuteText ?? '0', 10);

    if (endMinutes > startMinutes) {
      return currentMinutes < startMinutes || currentMinutes > endMinutes;
    }

    return currentMinutes < startMinutes && currentMinutes > endMinutes;
  }

  private getSignal(index: number): SignalDirection {
    const rsi = this.rsiValues[index] ?? null;
    if (rsi === null || index <= 0) {
      return 'hold';
    }

    const oversold = this.strategy.parameters.rsi.oversold ?? 30;
    const overbought = this.strategy.parameters.rsi.overbought ?? 70;
    const currentMacd = {
      macd: this.macdValues.macd[index] ?? null,
      signal: this.macdValues.signal[index] ?? null,
      histogram: this.macdValues.histogram[index] ?? null
    };
    const previousMacd = {
      macd: this.macdValues.macd[index - 1] ?? null,
      signal: this.macdValues.signal[index - 1] ?? null,
      histogram: this.macdValues.histogram[index - 1] ?? null
    };

    const currentHistogram = currentMacd.histogram;
    const previousHistogram = previousMacd.histogram;
    if (currentHistogram === null || previousHistogram === null) {
      return 'hold';
    }

    const crossSignal = generateMACDSignal(currentMacd, previousMacd);
    const histogramThreshold = this.strategy.parameters.macd.histogramThreshold ?? 0;
    const histogramTurningUp = currentHistogram > previousHistogram && currentHistogram >= histogramThreshold;
    const histogramTurningDown = currentHistogram < previousHistogram && currentHistogram <= -histogramThreshold;

    if (rsi < oversold && (crossSignal === 'BUY' || histogramTurningUp)) {
      return 'long';
    }

    if (rsi > overbought && (crossSignal === 'SELL' || histogramTurningDown)) {
      return 'short';
    }

    return 'hold';
  }

  private openPosition(kline: KlineData, direction: 'long' | 'short', index: number): void {
    const executionPrice = this.slippageModel
      ? this.slippageModel.getExecutionPrice(kline, direction, true)
      : this.getReferencePrice(kline, direction, true);

    let lotSize = this.strategy.parameters.risk.lotSize;
    if (this.enableATRSizing) {
      const atr = this.atrValues[index] ?? null;
      if (atr) {
        lotSize = this.calculateAdaptivePositionSize(
          atr,
          this.symbolSpec.initialCapital,
          0.01,
          this.strategy.parameters.atr.slMultiplier,
          this.strategy.parameters.risk.lotSize
        );
      }
    }

    const stopLoss = this.calculateStopLoss(executionPrice, direction, index);
    const takeProfit = this.calculateTakeProfit(executionPrice, direction, index);

    this.positions.push({
      direction,
      entry_time: parseInt(kline.open_time, 10),
      entry_price: executionPrice,
      entry_index: index,
      entry_rsi: this.rsiValues[index] ?? null,
      entry_macd: this.macdValues.macd[index] ?? null,
      entry_macd_signal: this.macdValues.signal[index] ?? null,
      entry_macd_histogram: this.macdValues.histogram[index] ?? null,
      lot_size: lotSize,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      hold_minutes: this.strategy.parameters.risk.maxHoldMinutes,
      strategy_name: this.strategy.name,
      symbol: kline.symbol
    });
  }

  private calculateStopLoss(entryPrice: number, direction: 'long' | 'short', index: number): number | null {
    const atr = this.atrValues[index] ?? null;
    if (atr === null) {
      return null;
    }

    return calculateDynamicSLTP(atr, entryPrice, direction, this.strategy.parameters.atr).stopLoss;
  }

  private calculateTakeProfit(entryPrice: number, direction: 'long' | 'short', index: number): number | null {
    const atr = this.atrValues[index] ?? null;
    if (atr === null) {
      return null;
    }

    return calculateDynamicSLTP(atr, entryPrice, direction, this.strategy.parameters.atr).takeProfit;
  }

  private checkExitConditions(index: number, kline: KlineData): void {
    if (this.positions.length === 0) {
      return;
    }

    const position = this.positions[0];
    if (!position) {
      return;
    }

    const currentTime = parseInt(kline.open_time, 10);
    const currentDate = new Date(currentTime);
    const currentPrice = this.slippageModel
      ? this.slippageModel.getExecutionPrice(kline, position.direction, false)
      : this.getReferencePrice(kline, position.direction, false);

    let shouldExit = false;
    let exitReason: ExitReason | null = null;

    if (position.stop_loss !== null) {
      if (position.direction === 'long' && currentPrice <= position.stop_loss) {
        shouldExit = true;
        exitReason = 'stop_loss';
      } else if (position.direction === 'short' && currentPrice >= position.stop_loss) {
        shouldExit = true;
        exitReason = 'stop_loss';
      }
    }

    if (!shouldExit && position.take_profit !== null) {
      if (position.direction === 'long' && currentPrice >= position.take_profit) {
        shouldExit = true;
        exitReason = 'take_profit';
      } else if (position.direction === 'short' && currentPrice <= position.take_profit) {
        shouldExit = true;
        exitReason = 'take_profit';
      }
    }

    if (!shouldExit && position.hold_minutes !== null) {
      const holdMinutes = (currentTime - position.entry_time) / (1000 * 60);
      if (holdMinutes >= position.hold_minutes) {
        shouldExit = true;
        exitReason = 'hold_time_reached';
      }
    }

    if (!shouldExit) {
      const entryDate = new Date(position.entry_time);
      if (
        entryDate.getUTCFullYear() !== currentDate.getUTCFullYear() ||
        entryDate.getUTCMonth() !== currentDate.getUTCMonth() ||
        entryDate.getUTCDate() !== currentDate.getUTCDate()
      ) {
        shouldExit = true;
        exitReason = 'no_overnight';
      }
    }

    if (!shouldExit) {
      const dayOfWeek = currentDate.getUTCDay();
      if (dayOfWeek === 5 && currentDate.getUTCHours() >= 20) {
        shouldExit = true;
        exitReason = 'no_weekend';
      } else if (dayOfWeek === 0 || dayOfWeek === 6) {
        shouldExit = true;
        exitReason = 'no_weekend';
      }
    }

    if (shouldExit && exitReason) {
      this.closePosition(kline, currentPrice, exitReason, index);
    }
  }

  private closePosition(kline: KlineData, exitPrice: number, exitReason: ExitReason, index: number): void {
    const position = this.positions.shift();
    if (!position) {
      return;
    }

    const outcome = this.calculateTradeOutcome(position, exitPrice);
    this.closedTrades.push({
      direction: position.direction,
      entry_time: position.entry_time,
      entry_price: position.entry_price,
      entry_index: position.entry_index,
      entry_rsi: position.entry_rsi,
      entry_macd: position.entry_macd ?? null,
      entry_macd_signal: position.entry_macd_signal ?? null,
      entry_macd_histogram: position.entry_macd_histogram ?? null,
      lot_size: position.lot_size,
      stop_loss: position.stop_loss,
      take_profit: position.take_profit,
      hold_minutes: position.hold_minutes,
      strategy_name: position.strategy_name,
      symbol: position.symbol,
      exit_time: parseInt(kline.open_time, 10),
      exit_price: exitPrice,
      exit_rsi: this.rsiValues[index] ?? null,
      exit_macd: this.macdValues.macd[index] ?? null,
      exit_macd_signal: this.macdValues.signal[index] ?? null,
      exit_macd_histogram: this.macdValues.histogram[index] ?? null,
      exit_reason: exitReason,
      gross_pnl: outcome.grossPnl,
      commission_fee: outcome.commissionFee,
      pnl: outcome.netPnl,
      pips: outcome.pips,
      percent: outcome.percent,
      actual_hold_minutes: (parseInt(kline.open_time, 10) - position.entry_time) / (1000 * 60)
    });
  }

  private calculatePnL(position: Pick<InternalPosition, 'direction' | 'entry_price' | 'lot_size'>, exitPrice: number): number {
    const units = this.getPositionUnits(position);
    const priceDiff = this.getPriceDiff(position, exitPrice);
    return priceDiff * units;
  }

  private calculateTradeOutcome(position: Pick<InternalPosition, 'direction' | 'entry_price' | 'lot_size'>, exitPrice: number): {
    grossPnl: number;
    commissionFee: number;
    netPnl: number;
    pips: number;
    percent: number;
  } {
    const entryPrice = position.entry_price;
    const priceDiff = this.getPriceDiff(position, exitPrice);
    const pips = priceDiff / this.symbolSpec.pipSize;
    const grossPnl = this.calculatePnL(position, exitPrice);
    const commissionFee = this.calculateCommission(position, exitPrice);
    const netPnl = grossPnl - commissionFee;
    const percent = entryPrice !== 0 ? (priceDiff / entryPrice) * 100 : 0;

    return {
      grossPnl,
      commissionFee,
      netPnl,
      pips,
      percent
    };
  }

  private calculateCommission(position: Pick<InternalPosition, 'lot_size' | 'entry_price'>, exitPrice: number): number {
    if (!this.feeModel) {
      return 0;
    }

    const rate = this.feeModel.commissionRate;
    if (!Number.isFinite(rate) || rate <= 0) {
      return 0;
    }

    const units = this.getPositionUnits(position);
    let totalFee = 0;

    if (this.feeModel.chargeOnEntry ?? true) {
      totalFee += this.calculateExecutionCommission(units, position.entry_price, rate);
    }

    if (this.feeModel.chargeOnExit ?? true) {
      totalFee += this.calculateExecutionCommission(units, exitPrice, rate);
    }

    return totalFee;
  }

  private calculateExecutionCommission(units: number, executionPrice: number, commissionRate: number): number {
    return units * executionPrice * commissionRate;
  }

  private calculateAdaptivePositionSize(
    atr: number,
    accountBalance: number,
    riskPercent: number,
    slMultiplier: number,
    configuredSize: number
  ): number {
    const stopLossDistance = Math.max(atr * slMultiplier, Number.EPSILON);
    const riskAmount = Math.max(accountBalance * riskPercent, 0);
    const units = riskAmount / stopLossDistance;
    const rawSize = units / this.symbolSpec.unitsPerLot;

    if (this.symbolSpec.quantityMode === 'base') {
      return Math.min(Math.max(rawSize, 0.001), configuredSize);
    }

    return Math.min(Math.max(rawSize, 0.01), 0.5);
  }

  private getPositionUnits(position: Pick<InternalPosition, 'lot_size'>): number {
    return position.lot_size * this.symbolSpec.unitsPerLot;
  }

  private getPriceDiff(position: Pick<InternalPosition, 'direction' | 'entry_price'>, exitPrice: number): number {
    if (position.direction === 'long') {
      return exitPrice - position.entry_price;
    }

    return position.entry_price - exitPrice;
  }

  async execute(): Promise<BacktestResult> {
    for (let i = 0; i < this.klines.length; i++) {
      const kline = this.klines[i];
      if (!kline) continue;

      const currentTime = new Date(parseInt(kline.open_time, 10));
      this.checkExitConditions(i, kline);

      if (this.positions.length === 0 && this.isTradingAllowed(currentTime)) {
        const signal = this.getSignal(i);
        if (signal !== 'hold') {
          this.openPosition(kline, signal, i);
        }
      }
    }

    while (this.positions.length > 0) {
      const lastKline = this.klines[this.klines.length - 1];
      const firstPosition = this.positions[0];
      if (!lastKline || !firstPosition) {
        break;
      }

      const exitPrice = this.slippageModel
        ? this.slippageModel.getExecutionPrice(lastKline, firstPosition.direction, false)
        : this.getReferencePrice(lastKline, firstPosition.direction, false);
      this.closePosition(lastKline, exitPrice, 'backtest_end', this.klines.length - 1);
    }

    return this.calculateStats();
  }

  private calculateStats(): BacktestResult {
    const trades = this.closedTrades;
    const totalTrades = trades.length;

    if (totalTrades === 0) {
      return {
        stats: {
          totalTrades: 0,
          grossPnl: 0,
          totalCommission: 0,
          totalPnl: 0,
          returnPct: 0,
          winRate: 0,
          avgPnl: 0,
          maxDrawdown: 0,
          maxDrawdownPct: 0,
          sharpeRatio: 0,
          avgWin: 0,
          avgLoss: 0,
          profitFactor: 0,
          score: 0
        },
        trades
      };
    }

    const pnlSeries = trades.map(trade => trade.pnl);
    const grossPnlSeries = trades.map(trade => trade.gross_pnl ?? trade.pnl);
    const commissionSeries = trades.map(trade => trade.commission_fee ?? 0);
    const totalPnl = pnlSeries.reduce((sum, pnl) => sum + pnl, 0);
    const grossPnl = grossPnlSeries.reduce((sum, pnl) => sum + pnl, 0);
    const totalCommission = commissionSeries.reduce((sum, fee) => sum + fee, 0);
    const wins = pnlSeries.filter(pnl => pnl > 0);
    const losses = pnlSeries.filter(pnl => pnl <= 0);
    const avgPnl = totalPnl / totalTrades;
    const avgWin = wins.length ? wins.reduce((sum, pnl) => sum + pnl, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((sum, pnl) => sum + pnl, 0) / losses.length : 0;
    const winRate = wins.length / totalTrades;
    const maxDrawdown = this.calculateMaxDrawdown(pnlSeries);
    const returnPct = this.symbolSpec.initialCapital !== 0 ? (totalPnl / this.symbolSpec.initialCapital) * 100 : 0;
    const maxDrawdownPct = this.symbolSpec.initialCapital !== 0 ? (maxDrawdown / this.symbolSpec.initialCapital) * 100 : 0;
    const sharpeRatio = this.calculateSharpeRatio(pnlSeries, avgPnl);
    const grossProfit = wins.reduce((sum, pnl) => sum + pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, pnl) => sum + pnl, 0));
    const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfit / grossLoss;

    const stats: BacktestStats = {
      totalTrades,
      grossPnl,
      totalCommission,
      totalPnl,
      returnPct,
      winRate,
      avgPnl,
      maxDrawdown,
      maxDrawdownPct,
      sharpeRatio,
      avgWin,
      avgLoss,
      profitFactor,
      score: (returnPct * 0.4) + (winRate * 100 * 0.2) + (profitFactor * 10 * 0.2) + (sharpeRatio * 10 * 0.2)
    };

    return { stats, trades };
  }

  private calculateMaxDrawdown(pnlSeries: readonly number[]): number {
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;

    for (const pnl of pnlSeries) {
      equity += pnl;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    }

    return maxDrawdown;
  }

  private calculateSharpeRatio(pnlSeries: readonly number[], avgPnl: number): number {
    if (pnlSeries.length <= 1) {
      return 0;
    }

    const variance = pnlSeries.reduce((sum, pnl) => sum + ((pnl - avgPnl) ** 2), 0) / (pnlSeries.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) {
      return 0;
    }

    return avgPnl / stdDev;
  }

  private getReferencePrice(kline: KlineData, direction: 'long' | 'short', isEntry: boolean): number {
    const close = parseFloat(kline.close);
    const bidClose = kline.bid_close !== undefined && kline.bid_close !== null
      ? parseFloat(kline.bid_close)
      : null;
    const askClose = kline.ask_close !== undefined && kline.ask_close !== null
      ? parseFloat(kline.ask_close)
      : null;

    if (bidClose === null || askClose === null) {
      return close;
    }

    if (direction === 'long') {
      return isEntry ? askClose : bidClose;
    }

    return isEntry ? bidClose : askClose;
  }
}
