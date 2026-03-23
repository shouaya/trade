const {
  assert,
  simulator,
  createFxSpec,
  createCoinSpec,
} = require('./helpers.js');

function testReadNumericFieldFallbacks() {
  const snapshot = {
    close: '100',
    bidClose: '',
    askClose: 'oops',
  };

  assert.equal(simulator.readNumericField(snapshot, 'bid_close', 'bidClose', 12), 12);
  assert.equal(simulator.readNumericField(snapshot, 'ask_close', 'askClose', 34), 34);
  assert.equal(simulator.readNumericField({ close: '100', bid_close: '99.5' }, 'bid_close', 'bidClose', null), 99.5);
}

function testSymbolResolutionAndOverrides() {
  assert.equal(simulator.normalizeSymbol('btcjpy'), 'BTCJPY');
  assert.equal(simulator.normalizeSymbol('btc_jpy'), 'BTCJPY');
  assert.equal(simulator.normalizeSymbol('usd-jpy'), 'USDJPY');
  assert.equal(simulator.normalizeSymbol(''), '');
  assert.equal(simulator.isFxSymbol('eurusd'), true);
  assert.equal(simulator.isFxSymbol('EUR_USD'), true);
  assert.equal(simulator.isFxSymbol('TRY_JPY'), true);
  assert.equal(simulator.isFxSymbol('btcjpy'), false);

  const defaultFx = simulator.resolveSymbolSpecFromSymbol('');
  assert.equal(defaultFx.symbol, 'USDJPY');
  assert.equal(defaultFx.marketType, 'fx');
  assert.equal(defaultFx.unitsPerLot, 100000);
  assert.equal(defaultFx.pipSize, 0.01);
  assert.equal(defaultFx.initialCapital, 1_000_000);

  const eurUsd = simulator.resolveSymbolSpecFromSymbol('EURUSD');
  assert.equal(eurUsd.quoteCurrency, 'USD');
  assert.equal(eurUsd.pipSize, 0.0001);
  assert.equal(eurUsd.initialCapital, 10_000);

  const usdJpyUnderscore = simulator.resolveSymbolSpecFromSymbol('USD_JPY');
  assert.equal(usdJpyUnderscore.marketType, 'fx');
  assert.equal(usdJpyUnderscore.symbol, 'USDJPY');

  const suiJpyUnderscore = simulator.resolveSymbolSpecFromSymbol('SUI_JPY');
  assert.equal(suiJpyUnderscore.marketType, 'coin');
  assert.equal(suiJpyUnderscore.symbol, 'SUIJPY');
  assert.equal(suiJpyUnderscore.quoteCurrency, 'JPY');

  const coin = simulator.resolveVenueSymbolSpec({ venue: 'gmo', symbol: 'BTCUSDT' });
  assert.equal(coin.marketType, 'coin');
  assert.equal(coin.pipSize, 0.01);
  assert.equal(coin.initialCapital, 10_000);

  const override = simulator.resolveSymbolSpecFromSymbol('ethjpy', {
    symbol: 'ethjpy',
    marketType: 'coin',
    quantityMode: 'base',
    unitsPerLot: 0,
    pipSize: 0.5,
    quoteCurrency: 'JPY',
    initialCapital: 12345,
  });
  assert.equal(override.symbol, 'ETHJPY');
  assert.equal(override.unitsPerLot, 1);
  assert.equal(override.pipSize, 0.5);

  const positiveOverride = simulator.createDefaultSymbolSpec('btcusdt', {
    symbol: 'btcusdt',
    marketType: 'coin',
    quantityMode: 'base',
    unitsPerLot: 5,
    pipSize: 0.01,
    quoteCurrency: 'USDT',
    initialCapital: 20000,
  });
  assert.equal(positiveOverride.symbol, 'BTCUSDT');
  assert.equal(positiveOverride.unitsPerLot, 5);
}

function testVenueResolversAndCompatibilityExports() {
  const viaDefaultVenue = simulator.resolveVenueFeeModel({ symbol: 'USDJPY' });
  const viaAlias = simulator.resolveVenueFeeModel({ venue: 'gmo-coin', symbol: 'USDJPY' });
  const viaObjectCompat = simulator.resolveGmoSimulatorFeeModel({ symbol: 'ETHJPY', market: 'spot' });
  const viaFxCompat = simulator.resolveGmoSimulatorFeeModel({ symbol: 'BTCJPY', market: 'fx' });
  const viaUnderscoreFx = simulator.resolveVenueFeeModel({ venue: 'gmo', symbol: 'TRY_JPY' });
  const viaUnderscoreLeverage = simulator.resolveVenueFeeModel({ venue: 'gmo', symbol: 'SUI_JPY' });

  assert.equal(viaDefaultVenue.venueCode, 'GMOCOIN_FX_API');
  assert.equal(viaAlias.productCode, 'USD_JPY');
  assert.equal(viaObjectCompat.market, 'spot');
  assert.equal(viaObjectCompat.productCode, 'ETH_JPY');
  assert.equal(viaFxCompat.market, 'fx');
  assert.equal(viaFxCompat.productCode, 'BTC_JPY');
  assert.equal(viaUnderscoreFx.market, 'fx');
  assert.equal(viaUnderscoreFx.productCode, 'TRY_JPY');
  assert.equal(viaUnderscoreLeverage.market, 'exchange-leverage');
  assert.equal(viaUnderscoreLeverage.productCode, 'SUI_JPY');

  assert.equal(simulator.getVenueResolver('gmocoin').id, 'gmo');
  assert.equal(simulator.resolveGmoFeeModel({ symbol: '' }).productCode, 'USD_JPY');
  assert.equal(simulator.resolveGmoSymbolSpec({ symbol: 'usdjpy' }).marketType, 'fx');
  assert.throws(
    () => simulator.resolveVenueFeeModel({ venue: 'binance', symbol: 'BTCUSDT' }),
    /Unsupported simulator venue/
  );
}

