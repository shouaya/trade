import * as simulatorCore from '@money/simulator';

export function isFxSymbol(symbol) {
  return simulatorCore.isFxSymbol(symbol);
}

export function resolveSymbolSpec(symbol) {
  const base = simulatorCore.resolveSymbolSpecFromSymbol(symbol);
  return base.marketType === 'fx'
    ? {
      ...base,
      quantityMode: 'units',
      quantityLabel: '数量 (通貨)',
      quantityStep: 100,
      quantityMin: 100,
      initialQuantity: 1000,
      unitsPerLot: 1,
    }
    : {
      ...base,
      quantityMode: 'base',
      quantityLabel: '数量',
      quantityStep: 0.001,
      quantityMin: 0.001,
      initialQuantity: base.symbol === 'BTCJPY' ? 0.01 : 0.1,
    };
}

export function resolveFeeModel(symbol) {
  const base = simulatorCore.resolveGmoSimulatorFeeModel(symbol);
  return {
    ...base,
    referenceLabel: base.market === 'fx' ? 'FX API' : '取引所レバレッジ',
  };
}
