/**
 * Strategy Executor V3 - 完整版策略执行器
 *
 * 新增功能 (P1):
 * 1. 多时间框架分析 - 5分钟趋势 + 1分钟入场
 * 2. ATR动态仓位计算 - 根据波动率调整仓位大小
 * 3. Trailing Stop - 盈利后移动止损锁定利润
 * 4. RSI回归退出 - RSI回归中性区时退出
 *
 * 使用方式:
 * const executor = new StrategyExecutor(strategy, klines, {
 *   enableMA200Filter: true,
 *   enableSlippage: false,  // 暂时禁用直到修复bug
 *   enableMultiTimeframe: true,
 *   enableATRSizing: true,
 *   enableTrailingStop: true,
 *   enableRSIReversion: true
 * });
 */

import type { Strategy, KlineData, Position, BacktestResult, BacktestStats, TradeRecord, ExitReason } from '../types';
import { calculateRSI } from './indicators/rsi';
import { calculateATR, calculateDynamicSLTP, calculatePositionSize } from './indicators/atr';
import { SlippageModel } from './slippage-model';
import { MultiTimeframeAnalyzer } from './multi-timeframe-analyzer';
import { TradingSchedule } from './trading-schedule';

export interface TrailingConfig {
  readonly activationPercent: number;   // 盈利百分比激活trailing stop
  readonly lockProfitPercent: number;   // 盈利百分比时锁定利润
  readonly lockProfitAmount: number;    // 锁定的利润百分比
}

export interface TimeRestriction {
  readonly enabled: boolean;
  readonly utcExcludeStart: string;     // 例如 "19:30"
  readonly utcExcludeEnd: string;       // 例如 "24:30"
}

export interface ExecutorOptions {
  readonly enableMA200Filter?: boolean | undefined;
  readonly enableSlippage?: boolean | undefined;
  readonly enableMultiTimeframe?: boolean | undefined;
  readonly enableATRSizing?: boolean | undefined;
  readonly enableTrailingStop?: boolean | undefined;
  readonly enableRSIReversion?: boolean | undefined;
  readonly trailingConfig?: TrailingConfig | undefined;
}

type SignalDirection = 'long' | 'short' | 'hold';

interface InternalPosition extends Position {
  trailingActivated: boolean;
  trailingStopPrice: number | null;
}

export class StrategyExecutor {
  private readonly strategy: Strategy;
  private readonly klines: readonly KlineData[];
  private readonly positions: InternalPosition[];
  private readonly closedTrades: TradeRecord[];

  // V2功能配置
  private readonly enableMA200Filter: boolean;
  private readonly enableSlippage: boolean;

  // V3新功能配置
  private readonly enableMultiTimeframe: boolean;
  private readonly enableATRSizing: boolean;
  private readonly enableTrailingStop: boolean;
  private readonly enableRSIReversion: boolean;

  // Trailing Stop配置
  private readonly trailingConfig: TrailingConfig;

  // 滑点模型
  private readonly slippageModel: SlippageModel | null;

  // 交易时间表
  private readonly tradingSchedule: TradingSchedule;

  // 时间限制配置
  private readonly timeRestriction: TimeRestriction | null;

  // 指标缓存
  private readonly rsiValues: readonly (number | null)[];
  private readonly ma200: readonly (number | null)[] | null;
  private readonly atrValues: readonly (number | null)[] | null;

  // 多时间框架分析器
  private readonly mtfAnalyzer: MultiTimeframeAnalyzer | null;

