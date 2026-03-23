const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const simulator = require('../dist/index.js');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'test', 'golden', 'fixtures');
const DAY_MS = 24 * 60 * 60 * 1000;

dotenv.config({ path: path.resolve(ROOT, '../train/.env') });
dotenv.config({ path: path.resolve(ROOT, '../backend/.env') });
dotenv.config({ path: path.resolve(ROOT, '../.env') });

function resolveDbConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'trader',
    password: process.env.DB_PASSWORD || 'traderpass',
    database: process.env.DB_NAME || 'trading',
  };
}

async function connectWithFallback() {
  const base = resolveDbConfig();
  const candidates = [
    base,
    { ...base, host: '127.0.0.1' },
    { ...base, host: 'localhost' },
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const connection = await mysql.createConnection(candidate);
      return { connection, config: candidate };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('failed to connect to mysql');
}

function ensureFixtureDir() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
}

function clearExistingFixtures() {
  if (!fs.existsSync(FIXTURE_DIR)) {
    return;
  }

  for (const name of fs.readdirSync(FIXTURE_DIR)) {
    if (!name.endsWith('.json')) {
      continue;
    }
    fs.unlinkSync(path.join(FIXTURE_DIR, name));
  }
}

function toSnapshotRow(row) {
  return {
    openTime: String(Number(row.open_time)),
    open_time: String(Number(row.open_time)),
    close: String(Number(row.bid_close)),
    high: String(Number(row.bid_high)),
    low: String(Number(row.bid_low)),
    bidClose: String(Number(row.bid_close)),
    askClose: String(Number(row.ask_close)),
    bidHigh: String(Number(row.bid_high)),
    bidLow: String(Number(row.bid_low)),
    askHigh: String(Number(row.ask_high)),
    askLow: String(Number(row.ask_low)),
    bid_close: String(Number(row.bid_close)),
    ask_close: String(Number(row.ask_close)),
    bid_high: String(Number(row.bid_high)),
    bid_low: String(Number(row.bid_low)),
    ask_high: String(Number(row.ask_high)),
    ask_low: String(Number(row.ask_low)),
    volume: String(Number(row.volume || 0)),
  };
}

async function loadRows(connection, symbol, startTime, endTime) {
  const [rows] = await connection.query(
    `SELECT open_time,
            bid_open,
            bid_high,
            bid_low,
            bid_close,
            ask_open,
            ask_high,
            ask_low,
            ask_close,
            volume
       FROM klines
      WHERE symbol = ?
        AND interval_type = '1min'
        AND open_time BETWEEN ? AND ?
      ORDER BY open_time ASC`,
    [symbol, startTime, endTime]
  );

  return rows.map(toSnapshotRow);
}

async function loadLatestRows(connection, symbol, limit, offset = 0) {
  const [rows] = await connection.query(
    `SELECT open_time,
            bid_open,
            bid_high,
            bid_low,
            bid_close,
            ask_open,
            ask_high,
            ask_low,
            ask_close,
            volume
       FROM klines
      WHERE symbol = ?
        AND interval_type = '1min'
      ORDER BY open_time DESC
      LIMIT ?
      OFFSET ?`,
    [symbol, limit, offset]
  );

  return rows.reverse().map(toSnapshotRow);
}

async function loadLatestOpenTime(connection, symbol) {
  const [rows] = await connection.query(
    `SELECT MAX(open_time) AS latest_open_time
       FROM klines
      WHERE symbol = ?
        AND interval_type = '1min'`,
    [symbol]
  );
  const latest = Number(rows[0]?.latest_open_time);
  if (!Number.isFinite(latest)) {
    throw new Error(`no klines found for symbol=${symbol}`);
  }
  return latest;
}

async function tryLoadLatestOpenTime(connection, symbol) {
  try {
    return await loadLatestOpenTime(connection, symbol);
  } catch (error) {
    if (error instanceof Error && /no klines found/.test(error.message)) {
      return null;
    }
    throw error;
  }
}

async function loadAvailableFxSymbols(connection) {
  const [rows] = await connection.query(
    `SELECT DISTINCT symbol
       FROM klines
      WHERE interval_type = '1min'
      ORDER BY symbol ASC`
  );

  return rows
    .map((row) => String(row.symbol || ''))
    .filter((symbol) => simulator.isFxSymbol(symbol));
}

function buildFixtureBase(id, source, scenario, klines, derived, expected) {
  return {
    schemaVersion: 1,
    id,
    generatedAt: new Date().toISOString(),
    source,
    scenario,
    klines,
    derived,
    expected,
  };
}

