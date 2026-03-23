import { getMidPrice } from './pricing.js';
import { enumerateJstSettlementTimes, getPriceSnapshotOpenTime } from './time.js';
import { calculatePnL, getPositionUnits, getPriceDiff } from './pnl.js';
import type {
  ExecutionPositionSnapshot,
  FeeModelConfig,
  PriceSnapshot,
  SymbolSpec,
  TradeOutcome,
} from './types.js';

export function findSettlementMarkPrice(
  klines: readonly PriceSnapshot[],
  startIndex: number,
  endIndex: number,
  settlementTime: number,
  fallbackPrice: number
): number {
  for (let index = startIndex; index <= endIndex; index += 1) {
    const kline = klines[index];
    if (!kline) {
      continue;
    }

    const openTime = getPriceSnapshotOpenTime(kline);
    if (openTime === null || openTime < settlementTime) {
      continue;
    }

    return getMidPrice(kline);
  }

  return fallbackPrice;
}

export function calculateCommissionFee(params: {
  readonly position: ExecutionPositionSnapshot;
  readonly exitPrice: number;
  readonly exitTime: number;
  readonly exitIndex: number;
  readonly feeModel: FeeModelConfig;
  readonly symbolSpec: SymbolSpec;
  readonly klines: readonly PriceSnapshot[];
  readonly activationIndex?: number;
}): number {
  const {
    position,
    exitPrice,
    exitTime,
    exitIndex,
    feeModel,
    symbolSpec,
    klines,
    activationIndex,
  } = params;

  const rate = feeModel.commissionRate;
  const units = getPositionUnits(position.lotSize, symbolSpec);
  let totalFee = 0;

  if (feeModel.chargeOnEntry && rate > 0) {
    totalFee += units * position.entryPrice * rate;
  }

  if (feeModel.chargeOnExit && rate > 0) {
    totalFee += units * exitPrice * rate;
  }

  if (feeModel.market !== 'exchange-leverage') {
    return totalFee;
  }

  const dailyLeverageRate = feeModel.dailyLeverageRate ?? 0;
  if (dailyLeverageRate <= 0) {
    return totalFee;
  }

  const settlementHourJst = feeModel.settlementHourJst;
  if (settlementHourJst === undefined) {
    throw new Error('executor.options.feeModel.settlementHourJst is required for exchange-leverage market');
  }

  const settlementTimes = enumerateJstSettlementTimes(position.entryTime, exitTime, settlementHourJst);
  for (const settlementTime of settlementTimes) {
    const markPrice = findSettlementMarkPrice(
      klines,
      activationIndex ?? position.entryIndex,
      exitIndex,
      settlementTime,
      exitPrice
    );
    totalFee += units * markPrice * dailyLeverageRate;
  }

  return totalFee;
}

export function calculateTradeOutcome(params: {
  readonly position: ExecutionPositionSnapshot;
  readonly exitPrice: number;
  readonly exitTime: number;
  readonly exitIndex: number;
  readonly feeModel: FeeModelConfig;
  readonly symbolSpec: SymbolSpec;
  readonly klines: readonly PriceSnapshot[];
  readonly activationIndex?: number;
}): TradeOutcome {
  const {
    position,
    exitPrice,
    exitTime,
    exitIndex,
    feeModel,
    symbolSpec,
    klines,
    activationIndex,
  } = params;

  const priceDiff = getPriceDiff(position.direction, position.entryPrice, exitPrice);
  const grossPnl = calculatePnL(position.direction, position.entryPrice, exitPrice, position.lotSize, symbolSpec);
  const commissionFee = calculateCommissionFee(
    activationIndex === undefined
      ? {
          position,
          exitPrice,
          exitTime,
          exitIndex,
          feeModel,
          symbolSpec,
          klines,
        }
      : {
          position,
          exitPrice,
          exitTime,
          exitIndex,
          feeModel,
          symbolSpec,
          klines,
          activationIndex,
        }
  );
  const netPnl = grossPnl - commissionFee;
  const percent = position.entryPrice !== 0 ? (priceDiff / position.entryPrice) * 100 : 0;

  return {
    grossPnl,
    commissionFee,
    netPnl,
    pips: priceDiff / symbolSpec.pipSize,
    percent,
  };
}