  constructor(strategy: Strategy, klines: readonly KlineData[], options: ExecutorOptions = {}) {
    this.strategy = strategy;
    this.klines = klines;
    this.positions = [];
    this.closedTrades = [];

    // V2功能配置
    this.enableMA200Filter = options.enableMA200Filter ?? false;
    this.enableSlippage = options.enableSlippage ?? false;

    // V3新功能配置
    this.enableMultiTimeframe = options.enableMultiTimeframe ?? false;
    this.enableATRSizing = options.enableATRSizing ?? false;
    this.enableTrailingStop = options.enableTrailingStop ?? false;
    this.enableRSIReversion = options.enableRSIReversion ?? false;

    // Trailing Stop配置
    this.trailingConfig = options.trailingConfig ?? {
      activationPercent: 0.1,   // 盈利0.1%激活trailing stop
      lockProfitPercent: 0.3,   // 盈利0.3%时锁定0.1%利润
      lockProfitAmount: 0.1     // 锁定的利润百分比
    };

    // 初始化滑点模型
    if (this.enableSlippage) {
      this.slippageModel = new SlippageModel({
        normalSlippage: 0.3,
        tokyoSlippage: 10.0,
        highVolatilitySlippage: 10.0,
        volatilityThreshold: 0.5,
        exitMultiplier: 1.2
      });
    } else {
      this.slippageModel = null;
    }

    // 初始化交易时间表
    const scheduleExpr = strategy.parameters.tradingSchedule ?? '* 0-19 * * 1-5';
    this.tradingSchedule = new TradingSchedule(scheduleExpr);

    // 时间限制配置
    this.timeRestriction = strategy.parameters.tradingTimeRestriction
      ? (strategy.parameters.tradingTimeRestriction as unknown as TimeRestriction)
      : null;

    // 计算RSI
    this.rsiValues = this.calculateRSI();

    // 计算MA200 (如果启用)
    if (this.enableMA200Filter) {
      this.ma200 = this.calculateMA(200);
    } else {
      this.ma200 = null;
    }

    // 计算ATR (如果启用)
    if (this.enableATRSizing || this.enableTrailingStop) {
      this.atrValues = calculateATR(this.klines, 14);
    } else {
      this.atrValues = null;
    }

    // 初始化多时间框架分析器 (如果启用)
    if (this.enableMultiTimeframe) {
      const rsiPeriod = this.strategy.parameters.rsi?.period ?? 14;
      this.mtfAnalyzer = new MultiTimeframeAnalyzer(this.klines, rsiPeriod);
    } else {
      this.mtfAnalyzer = null;
    }
  }

  /**
   * 计算RSI指标
   */
  private calculateRSI(): readonly (number | null)[] {
    const closes = this.klines.map(k => parseFloat(k.close));
    const period = this.strategy.parameters.rsi?.period ?? 14;
    return calculateRSI(closes, period);
  }

  /**
   * 计算移动平均线
   */
  private calculateMA(period: number): readonly (number | null)[] {
    const ma: (number | null)[] = [];
    for (let i = 0; i < this.klines.length; i++) {
      if (i < period - 1) {
        ma.push(null);
      } else {
        const slice = this.klines.slice(i - period + 1, i + 1);
        const sum = slice.reduce((s, k) => s + parseFloat(k.close), 0);
        ma.push(sum / period);
      }
    }
    return ma;
  }

