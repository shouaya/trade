import type { SymbolSpec } from './types.js';

export const GMO_FX_SYMBOLS = [
  'USDJPY',
  'EURJPY',
  'GBPJPY',
  'AUDJPY',
  'NZDJPY',
  'CADJPY',
  'CHFJPY',
  'TRYJPY',
  'ZARJPY',
  'MXNJPY',
  'EURUSD',
  'GBPUSD',
  'AUDUSD',
  'NZDUSD',
] as const;

const FX_LOT_SYMBOLS: ReadonlySet<string> = new Set<string>([
  ...GMO_FX_SYMBOLS,
]);

export function normalizeSymbol(rawSymbol: string): string {
  return String(rawSymbol || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function isFxSymbol(symbol: string): boolean {
  return FX_LOT_SYMBOLS.has(normalizeSymbol(symbol));
}

export function createDefaultSymbolSpec(rawSymbol: string, override?: SymbolSpec): SymbolSpec {
  if (override) {
    return {
      ...override,
      symbol: normalizeSymbol(override.symbol),
      unitsPerLot: override.unitsPerLot > 0 ? override.unitsPerLot : 1,
    };
  }

  const symbol = normalizeSymbol(rawSymbol || 'USDJPY');
  const quoteCurrency = symbol.slice(-3);

  if (isFxSymbol(symbol)) {
    return {
      symbol,
      marketType: 'fx',
      quantityMode: 'lot',
      unitsPerLot: 100000,
      pipSize: quoteCurrency === 'JPY' ? 0.01 : 0.0001,
      quoteCurrency,
      initialCapital: quoteCurrency === 'JPY' ? 1_000_000 : 10_000,
    };
  }

  return {
    symbol,
    marketType: 'coin',
    quantityMode: 'base',
    unitsPerLot: 1,
    pipSize: quoteCurrency === 'JPY' ? 1 : 0.01,
    quoteCurrency,
    initialCapital: quoteCurrency === 'JPY' ? 1_000_000 : 10_000,
  };
}
