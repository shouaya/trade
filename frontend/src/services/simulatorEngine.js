import { resolveFeeModel, resolveSymbolSpec } from './simulatorConfig.js';
import * as simulatorCore from '@money/simulator';

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseIntervalMs(interval) {
  const normalized = String(interval || '1m').trim().toLowerCase();
  const match = normalized.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    return 60 * 1000;
  }

  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  return value * DAY_MS;
}

export function getReferencePrice(kline, direction, isEntry) {
  return simulatorCore.getReferencePrice(kline, direction, isEntry);
}

function getTriggerPrice(kline, direction, reason, fallbackPrice) {
  return simulatorCore.getTriggerPrice(kline, direction, reason, fallbackPrice);
}

export function calculateTradeOutcome(trade, exitPrice, exitTime, exitIndex, klineData = []) {
  const outcome = simulatorCore.calculateTradeOutcome({
    position: {
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      lotSize: Number(trade.quantity),
      entryTime: trade.entryTime,
      entryIndex: trade.entryIndex,
    },
    exitPrice,
    exitTime,
    exitIndex,
    feeModel: trade.feeModel ?? resolveFeeModel(trade.symbol),
    symbolSpec: trade.symbolSpec,
    klines: klineData,
    activationIndex: trade.activationIndex ?? trade.entryIndex ?? 0,
  });
  return {
    exitTime,
    exitPrice,
    grossPnl: Number(outcome.grossPnl.toFixed(2)),
    commissionFee: Number(outcome.commissionFee.toFixed(2)),
    pnl: Number(outcome.netPnl.toFixed(2)),
    pips: Number(outcome.pips.toFixed(2)),
    percent: Number(outcome.percent.toFixed(4)),
    holdMinutes: Math.max(0, Math.round((exitTime - trade.entryTime) / 60000)),
  };
}

export function createManualTrade({
  symbol,
  interval,
  currentIndex,
  klineData,
  tradeParams,
  entryIndicators,
}) {
  const currentKline = klineData[currentIndex];
  if (!currentKline) {
    throw new Error('当前 K 线不存在，无法创建交易');
  }

  const symbolSpec = resolveSymbolSpec(symbol);
  const feeModel = resolveFeeModel(symbol);
  const intervalMs = parseIntervalMs(interval);
  const entryTime = Number(currentKline.openTime) + intervalMs;
  const entryPrice = tradeParams.entryPrice ?? getReferencePrice(currentKline, tradeParams.direction, true);

  return {
    direction: tradeParams.direction,
    symbol,
    symbolSpec,
    feeModel,
    quantity: Number(tradeParams.quantity),
    holdMinutes: Number(tradeParams.holdMinutes),
    stopLoss: tradeParams.stopLoss,
    takeProfit: tradeParams.takeProfit,
    entryTime,
    entryPrice,
    entryIndex: currentIndex,
    activationIndex: currentIndex + 1,
    entryRsi: entryIndicators?.rsi ?? null,
    entryMacd: entryIndicators?.macd ?? null,
    entryMacdSignal: entryIndicators?.macdSignal ?? null,
    entryMacdHistogram: entryIndicators?.macdHistogram ?? null,
  };
}

export function evaluateTradeOnKline({
  trade,
  currentIndex,
  currentKline,
  klineData,
  exitIndicators,
}) {
  if (!trade || !currentKline || currentIndex < (trade.activationIndex ?? 0)) {
    return null;
  }

  const currentTime = Number(currentKline.openTime);
  const elapsedMinutes = (currentTime - trade.entryTime) / 60000;
  const exitReferencePrice = getReferencePrice(currentKline, trade.direction, false);

  let exitReason = null;
  let exitPrice = null;

  if (trade.stopLoss !== null && trade.stopLoss !== undefined) {
    const stopTriggerPrice = getTriggerPrice(currentKline, trade.direction, 'stop_loss', exitReferencePrice);
    if (trade.direction === 'long' && stopTriggerPrice <= trade.stopLoss) {
      exitReason = 'stop_loss';
      exitPrice = trade.stopLoss;
    } else if (trade.direction === 'short' && stopTriggerPrice >= trade.stopLoss) {
      exitReason = 'stop_loss';
      exitPrice = trade.stopLoss;
    }
  }

  if (!exitReason && trade.takeProfit !== null && trade.takeProfit !== undefined) {
    const takeTriggerPrice = getTriggerPrice(currentKline, trade.direction, 'take_profit', exitReferencePrice);
    if (trade.direction === 'long' && takeTriggerPrice >= trade.takeProfit) {
      exitReason = 'take_profit';
      exitPrice = trade.takeProfit;
    } else if (trade.direction === 'short' && takeTriggerPrice <= trade.takeProfit) {
      exitReason = 'take_profit';
      exitPrice = trade.takeProfit;
    }
  }

  if (!exitReason && elapsedMinutes >= trade.holdMinutes) {
    exitReason = 'hold_time_reached';
    exitPrice = exitReferencePrice;
  }

  if (!exitReason || exitPrice === null) {
    return null;
  }

  const outcome = calculateTradeOutcome(trade, exitPrice, currentTime, currentIndex, klineData);
  return {
    ...outcome,
    exitReason,
    exitRsi: exitIndicators?.rsi ?? null,
    exitMacd: exitIndicators?.macd ?? null,
    exitMacdSignal: exitIndicators?.macdSignal ?? null,
    exitMacdHistogram: exitIndicators?.macdHistogram ?? null,
  };
}