  /**
   * 检查是否允许在当前时间开仓
   */
  private isTradingAllowed(currentTime: Date): boolean {
    // 先检查基本的交易时间表
    if (!this.tradingSchedule.isAllowed(currentTime)) {
      return false;
    }

    // 如果配置了时间限制，额外检查
    if (this.timeRestriction && this.timeRestriction.enabled) {
      const hour = currentTime.getUTCHours();
      const minute = currentTime.getUTCMinutes();

      // 解析排除时间段
      const excludeStart = this.timeRestriction.utcExcludeStart;
      const excludeEnd = this.timeRestriction.utcExcludeEnd;

      if (excludeStart && excludeEnd) {
        const startParts = excludeStart.split(':');
        const endParts = excludeEnd.split(':');

        const startHour = parseInt(startParts[0] ?? '0', 10);
        const startMinute = parseInt(startParts[1] ?? '0', 10);
        const endHour = parseInt(endParts[0] ?? '0', 10);
        const endMinute = parseInt(endParts[1] ?? '0', 10);

        const currentMinutes = hour * 60 + minute;
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;

        // 检查是否在排除时间段内
        if (endMinutes > startMinutes) {
          // 正常情况: 19:30-24:30
          if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
            return false;
          }
        } else {
          // 跨天情况: 23:00-02:00
          if (currentMinutes >= startMinutes || currentMinutes <= endMinutes) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * 获取交易信号 (支持多时间框架)
   */
  private getSignal(index: number): SignalDirection {
    const rsi = this.rsiValues[index] ?? null;
    const kline = this.klines[index];
    if (!kline || !rsi) return 'hold';

    const currentPrice = parseFloat(kline.close);
    const oversold = this.strategy.parameters.rsi?.oversold ?? 30;
    const overbought = this.strategy.parameters.rsi?.overbought ?? 70;

    // 多时间框架信号 (优先级最高)
    if (this.enableMultiTimeframe && this.mtfAnalyzer) {
      const mtfSignal = this.mtfAnalyzer.getMultiTimeframeSignal(index, {
        oversold: 25,           // 1分钟超卖阈值
        overbought: 70,         // 1分钟超买阈值
        trendOversold: 40,      // 5分钟趋势阈值
        trendOverbought: 60
      });

      if (mtfSignal !== 'hold') {
        // 如果启用MA200过滤器,额外检查趋势
        if (this.enableMA200Filter && this.ma200) {
          const ma200 = this.ma200[index] ?? null;
          if (!ma200) return 'hold';

          if (mtfSignal === 'long' && currentPrice > ma200) {
            return 'long';
          }
          if (mtfSignal === 'short' && currentPrice < ma200) {
            return 'short';
          }
          return 'hold';
        }

        return mtfSignal;
      }
    }

    // 传统单时间框架信号
    if (this.enableMA200Filter && this.ma200) {
      const ma200 = this.ma200[index] ?? null;
      if (!ma200) return 'hold';

      // 仅在价格高于MA200时做多
      if (rsi < oversold && currentPrice > ma200) {
        return 'long';
      }

      // 仅在价格低于MA200时做空
      if (rsi > overbought && currentPrice < ma200) {
        return 'short';
      }
    } else {
      // 无过滤器: 原始RSI信号
      if (rsi < oversold) {
        return 'long';
      }

      if (rsi > overbought) {
        return 'short';
      }
    }

    return 'hold';
  }

  /**
   * 开仓 (支持ATR动态仓位)
   */
  private openPosition(kline: KlineData, direction: 'long' | 'short', index: number): void {
    const params = this.strategy.parameters;

    // 获取成交价格 (如果启用滑点模型)
    const executionPrice = this.slippageModel
      ? this.slippageModel.getExecutionPrice(kline, direction, true)
      : parseFloat(kline.close);

    // 计算仓位大小
    let lotSize = params.risk.lotSize;
    if (this.enableATRSizing && this.atrValues) {
      const atr = this.atrValues[index] ?? null;
      if (atr) {
        const accountBalance = 10000;  // 假设账户余额
        const riskPercent = 0.01;      // 每笔风险1%
        lotSize = calculatePositionSize(
          atr,
          accountBalance,
          riskPercent,
          2.0  // SL = 2×ATR
        );
      }
    }

    // 计算止损止盈
    const stopLoss = this.calculateStopLoss(executionPrice, direction, params.risk, index);
    const takeProfit = this.calculateTakeProfit(executionPrice, direction, params.risk, index);

    const position: InternalPosition = {
      direction,
      entry_time: parseInt(kline.open_time),
      entry_price: executionPrice,
      entry_index: index,
      entry_rsi: this.rsiValues[index] ?? null,
      lot_size: lotSize,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      hold_minutes: params.risk.maxHoldMinutes,
      strategy_name: this.strategy.name,
      symbol: 'USDJPY',
      // Trailing Stop状态
      trailingActivated: false,
      trailingStopPrice: stopLoss
    };

    this.positions.push(position);
  }

  /**
   * 计算止损价格 (支持ATR动态止损)
   */
  private calculateStopLoss(
    entryPrice: number,
    direction: 'long' | 'short',
    risk: Strategy['parameters']['risk'],
    index: number
  ): number | null {
    // 如果启用ATR,使用ATR动态止损
    if (this.enableATRSizing && this.atrValues) {
      const atr = this.atrValues[index] ?? null;
      if (atr) {
        // 从策略参数中读取ATR倍数，如果没有则使用默认值
        const atrConfig = this.strategy.parameters.atr;
        const slMultiplier = atrConfig?.slMultiplier ?? 2.0;
        const tpMultiplier = atrConfig?.tpMultiplier ?? 3.0;

        const sltp = calculateDynamicSLTP(atr, entryPrice, direction, {
          slMultiplier,
          tpMultiplier
        });
        return sltp.stopLoss;
      }
    }

    // 否则使用固定百分比止损
    if (!risk.stopLossPercent) return null;

    const slPercent = risk.stopLossPercent / 100;

    if (direction === 'long') {
      return entryPrice * (1 - slPercent);
    } else {
      return entryPrice * (1 + slPercent);
    }
  }

  /**
   * 计算止盈价格 (支持ATR动态止盈)
   */
  private calculateTakeProfit(
    entryPrice: number,
    direction: 'long' | 'short',
    risk: Strategy['parameters']['risk'],
    index: number
  ): number | null {
    // 如果启用ATR,使用ATR动态止盈
    if (this.enableATRSizing && this.atrValues) {
      const atr = this.atrValues[index] ?? null;
      if (atr) {
        // 从策略参数中读取ATR倍数，如果没有则使用默认值
        const atrConfig = this.strategy.parameters.atr;
        const slMultiplier = atrConfig?.slMultiplier ?? 2.0;
        const tpMultiplier = atrConfig?.tpMultiplier ?? 3.0;

        const sltp = calculateDynamicSLTP(atr, entryPrice, direction, {
          slMultiplier,
          tpMultiplier
        });
        return sltp.takeProfit;
      }
    }

    // 否则使用固定百分比止盈
    if (!risk.takeProfitPercent) return null;

    const tpPercent = risk.takeProfitPercent / 100;

    if (direction === 'long') {
      return entryPrice * (1 + tpPercent);
    } else {
      return entryPrice * (1 - tpPercent);
    }
  }

  /**
   * 更新Trailing Stop
   */
  private updateTrailingStop(position: InternalPosition, currentPrice: number): void {
    if (!this.enableTrailingStop) return;

    const direction = position.direction;
    const entryPrice = position.entry_price;

    // 计算当前盈利百分比
    let profitPercent: number;
    if (direction === 'long') {
      profitPercent = (currentPrice - entryPrice) / entryPrice;
    } else {
      profitPercent = (entryPrice - currentPrice) / entryPrice;
    }

    const config = this.trailingConfig;

    // 激活trailing stop (盈利达到0.1%)
    if (!position.trailingActivated && profitPercent >= config.activationPercent / 100) {
      position.trailingActivated = true;
      // 将止损移到保本位置
      position.trailingStopPrice = entryPrice;
    }

    // 锁定利润 (盈利达到0.3%时,锁定0.1%利润)
    if (position.trailingActivated && profitPercent >= config.lockProfitPercent / 100) {
      const lockAmount = config.lockProfitAmount / 100;
      if (direction === 'long') {
        const newStopPrice = entryPrice * (1 + lockAmount);
        const currentStop = position.trailingStopPrice ?? entryPrice;
        if (newStopPrice > currentStop) {
          position.trailingStopPrice = newStopPrice;
        }
      } else {
        const newStopPrice = entryPrice * (1 - lockAmount);
        const currentStop = position.trailingStopPrice ?? entryPrice;
        if (newStopPrice < currentStop) {
          position.trailingStopPrice = newStopPrice;
        }
      }
    }
  }

  /**
   * 检查退出条件 (新增Trailing Stop和RSI回归)
   */
  private checkExitConditions(index: number, kline: KlineData): void {
    if (this.positions.length === 0) return;

    const position = this.positions[0];
    if (!position) return;

    const currentTime = parseInt(kline.open_time);
    const currentDate = new Date(currentTime);

    // 获取当前价格 (如果启用滑点模型,使用实际成交价)
    const currentPrice = this.slippageModel
      ? this.slippageModel.getExecutionPrice(kline, position.direction, false)
      : parseFloat(kline.close);

    // 更新Trailing Stop
    this.updateTrailingStop(position, currentPrice);

    let shouldExit = false;
    let exitReason: ExitReason | null = null;

    // 1. 检查Trailing Stop
    if (this.enableTrailingStop && position.trailingActivated && position.trailingStopPrice !== null) {
      if (position.direction === 'long' && currentPrice <= position.trailingStopPrice) {
        shouldExit = true;
        exitReason = 'trailing_stop';
      } else if (position.direction === 'short' && currentPrice >= position.trailingStopPrice) {
        shouldExit = true;
        exitReason = 'trailing_stop';
      }
    }

    // 2. 检查传统止损 (仅在trailing stop未激活时)
    if (!shouldExit && position.stop_loss !== null) {
      if (position.direction === 'long' && currentPrice <= position.stop_loss) {
        shouldExit = true;
        exitReason = 'stop_loss';
      } else if (position.direction === 'short' && currentPrice >= position.stop_loss) {
        shouldExit = true;
        exitReason = 'stop_loss';
      }
    }

    // 3. 检查止盈
    if (!shouldExit && position.take_profit !== null) {
      if (position.direction === 'long' && currentPrice >= position.take_profit) {
        shouldExit = true;
        exitReason = 'take_profit';
      } else if (position.direction === 'short' && currentPrice <= position.take_profit) {
        shouldExit = true;
        exitReason = 'take_profit';
      }
    }

    // 4. RSI回归退出
    if (!shouldExit && this.enableRSIReversion) {
      const currentRSI = this.rsiValues[index] ?? null;
      if (currentRSI !== null) {
        // 多头持仓: RSI回到50以上退出
        if (position.direction === 'long' && currentRSI > 50) {
          shouldExit = true;
          exitReason = 'rsi_revert';
        }
        // 空头持仓: RSI回到50以下退出
        if (position.direction === 'short' && currentRSI < 50) {
          shouldExit = true;
          exitReason = 'rsi_revert';
        }
      }
    }

    // 5. 检查持仓时间
    if (!shouldExit && position.hold_minutes !== null) {
      const holdMinutes = (currentTime - position.entry_time) / (1000 * 60);
      if (holdMinutes >= position.hold_minutes) {
        shouldExit = true;
        exitReason = 'hold_time_reached';
      }
    }

    // 6. 不隔夜检查
    if (!shouldExit) {
      const entryDate = new Date(position.entry_time);
      const entryDay = entryDate.getUTCDate();
      const currentDay = currentDate.getUTCDate();
      const entryMonth = entryDate.getUTCMonth();
      const currentMonth = currentDate.getUTCMonth();
      const entryYear = entryDate.getUTCFullYear();
      const currentYear = currentDate.getUTCFullYear();

      if (entryYear !== currentYear || entryMonth !== currentMonth || entryDay !== currentDay) {
        shouldExit = true;
        exitReason = 'no_overnight';
      }
    }

    // 7. 不隔周检查
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
      this.closePosition(kline, currentPrice, exitReason);
    }
  }

  /**
   * 平仓
   */
  private closePosition(kline: KlineData, exitPrice: number, exitReason: ExitReason): void {
    const position = this.positions.shift();
    if (!position) return;

    // 计算盈亏
    const pnl = this.calculatePnL(position, exitPrice);

    const trade: TradeRecord = {
      direction: position.direction,
      entry_time: position.entry_time,
      entry_price: position.entry_price,
      entry_index: position.entry_index,
      entry_rsi: position.entry_rsi,
      lot_size: position.lot_size,
      stop_loss: position.stop_loss,
      take_profit: position.take_profit,
      hold_minutes: position.hold_minutes,
      strategy_name: position.strategy_name,
      symbol: position.symbol,
      exit_time: parseInt(kline.open_time),
      exit_price: exitPrice,
      exit_reason: exitReason,
      pnl,
      actual_hold_minutes: (parseInt(kline.open_time) - position.entry_time) / (1000 * 60)
    };

    this.closedTrades.push(trade);
  }

  /**
   * 计算盈亏
   */
  private calculatePnL(position: InternalPosition, exitPrice: number): number {
    const entryPrice = position.entry_price;
    const lotSize = position.lot_size;

    // USDJPY: 1 lot = 100,000 units
    // 0.1 lot = 10,000 units
    // 1 pip (0.01) movement = $10 per lot
    const units = lotSize * 100000;
    const pipValue = units / 100; // $100 per pip for 0.1 lot

    let priceDiff: number;
    if (position.direction === 'long') {
      priceDiff = exitPrice - entryPrice;
    } else {
      priceDiff = entryPrice - exitPrice;
    }

    // 将价格差转换为pips (USDJPY: 1 pip = 0.01)
    const pips = priceDiff / 0.01;

    // 计算美元盈亏
    const pnl = pips * (pipValue / 100);

    return pnl;
  }

  /**
   * 执行策略回测
   */
  async execute(): Promise<BacktestResult> {
    for (let i = 0; i < this.klines.length; i++) {
      const kline = this.klines[i];
      if (!kline) continue;

      const currentTime = new Date(kline.open_time);

      // 检查退出条件
      this.checkExitConditions(i, kline);

      // 检查入场条件
      if (this.positions.length === 0 && this.isTradingAllowed(currentTime)) {
        const signal = this.getSignal(i);
        if (signal !== 'hold') {
          this.openPosition(kline, signal, i);
        }
      }
    }

    // 强制平仓剩余持仓
    while (this.positions.length > 0) {
      const lastKline = this.klines[this.klines.length - 1];
      if (!lastKline) break;

      const firstPosition = this.positions[0];
      if (!firstPosition) break;

      const exitPrice = this.slippageModel
        ? this.slippageModel.getExecutionPrice(lastKline, firstPosition.direction, false)
        : parseFloat(lastKline.close);
      this.closePosition(lastKline, exitPrice, 'backtest_end');
    }

    return this.calculateStats();
  }

  /**
   * 计算统计数据
   */
  private calculateStats(): BacktestResult {
    const trades = this.closedTrades;
    const totalTrades = trades.length;

    if (totalTrades === 0) {
      const emptyStats: BacktestStats = {
        totalTrades: 0,
        totalPnl: 0,
        winRate: 0,
        avgPnl: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        score: 0
      };
      return {
        stats: emptyStats,
        trades: []
      };
    }

    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const winners = trades.filter(t => t.pnl > 0);
    const losers = trades.filter(t => t.pnl < 0);
    const winRate = winners.length / totalTrades;
    const avgPnl = totalPnl / totalTrades;

    // 计算最大回撤
    let peak = 0;
    let maxDrawdown = 0;
    let runningPnl = 0;

    trades.forEach(t => {
      runningPnl += t.pnl;
      if (runningPnl > peak) peak = runningPnl;
      const drawdown = peak - runningPnl;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    // 计算夏普比率
    const returns = trades.map(t => t.pnl);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

    const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : 0;
    const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + t.pnl, 0) / losers.length : 0;
    const profitFactor = losers.length > 0
      ? Math.abs(winners.reduce((s, t) => s + t.pnl, 0) / losers.reduce((s, t) => s + t.pnl, 0))
      : Infinity;

    // 计算综合评分
    const score = totalPnl * winRate * sharpeRatio / (Math.abs(maxDrawdown) + 1);

    const stats: BacktestStats = {
      totalTrades,
      totalPnl,
      winRate,
      avgPnl,
      maxDrawdown: -maxDrawdown,
      sharpeRatio,
      avgWin,
      avgLoss,
      profitFactor,
      score
    };

    return {
      stats,
      trades
    };
  }
}
