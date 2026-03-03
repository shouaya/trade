/**
 * Strategy Parameter Generator - 策略参数组合生成器
 * 生成大量策略参数组合用于批量回测
 */

/**
 * 策略参数空间定义
 */
const PARAMETER_SPACE = {
  // 网格策略参数
  grid: {
    levels: [5, 10, 20],
    rangePercent: [0.5, 1, 2],
    profitPerGrid: [0.1, 0.2, 0.3]
  },

  // RSI参数 (只保留标准14周期)
  rsi: {
    period: [14],
    oversold: [20, 25, 30],
    overbought: [70, 75, 80]
  },

  // MACD参数 (仅用于记录，不作为策略条件)
  macd: {
    fastPeriod: [12],    // 标准参数
    slowPeriod: [26],    // 标准参数
    signalPeriod: [9]    // 标准参数
  },

  // 风控参数 (优化版 - 使用百分比代替pips)
  risk: {
    maxPositions: [1],   // 只保留单仓位
    lotSize: [0.1],
    stopLossPercent: [null, 0.1, 0.15, 0.2, 0.25, 0.3],     // 6种: 无, 0.1%, 0.15%, 0.2%, 0.25%, 0.3%
    takeProfitPercent: [null, 0.2, 0.3, 0.5, 0.7, 1.0, 1.5], // 7种: 无, 0.2%, 0.3%, 0.5%, 0.7%, 1.0%, 1.5%
    maxHoldMinutes: [30, 60, 120, 180, 240, 360, 480, 720]  // 8种: 0.5h~12h (去掉1440避免小样本)
  }
};

/**
 * 生成所有策略组合
 * @param {Object} options - 选项 { limit: 限制数量, types: 策略类型数组 }
 * @returns {Array} 策略数组
 */
