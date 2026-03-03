/**
 * Signal Generator - 交易信号生成器
 * 整合RSI、MACD、网格等多种信号源
 */

const { precalculateRSI, generateRSISignal } = require('./indicators/rsi');
const { precalculateMACD, generateMACDSignal } = require('./indicators/macd');
const { generateGridSignal } = require('./indicators/grid');

class SignalGenerator {
  constructor(strategy, grid = null, klines = null) {
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
          params.macd.fastPeriod,
          params.macd.slowPeriod,
          params.macd.signalPeriod
        );
      }
    }
  }

  /**
   * 生成综合交易信号
   * @param {Array} klines - K线数据
   * @param {number} index - 当前索引
   * @param {Array} openPositions - 当前持仓
   * @returns {Object} 信号对象
   */
  generate(klines, index, openPositions = []) {
    const params = this.strategy.parameters;
    const signals = {
      rsi: null,
      macd: null,
      grid: null,
      combined: null
    };

    // 1. 生成RSI信号
    if (params.rsi && params.rsi.enabled) {
      // 使用预计算的RSI值
      const rsiValue = this.cachedRSI ? this.cachedRSI[index] : null;
      const rsiSignal = generateRSISignal(rsiValue, {
        oversold: params.rsi.oversold,
        overbought: params.rsi.overbought
      });

      signals.rsi = {
        value: rsiValue,
        signal: rsiSignal
      };
    }

    // 2. 生成MACD信号
    if (params.macd && params.macd.enabled) {
      // 使用预计算的MACD值
      const currentMACD = this.cachedMACD ? {
        macd: this.cachedMACD.macd[index],
        signal: this.cachedMACD.signal[index],
        histogram: this.cachedMACD.histogram[index]
      } : null;

      const previousMACD = (this.cachedMACD && index > 0) ? {
        macd: this.cachedMACD.macd[index - 1],
        signal: this.cachedMACD.signal[index - 1],
        histogram: this.cachedMACD.histogram[index - 1]
      } : this.previousMACD;

      const macdSignal = generateMACDSignal(currentMACD, previousMACD);

      signals.macd = {
        current: currentMACD,
        signal: macdSignal
      };

      // 更新上一个MACD值
      this.previousMACD = currentMACD;
    }

    // 3. 生成网格信号
    if (params.grid && params.grid.enabled && this.grid) {
      const currentPrice = parseFloat(klines[index].close);
      const gridSignal = generateGridSignal(this.grid, currentPrice, openPositions);

      signals.grid = gridSignal;
    }

    // 4. 组合信号
    signals.combined = this.combineSignals(signals, params);

    return signals;
  }

  /**
   * 组合多个信号源
   * @param {Object} signals - 各指标信号
   * @param {Object} params - 策略参数
   * @returns {Object} { action: 'BUY'|'SELL'|null, reason, confidence }
   */
  combineSignals(signals, params) {
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

      case 'grid_or_indicators':
        return this.gridOrIndicatorsLogic(grid, rsi, macd);

      case 'grid_and_rsi':
        return this.gridAndRsiLogic(grid, rsi);

      case 'all_combined':
        return this.allCombinedLogic(grid, rsi, macd);

      default:
        return { action: null, reason: 'unknown_strategy_type' };
    }
  }

  // ========== 组合逻辑实现 ==========

  gridOnlyLogic(grid) {
    if (!grid) {
      return { action: null, reason: 'no_grid_signal' };
    }

    return {
      action: grid.action,
      reason: grid.reason,
      confidence: 0.7,
      gridLevel: grid.level
    };
  }

  rsiOnlyLogic(rsi) {
    if (!rsi || !rsi.signal) {
      return { action: null, reason: 'no_rsi_signal' };
    }

    return {
      action: rsi.signal,
      reason: `rsi_${rsi.signal.toLowerCase()}`,
      confidence: 0.8,
      rsiValue: rsi.value
    };
  }

  macdOnlyLogic(macd) {
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

  rsiAndMacdLogic(rsi, macd) {
    // 必须两个信号都存在且方向一致
    if (!rsi || !macd || !rsi.signal || !macd.crossSignal) {
      return { action: null, reason: 'waiting_for_both_signals' };
    }

    if (rsi.signal === macd.crossSignal) {
      return {
        action: rsi.signal,
        reason: 'rsi_and_macd_agree',
        confidence: 0.9,
        rsiValue: rsi.value,
        macdValue: macd.value
      };
    }

    return { action: null, reason: 'rsi_macd_disagree' };
  }

  rsiOrMacdLogic(rsi, macd) {
    // 任一信号触发即可
    if (rsi && rsi.signal) {
      return {
        action: rsi.signal,
        reason: 'rsi_triggered',
        confidence: 0.7,
        rsiValue: rsi.value
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

  gridOrIndicatorsLogic(grid, rsi, macd) {
    // 网格信号优先
    if (grid) {
      return {
        action: grid.action,
        reason: 'grid_priority',
        confidence: 0.8,
        gridLevel: grid.level
      };
    }

    // 否则使用指标信号
    return this.rsiOrMacdLogic(rsi, macd);
  }

  gridAndRsiLogic(grid, rsi) {
    // 网格和RSI必须同时满足
    if (!grid || !rsi || !rsi.signal) {
      return { action: null, reason: 'waiting_for_grid_and_rsi' };
    }

    if (grid.action === rsi.signal) {
      return {
        action: grid.action,
        reason: 'grid_and_rsi_agree',
        confidence: 0.85,
        gridLevel: grid.level,
        rsiValue: rsi.value
      };
    }

    return { action: null, reason: 'grid_rsi_disagree' };
  }

  allCombinedLogic(grid, rsi, macd) {
    // 全部信号综合评估
    const buyVotes = [];
    const sellVotes = [];

    if (grid) {
      if (grid.action === 'BUY') buyVotes.push('grid');
      if (grid.action === 'SELL') sellVotes.push('grid');
    }

    if (rsi && rsi.signal) {
      if (rsi.signal === 'BUY') buyVotes.push('rsi');
      if (rsi.signal === 'SELL') sellVotes.push('rsi');
    }

    if (macd && macd.crossSignal) {
      if (macd.crossSignal === 'BUY') buyVotes.push('macd');
      if (macd.crossSignal === 'SELL') sellVotes.push('macd');
    }

    // 多数投票
    if (buyVotes.length > sellVotes.length && buyVotes.length >= 2) {
      return {
        action: 'BUY',
        reason: `combined_buy_${buyVotes.join('+')}`,
        confidence: 0.95,
        votes: { buy: buyVotes.length, sell: sellVotes.length }
      };
    }

    if (sellVotes.length > buyVotes.length && sellVotes.length >= 2) {
      return {
        action: 'SELL',
        reason: `combined_sell_${sellVotes.join('+')}`,
        confidence: 0.95,
        votes: { buy: buyVotes.length, sell: sellVotes.length }
      };
    }

    return { action: null, reason: 'no_consensus' };
  }
}

module.exports = SignalGenerator;
