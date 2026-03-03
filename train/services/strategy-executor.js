/**
 * Strategy Executor - 策略执行引擎
 * 在历史K线上模拟执行交易策略
 */

const SignalGenerator = require('./signal-generator');
const { initializeGrid } = require('./indicators/grid');
const { TradingSchedule } = require('./trading-schedule');

class StrategyExecutor {
  constructor(strategy, klines) {
    this.strategy = strategy;
    this.klines = klines;
    this.positions = [];       // 当前持仓
    this.closedTrades = [];    // 已平仓交易
    this.grid = null;

    // 初始化网格(如果启用)
    if (strategy.parameters.grid && strategy.parameters.grid.enabled) {
      this.grid = initializeGrid(klines, strategy.parameters.grid);
    }

    // 初始化交易时间表 (如果设置了)
    const scheduleExpr = strategy.parameters.tradingSchedule || 'AVOID_SPREAD';
    this.tradingSchedule = new TradingSchedule(scheduleExpr);

    // 初始化信号生成器(传递klines以预计算RSI/MACD)
    this.signalGenerator = new SignalGenerator(strategy, this.grid, klines);
  }

  /**
   * 执行策略回测
   * @param {boolean} verbose - 是否显示详细日志
   * @returns {Object} { trades, stats }
   */
  async execute(verbose = false) {
    // 遍历每根K线
    for (let i = 0; i < this.klines.length; i++) {
      const kline = this.klines[i];
      const currentTime = new Date(parseInt(kline.open_time));

      // 1. 先检查持仓是否需要平仓 (包括不隔夜/不隔周检查)
      this.checkExitConditions(i, kline);

      // 2. 检查是否在允许交易的时段
      if (!this.isTradingAllowed(currentTime)) {
        continue; // 跳过此K线,不产生新信号
      }

      // 3. 生成入场信号
      const signals = this.signalGenerator.generate(this.klines, i, this.positions);

      // 4. 判断是否可以开仓
      if (signals.combined && signals.combined.action) {
        if (signals.combined.action === 'BUY' && this.canOpenPosition('long')) {
          this.openPosition('long', i, kline, signals);
        } else if (signals.combined.action === 'SELL' && this.canOpenPosition('short')) {
          this.openPosition('short', i, kline, signals);
        }
      }
    }

    // 强制平仓所有剩余持仓
    this.closeAllPositions(this.klines.length - 1, this.klines[this.klines.length - 1]);

    // 计算统计数据
    const stats = this.calculateStats();

    return {
      trades: this.closedTrades,
      stats
    };
  }

  /**
   * 判断当前时间是否允许交易
   * 使用trading Schedule进行灵活配置
   * @param {Date} currentTime - 当前时间
   * @returns {boolean}
   */
  isTradingAllowed(currentTime) {
    return this.tradingSchedule.isAllowed(currentTime);
  }

  /**
   * 判断是否可以开仓
   * @param {string} direction - 'long' | 'short'
   * @returns {boolean}
   */
  canOpenPosition(direction) {
    const maxPositions = this.strategy.parameters.risk.maxPositions;
    return this.positions.length < maxPositions;
  }

  /**
   * 开仓
   * @param {string} direction - 'long' | 'short'
   * @param {number} index - K线索引
   * @param {Object} kline - K线数据
   * @param {Object} signals - 信号对象
   */
  openPosition(direction, index, kline, signals) {
    const params = this.strategy.parameters;
    const entryPrice = parseFloat(kline.close);

    // 计算止损止盈 (支持百分比或pips)
    const stopLoss = this.calculateStopLoss(entryPrice, direction, params.risk);
    const takeProfit = this.calculateTakeProfit(entryPrice, direction, params.risk);

    const position = {
      direction,
      entry_time: parseInt(kline.open_time),
      entry_price: entryPrice,
      entry_index: index,
      entry_rsi: signals.rsi ? signals.rsi.value : null,
      entry_macd: signals.macd ? signals.macd.current.macd : null,
      entry_macd_signal: signals.macd ? signals.macd.current.signal : null,
      entry_macd_histogram: signals.macd ? signals.macd.current.histogram : null,
      lot_size: params.risk.lotSize,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      hold_minutes: params.risk.maxHoldMinutes,
      strategy_name: this.strategy.name,
      symbol: 'USDJPY',
      gridLevel: signals.combined.gridLevel || null
    };

    this.positions.push(position);
  }

