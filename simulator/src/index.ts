export type {
  ExecutionDirection,
  ExecutionPositionSnapshot,
  FeeModelConfig,
  MarketType,
  PriceSnapshot,
  QuantityMode,
  ResolveVenueFeeModelParams,
  ResolveVenueSymbolSpecParams,
  SymbolSpec,
  TradeOutcome,
  TriggerReason,
  VenueResolver,
} from './types.js';

export { calculateCommissionFee, calculateTradeOutcome, findSettlementMarkPrice } from './fees.js';
export { calculatePnL, getPositionUnits, getPriceDiff } from './pnl.js';
export { getMidPrice, getReferencePrice, getTriggerPrice, readNumericField } from './pricing.js';
export { createDefaultSymbolSpec, GMO_FX_SYMBOLS, isFxSymbol, normalizeSymbol } from './symbols.js';
export { DAY_MS, enumerateJstSettlementTimes, getPriceSnapshotOpenTime, JST_OFFSET_MS } from './time.js';
export { GMO_COIN_LEVERAGE_SYMBOLS, resolveGmoFeeModel, resolveGmoSymbolSpec, gmoVenueResolver } from './venues/gmo.js';
export { getVenueResolver, resolveVenueFeeModel, resolveVenueSymbolSpec } from './venues/index.js';

import { calculateCommissionFee, calculateTradeOutcome, findSettlementMarkPrice } from './fees.js';
import { calculatePnL, getPositionUnits, getPriceDiff } from './pnl.js';
import { getMidPrice, getReferencePrice, getTriggerPrice } from './pricing.js';
import { isFxSymbol } from './symbols.js';
import { enumerateJstSettlementTimes } from './time.js';
import { resolveVenueFeeModel, resolveVenueSymbolSpec } from './venues/index.js';
import type { FeeModelConfig, ResolveVenueFeeModelParams, SymbolSpec } from './types.js';

export function resolveSymbolSpecFromSymbol(rawSymbol: string, override?: SymbolSpec): SymbolSpec {
  return resolveVenueSymbolSpec({
    venue: 'gmo',
    symbol: rawSymbol,
    override,
  });
}

export function resolveGmoSimulatorFeeModel(
  symbolOrParams: string | (ResolveVenueFeeModelParams & { readonly symbol: string })
): FeeModelConfig {
  if (typeof symbolOrParams === 'string') {
    return resolveVenueFeeModel({
      venue: 'gmo',
      symbol: symbolOrParams,
    });
  }

  return resolveVenueFeeModel({
    ...symbolOrParams,
    venue: symbolOrParams.venue ?? 'gmo',
  });
}

const simulatorCore = {
  enumerateJstSettlementTimes,
  isFxSymbol,
  resolveSymbolSpecFromSymbol,
  resolveGmoSimulatorFeeModel,
  resolveVenueSymbolSpec,
  resolveVenueFeeModel,
  getMidPrice,
  getReferencePrice,
  getTriggerPrice,
  getPositionUnits,
  getPriceDiff,
  calculatePnL,
  findSettlementMarkPrice,
  calculateCommissionFee,
  calculateTradeOutcome,
};

export default simulatorCore;
