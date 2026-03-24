#!/usr/bin/env node

import * as dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import {
  createMysqlConnectionWithFallback
} from '@money/database';
import {
  computeScenarioCoverage,
  getMarketFeatureScenario,
  listMarketFeatureScenarios,
  type MarketFeatureScenario
} from '../ut/market-feature-scenarios';
import { loadTrainEnv } from '../utils/train-env';

loadTrainEnv(dotenv);

interface CliArgs {
  readonly scenario: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let scenario = 'all';

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--scenario=')) {
      scenario = arg.slice('--scenario='.length).trim() || 'all';
    }
  }

  return { scenario };
}

function resolveScenarios(key: string): readonly MarketFeatureScenario[] {
  if (key === 'all') {
    return listMarketFeatureScenarios();
  }
  return [getMarketFeatureScenario(key)];
}

async function seedScenario(
  connection: mysql.Connection,
  scenario: MarketFeatureScenario
): Promise<void> {
  await connection.query(
    `DELETE FROM klines
     WHERE symbol = ?
       AND interval_type = ?
       AND open_time BETWEEN ? AND ?`,
    [scenario.symbol, scenario.intervalType, scenario.startTimeMs, scenario.endTimeMs]
  );

  const values = scenario.klines.map((row) => ([
    row.open_time,
    row.bid_open,
    row.bid_high,
    row.bid_low,
    row.bid_close,
    row.ask_open,
    row.ask_high,
    row.ask_low,
    row.ask_close,
    row.volume,
    row.symbol,
    row.interval_type
  ]));

  await connection.query(
    `INSERT INTO klines (
      open_time,
      bid_open,
      bid_high,
      bid_low,
      bid_close,
      ask_open,
      ask_high,
      ask_low,
      ask_close,
      volume,
      symbol,
      interval_type
    ) VALUES ?`,
    [values]
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const scenarios = resolveScenarios(args.scenario);
  const connection = await createMysqlConnectionWithFallback(mysql, {
    defaults: {
      host: '127.0.0.1'
    }
  });

  try {
    for (const scenario of scenarios) {
      await seedScenario(connection, scenario);
      const coverage = computeScenarioCoverage(scenario, {
        openingWindowCount: 1,
        volBaselineLookback: 1
      });

      console.log(`✅ seeded ${scenario.key}`);
      console.log(`   - rows: ${scenario.klines.length}`);
      console.log(`   - daily buckets: ${coverage.dailyBuckets.join(', ') || 'n/a'}`);
      console.log(`   - weekly buckets: ${coverage.weeklyBuckets.join(', ') || 'n/a'}`);
      console.log(`   - monthly buckets: ${coverage.monthlyBuckets.join(', ') || 'n/a'}`);
    }
  } finally {
    await connection.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
