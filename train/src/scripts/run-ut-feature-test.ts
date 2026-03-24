#!/usr/bin/env node

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  computeScenarioCoverage,
  getMarketFeatureScenario
} from '../ut/market-feature-scenarios';

interface CliArgs {
  readonly scenario: string;
  readonly keepArtifacts: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let scenario = 'rolling-regime-shift';
  let keepArtifacts = false;

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--scenario=')) {
      scenario = arg.slice('--scenario='.length).trim() || scenario;
      continue;
    }
    if (arg === '--keep-artifacts') {
      keepArtifacts = true;
    }
  }

  return {
    scenario,
    keepArtifacts
  };
}

function runNodeScript(
  scriptPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
): void {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: path.resolve(__dirname, '..', '..'),
    env,
    encoding: 'utf8'
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    throw new Error(`${path.basename(scriptPath)} failed with exit code ${result.status}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const scenario = getMarketFeatureScenario(args.scenario);
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const trainRoot = path.resolve(repoRoot, 'train');
  const utDbName = String(process.env['UT_DB_NAME'] || 'trading_ut').trim() || 'trading_ut';
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'money-ut-feature-'));
  const env = {
    ...process.env,
    DB_NAME: utDbName
  };

  process.env['DB_NAME'] = utDbName;

  const initScript = path.resolve(trainRoot, 'dist/scripts/init-ut-db.js');
  const seedScript = path.resolve(trainRoot, 'dist/scripts/seed-ut-klines.js');
  const trainScript = path.resolve(trainRoot, 'dist/scripts/train.js');

  runNodeScript(initScript, [], env);
  runNodeScript(seedScript, [`--scenario=${scenario.key}`], env);

  const generatedConfigKey = `configs/generated/ut/${scenario.key}_train.json`;
  const generatedConfigPath = path.resolve(trainRoot, generatedConfigKey);
  fs.mkdirSync(path.dirname(generatedConfigPath), { recursive: true });

  const trainingConfig = {
    trainId: `ut-${scenario.key}-train`,
    name: `UT_${scenario.key.toUpperCase().replace(/-/g, '_')}`,
    description: `UT feature test for ${scenario.key}`,
    timeRange: {
      startTimeMs: scenario.startTimeMs,
      endTimeMs: scenario.endTimeMs,
      startIso: new Date(scenario.startTimeMs).toISOString(),
      endIso: new Date(scenario.endTimeMs).toISOString()
    },
    market: {
      symbol: scenario.symbol,
      intervalType: scenario.intervalType
    },
    database: {
      tableName: `ut_${scenario.key.replace(/-/g, '_')}_train`,
      resetTableBeforeRun: true
    },
    strategy: {
      types: ['rsi_macd'],
      parameters: {
        rsi: {
          period: [14],
          oversold: [30, 35],
          overbought: [65]
        },
        macd: {
          fastPeriod: [6],
          slowPeriod: [13],
          signalPeriod: [4],
          histogramThreshold: [0]
        },
        risk: {
          maxPositions: [1],
          lotSize: [0.01],
          maxHoldMinutes: [4, 8]
        },
        atr: {
          slMultiplier: [1.5],
          tpMultiplier: [1.5]
        },
        tradingSchedule: '* * * * *'
      }
    },
    executor: {
      version: 'ut-v1',
      options: {
        initialBalance: 1000000,
        feeModel: {
          venueCode: 'GMOCOIN',
          market: 'exchange-leverage',
          productCode: 'BTC_JPY',
          commissionRate: 0,
          basis: 'notional',
          chargeOnEntry: true,
          chargeOnExit: true,
          leverageMultiplier: 2,
          dailyLeverageRate: 0.0004,
          liquidationFeeRate: 0.005,
          forcedCloseFeeRate: 0.005,
          settlementHourJst: 6
        }
      }
    },
    output: {
      topN: 2,
      persistTopStrategies: false,
      persistTrades: true,
      strategyNamePrefix: 'UT-',
      descriptionPrefix: `UT ${scenario.key}`
    },
    validationPlan: {
      profile: 'rolling-window'
    },
    featureEngineering: {
      openingWindowMinutes: 1,
      volBaselineLookbackPeriods: 1,
      routerSplit: {
        enabled: true,
        minSamplesPerBranch: 1,
        metrics: [
          'trendEfficiency',
          'volExpansionRatio',
          'openingImpulse',
          'reversalStrength',
          'positiveStrategyRatio',
          'bestVsMedianGap',
          'monthlyWeeklyAlignment',
          'weeklyDailyAlignment'
        ]
      }
    }
  };

  fs.writeFileSync(generatedConfigPath, `${JSON.stringify(trainingConfig, null, 2)}\n`, 'utf8');

  try {
    runNodeScript(trainScript, [generatedConfigPath], env);

    const dbModule = require(path.resolve(trainRoot, 'dist/configs/database.js'));
    const db = dbModule.default;
    const { BACKTEST_RESULTS_TABLE } = require(path.resolve(repoRoot, 'database/index.js'));
    const { runGenerateValidationArtifacts } = require(path.resolve(trainRoot, 'dist/scripts/generate-validation-artifacts.js'));
    const { runBuildRouterArtifacts } = require(path.resolve(trainRoot, 'dist/scripts/build-router-artifacts.js'));
    const { runRouterValidation } = require(path.resolve(trainRoot, 'dist/services/regime-router-validation.js'));
    const { upsertTrainConfig } = require(path.resolve(trainRoot, 'dist/services/train-config-registry.js'));
    const { buildTrainingPipelineSummary } = require(path.resolve(trainRoot, 'dist/services/train-pipeline-summary.js'));

    const artifacts = await runGenerateValidationArtifacts({
      trainConfig: generatedConfigPath,
      trainConfigRef: generatedConfigKey,
      symbol: scenario.symbol,
      sourceTable: trainingConfig.database.tableName,
      outPrefix: `ut_${scenario.key}`,
      strategyPrefix: `UT-${scenario.key}-`,
      descriptionPrefix: `UT ${scenario.key}`,
      limit: 2,
      exact: true,
      profile: 'rolling-window',
      outputMode: 'json'
    });

    await upsertTrainConfig(db, generatedConfigKey, trainingConfig, { explicitType: 'training' });
    await upsertTrainConfig(db, artifacts.snapshot.configKey, artifacts.snapshot.content, { explicitType: 'top-strategies' });
    for (const validationConfig of artifacts.validationConfigs) {
      await upsertTrainConfig(db, validationConfig.configKey, validationConfig.content, { explicitType: 'validation' });
      const validationPath = path.resolve(trainRoot, validationConfig.configKey);
      fs.mkdirSync(path.dirname(validationPath), { recursive: true });
      fs.writeFileSync(validationPath, `${JSON.stringify(validationConfig.content, null, 2)}\n`, 'utf8');
    }

    const routerResult = await runBuildRouterArtifacts({
      trainConfigPath: generatedConfigPath,
      trainConfigRef: generatedConfigKey
    });

    let selectedValidation: typeof artifacts.validationConfigs[number] | null = null;
    let selectedValidationPath = '';

    for (const validationConfig of artifacts.validationConfigs) {
      const validationPath = path.resolve(trainRoot, validationConfig.configKey);
      runNodeScript(trainScript, [validationPath], env);

      const [rows] = await db.query(
        `SELECT COUNT(*) AS trade_strategy_count
         FROM ${BACKTEST_RESULTS_TABLE}
         WHERE result_group = ?
           AND total_trades > 0`,
        [validationConfig.content.database.tableName]
      );
      const tradeStrategyCount = Number(rows[0]?.['trade_strategy_count'] || 0);
      if (tradeStrategyCount > 0) {
        selectedValidation = validationConfig;
        selectedValidationPath = validationPath;
        break;
      }
    }

    if (!selectedValidation) {
      throw new Error('no validation config generated for UT flow');
    }

    const routerReport = await runRouterValidation({
      validationConfigPath: selectedValidationPath,
      routerConfigPath: path.resolve(trainRoot, routerResult.routerConfigKey)
    });

    const summary = await buildTrainingPipelineSummary({
      db,
      repoRoot,
      trainRoot
    });

    const coverage = computeScenarioCoverage(scenario, {
      openingWindowCount: 1,
      volBaselineLookback: 1
    });
    const pipeline = summary.data.find((item: any) => item.trainingConfigPath === generatedConfigKey);

    if (!pipeline) {
      throw new Error(`pipeline summary missing generated config: ${generatedConfigKey}`);
    }
    if (!routerReport.dailyRoutes.length) {
      throw new Error('router validation produced no daily routes in UT feature flow');
    }

    console.log('='.repeat(80));
    console.log('✅ UT feature flow completed');
    console.log(`DB: ${utDbName}`);
    console.log(`Scenario: ${scenario.key}`);
    console.log(`Daily buckets: ${coverage.dailyBuckets.join(', ')}`);
    console.log(`Weekly buckets: ${coverage.weeklyBuckets.join(', ')}`);
    console.log(`Monthly buckets: ${coverage.monthlyBuckets.join(', ')}`);
    console.log(`Validation configs: ${artifacts.validationConfigs.length}`);
    console.log(`Selected validation: ${selectedValidation.configKey}`);
    console.log(`Router rules: ${routerResult.carriedRuleCount}`);
    console.log(`Pipeline step count: ${pipeline.steps.length}`);
    console.log('='.repeat(80));

    await db.end();
  } finally {
    if (!args.keepArtifacts) {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
      fs.rmSync(generatedConfigPath, { force: true });
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
