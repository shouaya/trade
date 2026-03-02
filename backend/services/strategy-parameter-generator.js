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

  // RSI参数
  rsi: {
    period: [7, 14, 21],
    oversold: [20, 25, 30],
    overbought: [70, 75, 80]
  },

  // MACD参数
  macd: {
    fastPeriod: [8, 12],
    slowPeriod: [21, 26],
    signalPeriod: [7, 9]
  },

  // 风控参数
  risk: {
    maxPositions: [1, 3, 5],
    lotSize: [0.1],
    stopLossPips: [null, 30, 50],
    takeProfitPips: [null, 60, 100],
    maxHoldMinutes: [60, 240, 1440]
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
            for (const sl of PARAMETER_SPACE.risk.stopLossPips) {
              for (const tp of PARAMETER_SPACE.risk.takeProfitPips) {
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
                        stopLossPips: sl,
                        takeProfitPips: tp,
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
              for (const sl of PARAMETER_SPACE.risk.stopLossPips) {
                for (const tp of PARAMETER_SPACE.risk.takeProfitPips) {
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
                        stopLossPips: sl,
                        takeProfitPips: tp,
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
              for (const sl of PARAMETER_SPACE.risk.stopLossPips) {
                for (const tp of PARAMETER_SPACE.risk.takeProfitPips) {
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
                        stopLossPips: sl,
                        takeProfitPips: tp,
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
                    for (const sl of PARAMETER_SPACE.risk.stopLossPips) {
                      for (const tp of PARAMETER_SPACE.risk.takeProfitPips) {
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
                              stopLossPips: sl,
                              takeProfitPips: tp,
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
                    for (const sl of PARAMETER_SPACE.risk.stopLossPips) {
                      for (const tp of PARAMETER_SPACE.risk.takeProfitPips) {
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
                              stopLossPips: sl,
                              takeProfitPips: tp,
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