  /**
   * 检查出场条件
   * @param {number} index - 当前K线索引
   * @param {Object} kline - 当前K线数据
   */
  checkExitConditions(index, kline) {
    const currentPrice = parseFloat(kline.close);
    const currentTime = parseInt(kline.open_time);
    const currentDate = new Date(currentTime);

    for (let i = this.positions.length - 1; i >= 0; i--) {
      const position = this.positions[i];
      let shouldExit = false;
      let exitReason = null;

      // 1. 检查止损
      if (position.stop_loss) {
        if (position.direction === 'long' && currentPrice <= position.stop_loss) {
          shouldExit = true;
          exitReason = 'stop_loss';
        } else if (position.direction === 'short' && currentPrice >= position.stop_loss) {
          shouldExit = true;
          exitReason = 'stop_loss';
        }
      }

      // 2. 检查止盈
      if (!shouldExit && position.take_profit) {
        if (position.direction === 'long' && currentPrice >= position.take_profit) {
          shouldExit = true;
          exitReason = 'take_profit';
        } else if (position.direction === 'short' && currentPrice <= position.take_profit) {
          shouldExit = true;
          exitReason = 'take_profit';
        }
      }

      // 3. 检查持仓时间
      if (!shouldExit && position.hold_minutes) {
        const holdMinutes = (currentTime - position.entry_time) / (1000 * 60);
        if (holdMinutes >= position.hold_minutes) {
          shouldExit = true;
          exitReason = 'hold_time_reached';
        }
      }

      // 4. 不隔夜检查 - 如果当前K线的日期与入场日期不同,立即平仓
      if (!shouldExit) {
        const entryDate = new Date(position.entry_time);
        const entryDay = entryDate.getUTCDate();
        const currentDay = currentDate.getUTCDate();
        const entryMonth = entryDate.getUTCMonth();
        const currentMonth = currentDate.getUTCMonth();
        const entryYear = entryDate.getUTCFullYear();
        const currentYear = currentDate.getUTCFullYear();

        // 如果年、月、日中任何一个不同,说明跨日了
        if (entryYear !== currentYear || entryMonth !== currentMonth || entryDay !== currentDay) {
          shouldExit = true;
          exitReason = 'no_overnight';
        }
      }

      // 5. 不隔周检查 - 周五必须平仓
      if (!shouldExit) {
        const dayOfWeek = currentDate.getUTCDay();
        // 如果是周五 (5) 且接近收盘 (比如UTC 20:00之后),强制平仓
        // 或者如果是周六/周日,立即平仓 (虽然理论上不应该有持仓到周末)
        if (dayOfWeek === 5 && currentDate.getUTCHours() >= 20) {
          shouldExit = true;
          exitReason = 'no_weekend';
        } else if (dayOfWeek === 0 || dayOfWeek === 6) {
          shouldExit = true;
          exitReason = 'weekend_forced_close';
        }
      }

      // 执行平仓
      if (shouldExit) {
        this.closePosition(position, index, kline, exitReason);
        this.positions.splice(i, 1);
      }
    }
  }

  /**
   * 平仓
   * @param {Object} position - 持仓对象
   * @param {number} index - K线索引
   * @param {Object} kline - K线数据
   * @param {string} exitReason - 平仓原因
   */
  closePosition(position, index, kline, exitReason) {
    const exitPrice = parseFloat(kline.close);
    const exitTime = parseInt(kline.open_time);

    // 计算盈亏
    const pnl = this.calculatePnL(position, exitPrice);
    const pips = this.calculatePips(position, exitPrice);
    const percent = ((exitPrice - position.entry_price) / position.entry_price) * 100;
    const actualHoldMinutes = (exitTime - position.entry_time) / (1000 * 60);

    // 获取出场时的指标值
    const signals = this.signalGenerator.generate(this.klines, index, this.positions);

    const trade = {
      ...position,
      exit_time: exitTime,
      exit_price: exitPrice,
      exit_rsi: signals.rsi ? signals.rsi.value : null,
      exit_macd: signals.macd ? signals.macd.current.macd : null,
      exit_macd_signal: signals.macd ? signals.macd.current.signal : null,
      exit_macd_histogram: signals.macd ? signals.macd.current.histogram : null,
      exit_reason: exitReason,
      pnl: parseFloat(pnl.toFixed(2)),
      pips: parseFloat(pips.toFixed(2)),
      percent: parseFloat(percent.toFixed(4)),
      actual_hold_minutes: Math.round(actualHoldMinutes)
    };

    this.closedTrades.push(trade);
  }