function testGmoFeeModelResolution() {
  const fx = simulator.resolveVenueFeeModel({ venue: 'gmo', symbol: 'USDJPY' });
  const leverage = simulator.resolveVenueFeeModel({ venue: 'gmo', symbol: 'BTCJPY' });
  const leverageAdded = simulator.resolveVenueFeeModel({ venue: 'gmo', symbol: 'DOGE_JPY' });
  const spot = simulator.resolveVenueFeeModel({ venue: 'gmo', symbol: 'BTCUSDT' });

  assert.equal(fx.commissionRate, 0.00002);
  assert.equal(fx.chargeOnEntry, true);
  assert.equal(fx.chargeOnExit, true);
  assert.equal(fx.leverageMultiplier, 20);

  assert.equal(leverage.market, 'exchange-leverage');
  assert.equal(leverage.leverageMultiplier, 2);
  assert.equal(leverage.dailyLeverageRate, 0.0004);
  assert.equal(leverage.liquidationFeeRate, 0.005);
  assert.equal(leverage.forcedCloseFeeRate, 0.005);
  assert.equal(leverage.settlementHourJst, 6);

  assert.equal(leverageAdded.market, 'exchange-leverage');
  assert.equal(leverageAdded.productCode, 'DOGE_JPY');

  assert.equal(spot.market, 'spot');
  assert.equal(spot.productCode, 'BTC_USDT');
  assert.equal(spot.leverageMultiplier, undefined);
  assert.equal(spot.dailyLeverageRate, undefined);

  assert.deepEqual(simulator.GMO_FX_SYMBOLS, [
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
  ]);
  assert.deepEqual(simulator.GMO_COIN_LEVERAGE_SYMBOLS, [
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
  ]);
}

function testTimeHelpers() {
  assert.equal(simulator.getPriceSnapshotOpenTime({ close: '1', openTime: '123' }), 123);
  assert.equal(simulator.getPriceSnapshotOpenTime({ close: '1', open_time: '456' }), 456);
  assert.equal(simulator.getPriceSnapshotOpenTime({ close: '1', open_time: 'oops' }), null);

  const entryTime = Date.UTC(2026, 2, 22, 20, 50, 0);
  const exitTime = Date.UTC(2026, 2, 24, 21, 10, 0);
  assert.deepEqual(simulator.enumerateJstSettlementTimes(entryTime, exitTime, 6), [
    Date.UTC(2026, 2, 22, 21, 0, 0),
    Date.UTC(2026, 2, 23, 21, 0, 0),
    Date.UTC(2026, 2, 24, 21, 0, 0),
  ]);
  assert.deepEqual(simulator.enumerateJstSettlementTimes(entryTime, entryTime, 6), []);
  assert.deepEqual(
    simulator.enumerateJstSettlementTimes(Date.UTC(2026, 2, 22, 20, 59, 59), Date.UTC(2026, 2, 22, 21, 0, 1), 6),
    [Date.UTC(2026, 2, 22, 21, 0, 0)]
  );
  assert.deepEqual(
    simulator.enumerateJstSettlementTimes(Date.UTC(2026, 2, 22, 18, 0, 0), Date.UTC(2026, 2, 22, 21, 30, 0), 6),
    [Date.UTC(2026, 2, 22, 21, 0, 0)]
  );
  assert.deepEqual(
    simulator.enumerateJstSettlementTimes(Date.UTC(2026, 2, 22, 21, 5, 0), Date.UTC(2026, 2, 23, 21, 30, 0), 6),
    [Date.UTC(2026, 2, 23, 21, 0, 0)]
  );
}

function testPnlHelpers() {
  const fxSpec = createFxSpec();
  const coinSpec = createCoinSpec();

  assert.equal(simulator.getPositionUnits(0.1, fxSpec), 10000);
  assert.equal(simulator.getPositionUnits(0.25, coinSpec), 0.25);
  assert.equal(simulator.getPriceDiff('long', 100, 105), 5);
  assert.equal(simulator.getPriceDiff('short', 100, 95), 5);
  assert.equal(simulator.calculatePnL('long', 100, 105, 2, coinSpec), 10);
  assert.equal(simulator.calculatePnL('short', 100, 95, 0.1, fxSpec), 50000);
}

module.exports = [
  { name: 'readNumericField fallbacks', run: testReadNumericFieldFallbacks },
  { name: 'symbol resolution and overrides', run: testSymbolResolutionAndOverrides },
  { name: 'venue resolvers and compatibility exports', run: testVenueResolversAndCompatibilityExports },
  { name: 'gmo fee model resolution', run: testGmoFeeModelResolution },
  { name: 'time helpers', run: testTimeHelpers },
  { name: 'pnl helpers', run: testPnlHelpers },
];
