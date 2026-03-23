const fs = require('node:fs');
const path = require('node:path');

const {
  approxEqual,
  assert,
  simulator,
} = require('./helpers.js');

const FIXTURE_DIR = path.join(__dirname, 'golden', 'fixtures');

function loadGoldenFixtures() {
  if (!fs.existsSync(FIXTURE_DIR)) {
    return [];
  }

  return fs.readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const filepath = path.join(FIXTURE_DIR, name);
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    });
}

function runTradeOutcomeFixture(fixture) {
  const { scenario, klines, derived, expected } = fixture;
  const feeModel = simulator.resolveVenueFeeModel({
    venue: scenario.venue,
    symbol: scenario.symbol,
    market: scenario.market,
  });
  const symbolSpec = simulator.resolveVenueSymbolSpec({
    venue: scenario.venue,
    symbol: scenario.symbol,
  });

  const entryPrice = simulator.getReferencePrice(klines[0], scenario.direction, true);
  const exitPrice = simulator.getReferencePrice(klines[klines.length - 1], scenario.direction, false);

  approxEqual(entryPrice, derived.entryPrice);
  approxEqual(exitPrice, derived.exitPrice);

  const actualSettlementTimes = feeModel.settlementHourJst === undefined
    ? []
    : simulator.enumerateJstSettlementTimes(
        Number(klines[0].openTime),
        Number(klines[klines.length - 1].openTime),
        feeModel.settlementHourJst
      );
  assert.deepEqual(actualSettlementTimes, derived.settlementTimes);

  const outcome = simulator.calculateTradeOutcome({
    position: {
      direction: scenario.direction,
      entryPrice,
      lotSize: scenario.lotSize,
      entryTime: Number(klines[0].openTime),
      entryIndex: 0,
    },
    exitPrice,
    exitTime: Number(klines[klines.length - 1].openTime),
    exitIndex: klines.length - 1,
    activationIndex: 0,
    feeModel,
    symbolSpec,
    klines,
  });

  approxEqual(outcome.grossPnl, expected.grossPnl);
  approxEqual(outcome.commissionFee, expected.commissionFee);
  approxEqual(outcome.netPnl, expected.netPnl);
  approxEqual(outcome.pips, expected.pips);
  approxEqual(outcome.percent, expected.percent);
}

function testGoldenFixtures() {
  const fixtures = loadGoldenFixtures();
  if (!fixtures.length) {
    return;
  }

  for (const fixture of fixtures) {
    if (fixture.scenario.type === 'trade_outcome') {
      runTradeOutcomeFixture(fixture);
    } else {
      throw new Error(`unsupported golden fixture type: ${fixture.scenario.type}`);
    }
  }
}

module.exports = [
  { name: 'golden fixtures', run: testGoldenFixtures },
];
