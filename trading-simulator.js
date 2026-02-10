const fs = require('fs');
const path = require('path');

/**
 * 交易模拟器类
 */
class TradingSimulator {
  constructor(klineData) {
    // 按时间戳排序 K线数据
    this.klineData = klineData.sort((a, b) => parseInt(a.openTime) - parseInt(b.openTime));
    this.createTimeIndex();
  }

  /**
   * 创建时间索引，方便快速查找
   */
  createTimeIndex() {
    this.timeIndex = new Map();
    this.klineData.forEach((kline, index) => {
      this.timeIndex.set(parseInt(kline.openTime), index);
    });
  }

  /**
   * 根据时间戳查找 K线数据索引
   * @param {number} timestamp - Unix 时间戳（毫秒）
   * @returns {number} 索引位置
   */
  findKlineIndex(timestamp) {
    // 精确匹配
    if (this.timeIndex.has(timestamp)) {
      return this.timeIndex.get(timestamp);
    }

    // 找到最接近的时间点（向后查找）
    for (let i = 0; i < this.klineData.length; i++) {
      if (parseInt(this.klineData[i].openTime) >= timestamp) {
        return i;
      }
    }

    return -1; // 未找到
  }

  /**
   * 执行交易模拟
   * @param {Object} trade - 交易参数
   * @returns {Object} 交易结果
   */
  simulateTrade(trade) {
    const {
      entryTime,        // 入场时间（Unix 时间戳毫秒 或 日期字符串）
      direction,        // 方向：'long' 或 'short'
      entryPrice,       // 入场价格（可选，不填则使用实际价格）
      holdMinutes,      // 持仓时间（分钟）
      stopLoss,         // 止损价格（可选）
      takeProfit,       // 止盈价格（可选）
      lotSize = 1       // 仓位大小（手数），默认1手
    } = trade;

    // 转换时间格式
    const entryTimestamp = typeof entryTime === 'string'
      ? new Date(entryTime).getTime()
      : entryTime;

    // 查找入场 K线
    const startIndex = this.findKlineIndex(entryTimestamp);
    if (startIndex === -1) {
      return {
        success: false,
        error: '未找到入场时间对应的数据'
      };
    }

    const entryKline = this.klineData[startIndex];
    const actualEntryPrice = entryPrice || parseFloat(entryKline.close);
    const actualEntryTime = parseInt(entryKline.openTime);

    // 计算预期退出时间
    const expectedExitTime = actualEntryTime + holdMinutes * 60 * 1000;

    // 开始遍历 K线，检查止盈止损触发
    let exitPrice = null;
    let exitTime = null;
    let exitReason = null;
    let exitKline = null;

    for (let i = startIndex + 1; i < this.klineData.length; i++) {
      const kline = this.klineData[i];
      const currentTime = parseInt(kline.openTime);
      const high = parseFloat(kline.high);
      const low = parseFloat(kline.low);
      const close = parseFloat(kline.close);

      // 检查是否超过持仓时间
      if (currentTime >= expectedExitTime) {
        exitPrice = close;
        exitTime = currentTime;
        exitReason = 'hold_time_reached';
        exitKline = kline;
        break;
      }

      // 检查止损和止盈触发
      if (direction === 'long') {
        // 做多：先检查止损（价格下跌），再检查止盈（价格上涨）
        if (stopLoss && low <= stopLoss) {
          exitPrice = stopLoss;
          exitTime = currentTime;
          exitReason = 'stop_loss';
          exitKline = kline;
          break;
        }
        if (takeProfit && high >= takeProfit) {
          exitPrice = takeProfit;
          exitTime = currentTime;
          exitReason = 'take_profit';
          exitKline = kline;
          break;
        }
      } else if (direction === 'short') {
        // 做空：先检查止损（价格上涨），再检查止盈（价格下跌）
        if (stopLoss && high >= stopLoss) {
          exitPrice = stopLoss;
          exitTime = currentTime;
          exitReason = 'stop_loss';
          exitKline = kline;
          break;
        }
        if (takeProfit && low <= takeProfit) {
          exitPrice = takeProfit;
          exitTime = currentTime;
          exitReason = 'take_profit';
          exitKline = kline;
          break;
        }
      }
    }

    // 如果没有退出，说明数据不足
    if (!exitPrice) {
      return {
        success: false,
        error: '数据不足，无法完成交易模拟'
      };
    }

    // 计算损益
    const pnl = this.calculatePnL(
      direction,
      actualEntryPrice,
      exitPrice,
      lotSize
    );

    // 计算实际持仓时间（分钟）
    const actualHoldMinutes = Math.round((exitTime - actualEntryTime) / 60000);

    return {
      success: true,
      entry: {
        time: actualEntryTime,
        datetime: new Date(actualEntryTime).toISOString(),
        price: actualEntryPrice,
        direction: direction
      },
      exit: {
        time: exitTime,
        datetime: new Date(exitTime).toISOString(),
        price: exitPrice,
        reason: exitReason
      },
      result: {
        pnl: pnl.total,
        pnlPips: pnl.pips,
        pnlPercent: pnl.percent,
        holdMinutes: actualHoldMinutes,
        lotSize: lotSize
      },
      parameters: {
        stopLoss: stopLoss || null,
        takeProfit: takeProfit || null,
        expectedHoldMinutes: holdMinutes
      }
    };
  }