  /**
   * 强制平仓所有持仓
   */
  closeAllPositions(index, kline) {
    while (this.positions.length > 0) {
      const position = this.positions.pop();
      this.closePosition(position, index, kline, 'forced_close');
    }
  }

  /**
   * 计算止损价格
   */
  calculateStopLoss(entryPrice, direction, riskParams) {
    // 优先使用百分比,向后兼容pips
    const stopLossPercent = riskParams.stopLossPercent;
    const stopLossPips = riskParams.stopLossPips;

    if (stopLossPercent != null) {
      // 使用百分比计算
      const stopLossDistance = entryPrice * (stopLossPercent / 100);
      if (direction === 'long') {
        return entryPrice - stopLossDistance;
      } else {
        return entryPrice + stopLossDistance;
      }
    } else if (stopLossPips != null) {
      // 向后兼容: 使用pips计算
      const pipValue = 0.01; // USD/JPY 1 pip = 0.01
      const stopLossDistance = stopLossPips * pipValue;
      if (direction === 'long') {
        return entryPrice - stopLossDistance;
      } else {
        return entryPrice + stopLossDistance;
      }
    }

    return null;
  }

  /**
   * 计算止盈价格
   */
  calculateTakeProfit(entryPrice, direction, riskParams) {
    // 优先使用百分比,向后兼容pips
    const takeProfitPercent = riskParams.takeProfitPercent;
    const takeProfitPips = riskParams.takeProfitPips;

    if (takeProfitPercent != null) {
      // 使用百分比计算
      const takeProfitDistance = entryPrice * (takeProfitPercent / 100);
      if (direction === 'long') {
        return entryPrice + takeProfitDistance;
      } else {
        return entryPrice - takeProfitDistance;
      }
    } else if (takeProfitPips != null) {
      // 向后兼容: 使用pips计算
      const pipValue = 0.01;
      const takeProfitDistance = takeProfitPips * pipValue;
      if (direction === 'long') {
        return entryPrice + takeProfitDistance;
      } else {
        return entryPrice - takeProfitDistance;
      }
    }

    return null;
  }

  /**
   * 计算盈亏 (USD)
   */
  calculatePnL(position, exitPrice) {
    const pipValue = 0.01;
    const lotSize = position.lot_size;
    const contractSize = 1000; // 微型手

    let pips;
    if (position.direction === 'long') {
      pips = (exitPrice - position.entry_price) / pipValue;
    } else {
      pips = (position.entry_price - exitPrice) / pipValue;
    }

    return pips * lotSize * contractSize * (pipValue / 100);
  }

  /**
   * 计算盈亏 (pips)
   */
  calculatePips(position, exitPrice) {
    const pipValue = 0.01;

    if (position.direction === 'long') {
      return (exitPrice - position.entry_price) / pipValue;
    } else {
      return (position.entry_price - exitPrice) / pipValue;
    }
  }

  /**
   * 计算统计数据
   */
  calculateStats() {
    const trades = this.closedTrades;

    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnl: 0,
        avgPnl: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        profitFactor: 0,
        grossProfit: 0,
        grossLoss: 0
      };
    }

    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.pnl > 0).length;
    const losingTrades = trades.filter(t => t.pnl <= 0).length;
    const winRate = winningTrades / totalTrades;

    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const avgPnl = totalPnl / totalTrades;

    // 计算夏普比率
    const returns = trades.map(t => t.percent / 100);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    // 计算最大回撤 (使用初始资金10000作为基准)
    const INITIAL_CAPITAL = 10000; // 初始资金
    let peak = INITIAL_CAPITAL;
    let maxDrawdown = 0;
    let equity = INITIAL_CAPITAL;

    trades.forEach(t => {
      equity += t.pnl;
      if (equity > peak) peak = equity;
      const drawdown = (peak - equity) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    // 盈利因子
    const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(trades.filter(t => t.pnl <= 0).reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      totalPnl,
      avgPnl,
      sharpeRatio,
      maxDrawdown,
      profitFactor,
      grossProfit,
      grossLoss
    };
  }
}

module.exports = StrategyExecutor;
