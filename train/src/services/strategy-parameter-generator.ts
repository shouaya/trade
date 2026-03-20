/**
 * Strategy Parameter Generator
 *
 * Latest train mode only:
 * - RSI + MACD entry
 * - ATR stop loss / take profit
 * - Short intraday holding windows
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

const DEFAULT_TYPE: StrategyType = 'rsi_macd';

export const PARAMETER_SPACE: ParameterSpace = {
  rsi: {
    period: [14],
    oversold: [20, 25, 30],
    overbought: [70, 75, 80]
  },
  risk: {
    maxPositions: [1],
    lotSize: [0.1],
    maxHoldMinutes: [30, 60, 120, 180, 240, 360, 480, 720]
  },
  atr: {
    slMultiplier: [1.5, 2.0],
    tpMultiplier: [1.0, 1.5, 2.0]
  },
  macd: {
    fastPeriod: [6],
    slowPeriod: [13],
    signalPeriod: [4],
    histogramThreshold: [0]
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
        maxHoldMinutes: parameters?.risk?.maxHoldMinutes ?? PARAMETER_SPACE.risk.maxHoldMinutes
      },
      atr: parameters?.atr ?? PARAMETER_SPACE.atr,
      macd: parameters?.macd ?? PARAMETER_SPACE.macd
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

export function generateStrategyCombinations(options: GenerateOptions = {}): readonly Strategy[] {
  const { limit = null } = options;
  normalizeTypes(options.types ?? null);

  const { paramSpace, tradingSchedule, tradingTimeRestriction } = mergeParameterSpace(
    (options.parameters ?? null) as StrategyParameterOverrides | null
  );

  if (!paramSpace.atr?.slMultiplier.length || !paramSpace.atr?.tpMultiplier.length) {
    throw new Error('rsi_macd requires atr parameter space');
  }

  if (!paramSpace.macd?.fastPeriod.length || !paramSpace.macd?.slowPeriod.length || !paramSpace.macd?.signalPeriod.length) {
    throw new Error('rsi_macd requires macd parameter space');
  }

  const histogramThresholds = paramSpace.macd.histogramThreshold?.length
    ? paramSpace.macd.histogramThreshold
    : [0];

  const strategies: Strategy[] = [];
  let id = 1;

  for (const period of paramSpace.rsi.period) {
    for (const oversold of paramSpace.rsi.oversold) {
      for (const overbought of paramSpace.rsi.overbought) {
        if (overbought <= oversold + 20) continue;

        for (const fastPeriod of paramSpace.macd.fastPeriod) {
          for (const slowPeriod of paramSpace.macd.slowPeriod) {
            if (fastPeriod >= slowPeriod) continue;

            for (const signalPeriod of paramSpace.macd.signalPeriod) {
              for (const histogramThreshold of histogramThresholds) {
                for (const maxPos of paramSpace.risk.maxPositions) {
                  for (const lotSize of paramSpace.risk.lotSize) {
                    for (const hold of paramSpace.risk.maxHoldMinutes) {
                      for (const slMult of paramSpace.atr.slMultiplier) {
                        for (const tpMult of paramSpace.atr.tpMultiplier) {
                          strategies.push({
                            id: id++,
                            name: `RSIMACD-RP${period}-OS${oversold}-OB${overbought}-MF${fastPeriod}-MS${slowPeriod}-MSG${signalPeriod}-HT${histogramThreshold}-MP${maxPos}-LOT${lotSize}-H${formatHoldLabel(hold)}-ATRSL${slMult}-ATRTP${tpMult}`,
                            type: DEFAULT_TYPE,
                            parameters: withCommonOptions({
                              rsi: { enabled: true, period, oversold, overbought },
                              macd: {
                                enabled: true,
                                fastPeriod,
                                slowPeriod,
                                signalPeriod,
                                histogramThreshold
                              },
                              risk: {
                                maxPositions: maxPos,
                                lotSize,
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
    rsi_macd: strategies.filter(strategy => strategy.type === DEFAULT_TYPE).length
  };
}
