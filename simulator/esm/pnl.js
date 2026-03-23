export function getPositionUnits(lotSize, symbolSpec) {
    return lotSize * symbolSpec.unitsPerLot;
}
export function getPriceDiff(direction, entryPrice, exitPrice) {
    if (direction === 'long') {
        return exitPrice - entryPrice;
    }
    return entryPrice - exitPrice;
}
export function calculatePnL(direction, entryPrice, exitPrice, lotSize, symbolSpec) {
    return getPriceDiff(direction, entryPrice, exitPrice) * getPositionUnits(lotSize, symbolSpec);
}