function generateStrategyCombinations(options = {}) {
  const { limit = null, types = null } = options;
  const strategies = [];
  let id = 1;

  // 默认生成所有类型
  const strategyTypes = types || [
    'grid_only',
    'rsi_only',
    'macd_only',
    'rsi_and_macd',
    'rsi_or_macd'
  ];

  // 1. 纯网格策略
  if (strategyTypes.includes('grid_only')) {
    for (const levels of PARAMETER_SPACE.grid.levels) {
      for (const range of PARAMETER_SPACE.grid.rangePercent) {
        for (const profit of PARAMETER_SPACE.grid.profitPerGrid) {
          for (const maxPos of PARAMETER_SPACE.risk.maxPositions) {
            for (const sl of PARAMETER_SPACE.risk.stopLossPercent) {
              for (const tp of PARAMETER_SPACE.risk.takeProfitPercent) {
                for (const hold of PARAMETER_SPACE.risk.maxHoldMinutes) {
                  strategies.push({
                    id: id++,
                    name: `Grid-L${levels}-R${range}-P${profit}-MP${maxPos}-SL${sl}-TP${tp}-H${hold}`,
                    type: 'grid_only',
                    parameters: {
                      grid: { enabled: true, levels, rangePercent: range, profitPerGrid: profit },
                      rsi: { enabled: false },
                      macd: { enabled: false },
                      risk: {
                        maxPositions: maxPos,
                        lotSize: 0.1,
                        stopLossPercent: sl,
                        takeProfitPercent: tp,
                        maxHoldMinutes: hold
                      }
                    }
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  // 2. 纯RSI策略
  if (strategyTypes.includes('rsi_only')) {
    for (const period of PARAMETER_SPACE.rsi.period) {
      for (const oversold of PARAMETER_SPACE.rsi.oversold) {
        for (const overbought of PARAMETER_SPACE.rsi.overbought) {
          if (overbought <= oversold + 30) continue; // 确保区间合理

          for (const maxPos of PARAMETER_SPACE.risk.maxPositions) {
            for (const hold of PARAMETER_SPACE.risk.maxHoldMinutes) {
              for (const sl of PARAMETER_SPACE.risk.stopLossPercent) {
                for (const tp of PARAMETER_SPACE.risk.takeProfitPercent) {
                  strategies.push({
                    id: id++,
                    name: `RSI-P${period}-OS${oversold}-OB${overbought}-MP${maxPos}-H${hold}-SL${sl}-TP${tp}`,
                    type: 'rsi_only',
                    parameters: {
                      grid: { enabled: false },
                      rsi: { enabled: true, period, oversold, overbought },
                      macd: { enabled: false },
                      risk: {
                        maxPositions: maxPos,
                        lotSize: 0.1,
                        stopLossPercent: sl,
                        takeProfitPercent: tp,
                        maxHoldMinutes: hold
                      }
                    }
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  // 3. 纯MACD策略
  if (strategyTypes.includes('macd_only')) {
    for (const fast of PARAMETER_SPACE.macd.fastPeriod) {
      for (const slow of PARAMETER_SPACE.macd.slowPeriod) {
        for (const signal of PARAMETER_SPACE.macd.signalPeriod) {
          for (const maxPos of PARAMETER_SPACE.risk.maxPositions) {
            for (const hold of PARAMETER_SPACE.risk.maxHoldMinutes) {
              for (const sl of PARAMETER_SPACE.risk.stopLossPercent) {
                for (const tp of PARAMETER_SPACE.risk.takeProfitPercent) {
                  strategies.push({
                    id: id++,
                    name: `MACD-F${fast}-S${slow}-Sig${signal}-MP${maxPos}-H${hold}-SL${sl}-TP${tp}`,
                    type: 'macd_only',
                    parameters: {
                      grid: { enabled: false },
                      rsi: { enabled: false },
                      macd: { enabled: true, fastPeriod: fast, slowPeriod: slow, signalPeriod: signal },
                      risk: {
                        maxPositions: maxPos,
                        lotSize: 0.1,
                        stopLossPercent: sl,
                        takeProfitPercent: tp,
                        maxHoldMinutes: hold
                      }
                    }
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  // 4. RSI + MACD 组合策略 (AND逻辑)
  if (strategyTypes.includes('rsi_and_macd')) {
    for (const rsiPeriod of PARAMETER_SPACE.rsi.period) {
      for (const oversold of PARAMETER_SPACE.rsi.oversold) {
        for (const overbought of PARAMETER_SPACE.rsi.overbought) {
          if (overbought <= oversold + 30) continue;

          for (const fast of PARAMETER_SPACE.macd.fastPeriod) {
            for (const slow of PARAMETER_SPACE.macd.slowPeriod) {
              for (const signal of PARAMETER_SPACE.macd.signalPeriod) {
                for (const maxPos of PARAMETER_SPACE.risk.maxPositions) {
                  for (const hold of PARAMETER_SPACE.risk.maxHoldMinutes) {
                    for (const sl of PARAMETER_SPACE.risk.stopLossPercent) {
                      for (const tp of PARAMETER_SPACE.risk.takeProfitPercent) {
                        strategies.push({
                          id: id++,
                          name: `RSI${rsiPeriod}_AND_MACD${fast}-${slow}-MP${maxPos}-H${hold}-SL${sl}-TP${tp}`,
                          type: 'rsi_and_macd',
                          parameters: {
                            grid: { enabled: false },
                            rsi: { enabled: true, period: rsiPeriod, oversold, overbought },
                            macd: { enabled: true, fastPeriod: fast, slowPeriod: slow, signalPeriod: signal },
                            risk: {
                              maxPositions: maxPos,
                              lotSize: 0.1,
                              stopLossPercent: sl,
                              takeProfitPercent: tp,
                              maxHoldMinutes: hold
                            },
                            entryLogic: 'AND'
                          }
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // 5. RSI + MACD 组合策略 (OR逻辑)
  if (strategyTypes.includes('rsi_or_macd')) {
    for (const rsiPeriod of PARAMETER_SPACE.rsi.period) {
      for (const oversold of PARAMETER_SPACE.rsi.oversold) {
        for (const overbought of PARAMETER_SPACE.rsi.overbought) {
          if (overbought <= oversold + 30) continue;

          for (const fast of PARAMETER_SPACE.macd.fastPeriod) {
            for (const slow of PARAMETER_SPACE.macd.slowPeriod) {
              for (const signal of PARAMETER_SPACE.macd.signalPeriod) {
                for (const maxPos of PARAMETER_SPACE.risk.maxPositions) {
                  for (const hold of PARAMETER_SPACE.risk.maxHoldMinutes) {
                    for (const sl of PARAMETER_SPACE.risk.stopLossPercent) {
                      for (const tp of PARAMETER_SPACE.risk.takeProfitPercent) {
                        strategies.push({
                          id: id++,
                          name: `RSI${rsiPeriod}_OR_MACD${fast}-${slow}-MP${maxPos}-H${hold}-SL${sl}-TP${tp}`,
                          type: 'rsi_or_macd',
                          parameters: {
                            grid: { enabled: false },
                            rsi: { enabled: true, period: rsiPeriod, oversold, overbought },
                            macd: { enabled: true, fastPeriod: fast, slowPeriod: slow, signalPeriod: signal },
                            risk: {
                              maxPositions: maxPos,
                              lotSize: 0.1,
                              stopLossPercent: sl,
                              takeProfitPercent: tp,
                              maxHoldMinutes: hold
                            },
                            entryLogic: 'OR'
                          }
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`✅ 生成了 ${strategies.length} 个策略组合`);

  // 如果指定了限制,则只返回前N个
  if (limit && limit < strategies.length) {
    console.log(`⚠️  限制为前 ${limit} 个策略`);
    return strategies.slice(0, limit);
  }

  return strategies;
}

/**
 * 按策略类型统计
 */
function countByType(strategies) {
  const counts = {};
  strategies.forEach(s => {
    counts[s.type] = (counts[s.type] || 0) + 1;
  });
  return counts;
}

module.exports = {
  generateStrategyCombinations,
  countByType,
  PARAMETER_SPACE
};
