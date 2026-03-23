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
];
const FX_LOT_SYMBOLS = new Set([
    ...GMO_FX_SYMBOLS,
]);
export function normalizeSymbol(rawSymbol) {
    return String(rawSymbol || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}
export function isFxSymbol(symbol) {
    return FX_LOT_SYMBOLS.has(normalizeSymbol(symbol));
}
export function createDefaultSymbolSpec(rawSymbol, override) {
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
