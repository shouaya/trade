const {
  assert,
  simulator,
} = require('./helpers.js');

function testDefaultExportSurface() {
  const exportedKeys = [
    'DAY_MS',
    'JST_OFFSET_MS',
    'calculateCommissionFee',
    'calculatePnL',
    'calculateTradeOutcome',
    'createDefaultSymbolSpec',
    'enumerateJstSettlementTimes',
    'findSettlementMarkPrice',
    'getMidPrice',
    'getPositionUnits',
    'getPriceDiff',
    'getPriceSnapshotOpenTime',
    'getReferencePrice',
    'getTriggerPrice',
    'getVenueResolver',
    'gmoVenueResolver',
    'isFxSymbol',
    'normalizeSymbol',
    'readNumericField',
    'resolveGmoFeeModel',
    'resolveGmoSimulatorFeeModel',
    'resolveGmoSymbolSpec',
    'resolveSymbolSpecFromSymbol',
    'resolveVenueFeeModel',
    'resolveVenueSymbolSpec',
  ];

  for (const key of exportedKeys) {
    assert.notEqual(simulator[key], undefined, `missing export ${key}`);
  }

  assert.equal(typeof simulator.default.calculateTradeOutcome, 'function');
  assert.equal(simulator.default.resolveVenueFeeModel({ symbol: 'USDJPY' }).market, 'fx');
  assert.equal(simulator.default.resolveSymbolSpecFromSymbol('BTCJPY').marketType, 'coin');
  assert.equal(simulator.gmoVenueResolver.resolveFeeModel({ symbol: 'USDJPY' }).market, 'fx');
}

module.exports = [
  { name: 'default export surface', run: testDefaultExportSurface },
];
