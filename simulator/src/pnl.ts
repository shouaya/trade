import type { ExecutionDirection, SymbolSpec } from './types.js';

export function getPositionUnits(lotSize: number, symbolSpec: SymbolSpec): number {
  return lotSize * symbolSpec.unitsPerLot;
}

export function getPriceDiff(direction: ExecutionDirection, entryPrice: number, exitPrice: number): number {
  if (direction === 'long') {
    return exitPrice - entryPrice;
  }

  return entryPrice - exitPrice;
}

export function calculatePnL(
  direction: ExecutionDirection,
  entryPrice: number,
  exitPrice: number,
  lotSize: number,
  symbolSpec: SymbolSpec
): number {
  return getPriceDiff(direction, entryPrice, exitPrice) * getPositionUnits(lotSize, symbolSpec);
}