function writeFixture(fixture) {
  const filepath = path.join(FIXTURE_DIR, `${fixture.id}.json`);
  fs.writeFileSync(filepath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  return filepath;
}

function computeTradeFixture({
  id,
  symbol,
  market,
  direction,
  lotSize,
  klines,
  holdMinutes,
}) {
  const symbolSpec = simulator.resolveVenueSymbolSpec({ venue: 'gmo', symbol });
  const feeModel = simulator.resolveVenueFeeModel({ venue: 'gmo', symbol, market });
  const entryKline = klines[0];
  const exitKline = klines[klines.length - 1];
  const entryPrice = simulator.getReferencePrice(entryKline, direction, true);
  const exitPrice = simulator.getReferencePrice(exitKline, direction, false);
  const entryTime = Number(entryKline.openTime);
  const exitTime = Number(exitKline.openTime);
  const exitIndex = klines.length - 1;
  const settlementTimes = feeModel.settlementHourJst === undefined
    ? []
    : simulator.enumerateJstSettlementTimes(entryTime, exitTime, feeModel.settlementHourJst);

  const outcome = simulator.calculateTradeOutcome({
    position: {
      direction,
      entryPrice,
      lotSize,
      entryTime,
      entryIndex: 0,
    },
    exitPrice,
    exitTime,
    exitIndex,
    activationIndex: 0,
    feeModel,
    symbolSpec,
    klines,
  });

  return buildFixtureBase(
    id,
    {
      database: resolveDbConfig().database,
      table: 'klines',
      symbol,
      interval: '1min',
      startTime: entryTime,
      endTime: exitTime,
    },
    {
      type: 'trade_outcome',
      venue: 'gmo',
      symbol,
      market,
      direction,
      lotSize,
      holdMinutes,
    },
    klines,
    {
      entryPrice,
      exitPrice,
      entryReferencePrice: entryPrice,
      exitReferencePrice: exitPrice,
      settlementTimes,
    },
    {
      grossPnl: outcome.grossPnl,
      commissionFee: outcome.commissionFee,
      netPnl: outcome.netPnl,
      pips: outcome.pips,
      percent: outcome.percent,
    }
  );
}

async function collectRequiredCoinFixtures(connection) {
  const latestBtc = await loadLatestOpenTime(connection, 'BTCJPY');
  const btcRecentLong = await loadLatestRows(connection, 'BTCJPY', 5, 0);
  const btcRecentShort = await loadLatestRows(connection, 'BTCJPY', 5, 3);
  const btcFunding = await loadRows(connection, 'BTCJPY', latestBtc - (4 * DAY_MS + 10 * 60_000), latestBtc);
  const solRecentLong = await loadLatestRows(connection, 'SOLJPY', 5, 0);
  const solRecentShort = await loadLatestRows(connection, 'SOLJPY', 5, 2);

  return [
    computeTradeFixture({
      id: 'btc_recent_long_hold',
      symbol: 'BTCJPY',
      market: 'exchange-leverage',
      direction: 'long',
      lotSize: 0.01,
      klines: btcRecentLong,
      holdMinutes: Math.max(1, btcRecentLong.length - 1),
    }),
    computeTradeFixture({
      id: 'btc_recent_short_hold',
      symbol: 'BTCJPY',
      market: 'exchange-leverage',
      direction: 'short',
      lotSize: 0.01,
      klines: btcRecentShort,
      holdMinutes: Math.max(1, btcRecentShort.length - 1),
    }),
    computeTradeFixture({
      id: 'btc_multi_settlement_long',
      symbol: 'BTCJPY',
      market: 'exchange-leverage',
      direction: 'long',
      lotSize: 0.01,
      klines: btcFunding,
      holdMinutes: Math.max(1, btcFunding.length - 1),
    }),
    computeTradeFixture({
      id: 'sol_recent_long_spot',
      symbol: 'SOLJPY',
      market: 'spot',
      direction: 'long',
      lotSize: 1,
      klines: solRecentLong,
      holdMinutes: Math.max(1, solRecentLong.length - 1),
    }),
    computeTradeFixture({
      id: 'sol_recent_short_spot',
      symbol: 'SOLJPY',
      market: 'spot',
      direction: 'short',
      lotSize: 1,
      klines: solRecentShort,
      holdMinutes: Math.max(1, solRecentShort.length - 1),
    }),
  ];
}

async function collectOptionalFxFixtures(connection) {
  const symbols = await loadAvailableFxSymbols(connection);
  if (!symbols.length) {
    console.log('skip FX golden fixtures: no FX klines found');
    return [];
  }

  const fixtures = [];
  for (const symbol of symbols) {
    if ((await tryLoadLatestOpenTime(connection, symbol)) === null) {
      continue;
    }

    const symbolId = symbol.toLowerCase();
    const recentLong = await loadLatestRows(connection, symbol, 5, 0);
    const recentShort = await loadLatestRows(connection, symbol, 5, 3);
    const swing = await loadLatestRows(connection, symbol, 60, 90);

    if (recentLong.length >= 2) {
      fixtures.push(
        computeTradeFixture({
          id: `${symbolId}_recent_long_fx`,
          symbol,
          market: 'fx',
          direction: 'long',
          lotSize: 0.1,
          klines: recentLong,
          holdMinutes: Math.max(1, recentLong.length - 1),
        })
      );
    }

    if (recentShort.length >= 2) {
      fixtures.push(
        computeTradeFixture({
          id: `${symbolId}_recent_short_fx`,
          symbol,
          market: 'fx',
          direction: 'short',
          lotSize: 0.1,
          klines: recentShort,
          holdMinutes: Math.max(1, recentShort.length - 1),
        })
      );
    }

    if (swing.length >= 2) {
      fixtures.push(
        computeTradeFixture({
          id: `${symbolId}_intraday_swing_fx`,
          symbol,
          market: 'fx',
          direction: 'long',
          lotSize: 0.2,
          klines: swing,
          holdMinutes: Math.max(1, swing.length - 1),
        })
      );
    }
  }

  console.log(`detected FX symbols: ${symbols.join(', ')}`);
  return fixtures;
}

async function exportFixtures() {
  ensureFixtureDir();
  const { connection, config } = await connectWithFallback();

  try {
    console.log(`connected to ${config.host}:${config.port}/${config.database}`);

    const fixtures = [
      ...(await collectRequiredCoinFixtures(connection)),
      ...(await collectOptionalFxFixtures(connection)),
    ];

    clearExistingFixtures();
    const outputs = fixtures.map(writeFixture);
    console.log(`exported ${outputs.length} golden fixtures`);
    for (const output of outputs) {
      console.log(output);
    }
  } finally {
    await connection.end();
  }
}

exportFixtures().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
