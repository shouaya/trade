/**
 * Strategy Parameter Generator - RSI-only 参数组合生成器
 */

import type {
  Strategy,
  StrategyType,
  ParameterSpace,
  GenerateOptions,
  TimeRestriction
} from '../types';

interface StrategyParameterOverrides extends Partial<ParameterSpace> {
  readonly tradingSchedule?: string;
  readonly tradingTimeRestriction?: TimeRestriction | null;
}

const DEFAULT_TYPE: StrategyType = 'rsi_only';

/**
 * 策略参数空间定义
 */
export const PARAMETER_SPACE: ParameterSpace = {
  rsi: {
    period: [14],
    oversold: [20, 25, 30],
    overbought: [70, 75, 80]
  },
  risk: {
    maxPositions: [1],
    lotSize: [0.1],
    stopLossPercent: [null, 0.1, 0.15, 0.2, 0.25, 0.3],
    takeProfitPercent: [null, 0.2, 0.3, 0.5, 0.7, 1.0, 1.5],
    maxHoldMinutes: [30, 60, 120, 180, 240, 360, 480, 720]
  }
} as const;

function normalizeTypes(types: readonly StrategyType[] | null): readonly StrategyType[] {
  if (!types || types.length === 0) {
    return [DEFAULT_TYPE];
  }

  const invalidTypes = types.filter(type => type !== DEFAULT_TYPE);
  if (invalidTypes.length > 0) {
    throw new Error(`unsupported strategy types: ${invalidTypes.join(', ')}`);
  }

  return [DEFAULT_TYPE];
}

function mergeParameterSpace(parameters: StrategyParameterOverrides | null): {
  readonly paramSpace: ParameterSpace;
  readonly tradingSchedule: string | undefined;
  readonly tradingTimeRestriction: TimeRestriction | null | undefined;
} {
  return {
    paramSpace: {
      rsi: parameters?.rsi ?? PARAMETER_SPACE.rsi,
      risk: {
        maxPositions: parameters?.risk?.maxPositions ?? PARAMETER_SPACE.risk.maxPositions,
        lotSize: parameters?.risk?.lotSize ?? PARAMETER_SPACE.risk.lotSize,
        stopLossPercent: parameters?.risk?.stopLossPercent ?? PARAMETER_SPACE.risk.stopLossPercent,
        takeProfitPercent: parameters?.risk?.takeProfitPercent ?? PARAMETER_SPACE.risk.takeProfitPercent,
        maxHoldMinutes: parameters?.risk?.maxHoldMinutes ?? PARAMETER_SPACE.risk.maxHoldMinutes
      },
      atr: parameters?.atr ?? null
    },
    tradingSchedule: parameters?.tradingSchedule,
    tradingTimeRestriction: parameters?.tradingTimeRestriction
  };
}

function withCommonOptions(
  base: Strategy['parameters'],
  tradingSchedule: string | undefined,
  tradingTimeRestriction: TimeRestriction | null | undefined
): Strategy['parameters'] {
  return {
    ...base,
    ...(tradingSchedule ? { tradingSchedule } : {}),
    ...(tradingTimeRestriction !== undefined ? { tradingTimeRestriction } : {})
  };
}

function formatHoldLabel(hold: number | null): string {
  return hold === null ? 'dynamic' : String(hold);
}

/**
 * 生成所有策略组合
 */
export function generateStrategyCombinations(options: GenerateOptions = {}): readonly Strategy[] {
  const { limit = null } = options;
  normalizeTypes(options.types ?? null);
  const { paramSpace, tradingSchedule, tradingTimeRestriction } = mergeParameterSpace(
    (options.parameters ?? null) as StrategyParameterOverrides | null
  );

  const strategies: Strategy[] = [];
  let id = 1;

  if (paramSpace.atr?.slMultiplier && paramSpace.atr?.tpMultiplier) {
    for (const period of paramSpace.rsi.period) {
      for (const oversold of paramSpace.rsi.oversold) {
        for (const overbought of paramSpace.rsi.overbought) {
          if (overbought <= oversold + 30) continue;

          for (const maxPos of paramSpace.risk.maxPositions) {
            for (const lotSize of paramSpace.risk.lotSize) {
              for (const hold of paramSpace.risk.maxHoldMinutes) {
                for (const slMult of paramSpace.atr.slMultiplier) {
                  for (const tpMult of paramSpace.atr.tpMultiplier) {
                    strategies.push({
                      id: id++,
                      name: `RSI-P${period}-OS${oversold}-OB${overbought}-MP${maxPos}-LOT${lotSize}-H${formatHoldLabel(hold)}-ATRSL${slMult}-ATRTP${tpMult}`,
                      type: DEFAULT_TYPE,
                      parameters: withCommonOptions({
                        rsi: { enabled: true, period, oversold, overbought },
                        risk: {
                          maxPositions: maxPos,
                          lotSize,
                          stopLossPercent: null,
                          takeProfitPercent: null,
                          maxHoldMinutes: hold
                        },
                        atr: {
                          slMultiplier: slMult,
                          tpMultiplier: tpMult
                        }
                      }, tradingSchedule, tradingTimeRestriction)
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  } else {
    for (const period of paramSpace.rsi.period) {
      for (const oversold of paramSpace.rsi.oversold) {
        for (const overbought of paramSpace.rsi.overbought) {
          if (overbought <= oversold + 30) continue;

          for (const maxPos of paramSpace.risk.maxPositions) {
            for (const lotSize of paramSpace.risk.lotSize) {
              for (const hold of paramSpace.risk.maxHoldMinutes) {
                for (const sl of paramSpace.risk.stopLossPercent) {
                  for (const tp of paramSpace.risk.takeProfitPercent) {
                    strategies.push({
                      id: id++,
                      name: `RSI-P${period}-OS${oversold}-OB${overbought}-MP${maxPos}-LOT${lotSize}-H${formatHoldLabel(hold)}-SL${sl}-TP${tp}`,
                      type: DEFAULT_TYPE,
                      parameters: withCommonOptions({
                        rsi: { enabled: true, period, oversold, overbought },
                        risk: {
                          maxPositions: maxPos,
                          lotSize,
                          stopLossPercent: sl,
                          takeProfitPercent: tp,
                          maxHoldMinutes: hold
                        }
                      }, tradingSchedule, tradingTimeRestriction)
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

  console.log(`✅ 生成了 ${strategies.length} 个策略组合`);

  if (limit !== null && limit < strategies.length) {
    console.log(`⚠️  限制为前 ${limit} 个策略`);
    return strategies.slice(0, limit);
  }

  return strategies;
}

export function countByType(strategies: readonly Strategy[]): Record<StrategyType, number> {
  return {
    rsi_only: strategies.filter(strategy => strategy.type === DEFAULT_TYPE).length
  };
}
