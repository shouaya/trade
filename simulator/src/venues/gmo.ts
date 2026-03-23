import { createDefaultSymbolSpec, isFxSymbol, normalizeSymbol } from '../symbols.js';
import type {
  FeeModelConfig,
  ResolveVenueFeeModelParams,
  ResolveVenueSymbolSpecParams,
  SymbolSpec,
  VenueResolver,
} from '../types.js';

export const GMO_COIN_LEVERAGE_SYMBOLS = [
  'BTCJPY',
  'ETHJPY',
  'BCHJPY',
  'LTCJPY',
  'XRPJPY',
  'DOTJPY',
  'ATOMJPY',
  'ADAJPY',
  'LINKJPY',
  'DOGEJPY',
  'SOLJPY',
  'SUIJPY',
] as const;

const COIN_LEVERAGE_PRODUCTS: ReadonlySet<string> = new Set<string>([
  ...GMO_COIN_LEVERAGE_SYMBOLS,
]);

function toFxProductCode(symbol: string): string {
  return symbol.replace(/([A-Z]{3})([A-Z]{3})/, '$1_$2');
}

function toCoinProductCode(symbol: string): string {
  return symbol.replace(/([A-Z]+)(JPY|USD|USDT)$/, '$1_$2');
}

function resolveCoinMarketType(params: ResolveVenueFeeModelParams, symbol: string): FeeModelConfig['market'] {
  if (params.market) {
    return params.market;
  }

  return COIN_LEVERAGE_PRODUCTS.has(symbol) ? 'exchange-leverage' : 'spot';
}

export function resolveGmoSymbolSpec(params: ResolveVenueSymbolSpecParams): SymbolSpec {
  return createDefaultSymbolSpec(params.symbol, params.override);
}

export function resolveGmoFeeModel(params: ResolveVenueFeeModelParams): FeeModelConfig {
  const symbol = normalizeSymbol(params.symbol || 'USDJPY');

  if (isFxSymbol(symbol) || params.market === 'fx') {
    return {
      venueCode: 'GMOCOIN_FX_API',
      market: 'fx',
      productCode: toFxProductCode(symbol),
      commissionRate: 0.00002,
      basis: 'notional',
      chargeOnEntry: true,
      chargeOnExit: true,
      leverageMultiplier: 20,
    };
  }

  const market = resolveCoinMarketType(params, symbol);
  return {
    venueCode: 'GMOCOIN',
    market,
    productCode: toCoinProductCode(symbol),
    commissionRate: 0,
    basis: 'notional',
    chargeOnEntry: false,
    chargeOnExit: false,
    leverageMultiplier: market === 'exchange-leverage' ? 2 : undefined,
    dailyLeverageRate: market === 'exchange-leverage' ? 0.0004 : undefined,
    liquidationFeeRate: market === 'exchange-leverage' ? 0.005 : undefined,
    forcedCloseFeeRate: market === 'exchange-leverage' ? 0.005 : undefined,
    settlementHourJst: market === 'exchange-leverage' ? 6 : undefined,
  };
}

export const gmoVenueResolver: VenueResolver = {
  id: 'gmo',
  resolveSymbolSpec: resolveGmoSymbolSpec,
  resolveFeeModel: resolveGmoFeeModel,
};