  /**
   * 计算损益
   * @param {string} direction - 方向
   * @param {number} entryPrice - 入场价格
   * @param {number} exitPrice - 出场价格
   * @param {number} lotSize - 仓位大小
   * @returns {Object} 损益信息
   */
  calculatePnL(direction, entryPrice, exitPrice, lotSize) {
    let priceDiff;

    if (direction === 'long') {
      priceDiff = exitPrice - entryPrice;
    } else {
      priceDiff = entryPrice - exitPrice;
    }

    // USD/JPY 的点差计算（1 pip = 0.01）
    const pips = priceDiff * 100;

    // 计算百分比收益
    const percent = (priceDiff / entryPrice) * 100;

    // 计算实际收益（假设标准手，1手 = 100,000单位）
    // USD/JPY: 1 pip = $10 per standard lot (100,000 units)
    const pipValue = 10; // 美元
    const total = pips * pipValue * lotSize;

    return {
      pips: parseFloat(pips.toFixed(2)),
      percent: parseFloat(percent.toFixed(4)),
      total: parseFloat(total.toFixed(2))
    };
  }

  /**
   * 批量回测多个交易
   * @param {Array} trades - 交易列表
   * @returns {Object} 回测统计结果
   */
  backtestMultiple(trades) {
    const results = [];
    let totalPnL = 0;
    let winCount = 0;
    let lossCount = 0;
    let totalWin = 0;
    let totalLoss = 0;

    for (const trade of trades) {
      const result = this.simulateTrade(trade);
      if (result.success) {
        results.push(result);

        const pnl = result.result.pnl;
        totalPnL += pnl;

        if (pnl > 0) {
          winCount++;
          totalWin += pnl;
        } else if (pnl < 0) {
          lossCount++;
          totalLoss += Math.abs(pnl);
        }
      } else {
        results.push(result);
      }
    }

    const totalTrades = winCount + lossCount;
    const winRate = totalTrades > 0 ? (winCount / totalTrades * 100) : 0;
    const avgWin = winCount > 0 ? totalWin / winCount : 0;
    const avgLoss = lossCount > 0 ? totalLoss / lossCount : 0;
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : (totalWin > 0 ? Infinity : 0);

    return {
      results,
      statistics: {
        totalTrades,
        winCount,
        lossCount,
        winRate: parseFloat(winRate.toFixed(2)),
        totalPnL: parseFloat(totalPnL.toFixed(2)),
        avgWin: parseFloat(avgWin.toFixed(2)),
        avgLoss: parseFloat(avgLoss.toFixed(2)),
        profitFactor: parseFloat(profitFactor.toFixed(2))
      }
    };
  }
}

/**
 * 格式化输出单个交易结果
 */
function printTradeResult(result, index = null) {
  console.log('='.repeat(70));
  if (index !== null) {
    console.log(`交易 #${index + 1}`);
  }
  console.log('='.repeat(70));

  if (!result.success) {
    console.log(`❌ 交易失败: ${result.error}`);
    console.log('='.repeat(70));
    return;
  }

  const { entry, exit, result: tradeResult, parameters } = result;

  console.log(`📍 入场信息:`);
  console.log(`   时间: ${entry.datetime}`);
  console.log(`   方向: ${entry.direction === 'long' ? '做多 📈' : '做空 📉'}`);
  console.log(`   价格: ${entry.price}`);
  console.log();

  console.log(`🚪 出场信息:`);
  console.log(`   时间: ${exit.datetime}`);
  console.log(`   价格: ${exit.price}`);
  console.log(`   原因: ${getExitReasonText(exit.reason)}`);
  console.log(`   持仓: ${tradeResult.holdMinutes} 分钟 (预期 ${parameters.expectedHoldMinutes} 分钟)`);
  console.log();

  console.log(`💰 交易结果:`);
  const pnlEmoji = tradeResult.pnl > 0 ? '✅' : tradeResult.pnl < 0 ? '❌' : '⚪';
  console.log(`   ${pnlEmoji} 损益: $${tradeResult.pnl} (${tradeResult.pnlPercent > 0 ? '+' : ''}${tradeResult.pnlPercent}%)`);
  console.log(`   点数: ${tradeResult.pnlPips > 0 ? '+' : ''}${tradeResult.pnlPips} pips`);
  console.log(`   仓位: ${tradeResult.lotSize} 手`);
  console.log();

  console.log(`⚙️  参数设置:`);
  console.log(`   止损: ${parameters.stopLoss || '未设置'}`);
  console.log(`   止盈: ${parameters.takeProfit || '未设置'}`);
  console.log('='.repeat(70));
}

/**
 * 获取退出原因文本
 */
function getExitReasonText(reason) {
  const reasons = {
    'stop_loss': '⛔ 触发止损',
    'take_profit': '🎯 触发止盈',
    'hold_time_reached': '⏰ 到达持仓时间'
  };
  return reasons[reason] || reason;
}

/**
 * 格式化输出回测统计
 */
function printBacktestStatistics(stats) {
  console.log('\n');
  console.log('='.repeat(70));
  console.log('📊 回测统计');
  console.log('='.repeat(70));
  console.log(`总交易数: ${stats.totalTrades}`);
  console.log(`盈利次数: ${stats.winCount} | 亏损次数: ${stats.lossCount}`);
  console.log(`胜率: ${stats.winRate}%`);
  console.log(`总损益: $${stats.totalPnL}`);
  console.log(`平均盈利: $${stats.avgWin} | 平均亏损: $${stats.avgLoss}`);
  console.log(`盈亏比: ${stats.profitFactor}`);
  console.log('='.repeat(70));
}

// 导出模块
module.exports = {
  TradingSimulator,
  printTradeResult,
  printBacktestStatistics
};

// 如果直接运行此文件，执行示例
if (require.main === module) {
  console.log('交易模拟器已加载！');
  console.log('请使用 demo.js 查看使用示例');
}
