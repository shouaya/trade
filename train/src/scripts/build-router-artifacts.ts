import * as fs from 'fs';
import * as path from 'path';
import db from '../configs/database';
import {
  ensureTrainConfigsSchema
} from '@money/database';
import type * as mysql from 'mysql2/promise';
import {
  buildRollingRouterArtifacts,
  buildRelativeConfigRef,
  resolveRelativeConfigRef
} from '../services/router-artifact-builder';
import { loadLatestRollingSnapshotFromFeatureMemory } from '../services/feature-memory-package';
import {
  upsertTrainConfig
} from '../services/train-config-registry';
import {
  loadConfigContentByRelativeRef
} from '../services/train-config-loader';

type JsonObject = Record<string, any>;
interface Args {
  readonly trainConfigPath: string;
  readonly trainConfigRef: string;
}

const TRAIN_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv: readonly string[]): Args {
  let trainConfigPath = '';
  let trainConfigRef = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg.startsWith('--trainConfig=')) {
      trainConfigPath = arg.slice('--trainConfig='.length);
      continue;
    }
    if (arg === '--trainConfig') {
      trainConfigPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--trainConfigRef=')) {
      trainConfigRef = arg.slice('--trainConfigRef='.length);
      continue;
    }
    if (arg === '--trainConfigRef') {
      trainConfigRef = argv[index + 1] ?? '';
      index += 1;
    }
  }

  if (!trainConfigPath) {
    throw new Error('missing --trainConfig');
  }
  if (!trainConfigRef) {
    throw new Error('missing --trainConfigRef');
  }

  return {
    trainConfigPath,
    trainConfigRef
  };
}

function readJson(filePath: string): JsonObject {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonObject;
}

async function loadLatestRollingPackage(connection: mysql.Pool | mysql.Connection, trainId: string): Promise<JsonObject> {
  const featureMemorySnapshot = await loadLatestRollingSnapshotFromFeatureMemory(connection, {
    trainId
  });
  if (featureMemorySnapshot) {
    return featureMemorySnapshot;
  }

  throw new Error(`rolling package not found in feature-memory artifacts for train_id=${trainId}`);
}

async function loadJsonByRelativeRef(
  connection: mysql.Pool | mysql.Connection,
  trainRoot: string,
  trainingConfigKey: string,
  relativeRef: unknown
): Promise<JsonObject | null> {
  const normalizedRef = String(relativeRef || '').trim();
  if (!normalizedRef) {
    return null;
  }

  const configKey = resolveRelativeConfigRef(trainingConfigKey, normalizedRef);
  const absolutePath = path.resolve(trainRoot, configKey);
  if (!fs.existsSync(absolutePath)) {
    return await loadConfigContentByRelativeRef<JsonObject>(connection, trainingConfigKey, normalizedRef);
  }

  return readJson(absolutePath);
}

export async function runBuildRouterArtifacts(
  args: Args,
  options: {
    readonly db?: mysql.Pool | mysql.Connection;
    readonly trainRoot?: string;
    readonly trainingConfig?: JsonObject;
    readonly skipEnsureSchema?: boolean;
  } = {}
): Promise<JsonObject> {
  const connection = options.db ?? db;
  const trainRoot = options.trainRoot ?? TRAIN_ROOT;
  if (!options.skipEnsureSchema) {
    await ensureTrainConfigsSchema(connection as mysql.Pool | mysql.Connection);
  }

  const trainingConfig = options.trainingConfig ?? readJson(args.trainConfigPath);
  const trainId = String(
    trainingConfig['trainId']
    || (trainingConfig['trainingMeta'] as JsonObject | undefined)?.['trainId']
    || ''
  ).trim();
  if (!trainId) {
    throw new Error('trainId is required before building router artifacts');
  }

  const rollingPackage = await loadLatestRollingPackage(connection, trainId);
  const previousRouter = await loadJsonByRelativeRef(
    connection as mysql.Pool | mysql.Connection,
    trainRoot,
    args.trainConfigRef,
    (trainingConfig['regimeRouting'] as JsonObject | undefined)?.['routerConfigPath']
  );
  const artifacts = buildRollingRouterArtifacts({
    trainingConfig,
    trainingConfigKey: args.trainConfigRef,
    rollingPackage,
    previousRouter
  });

  const nextTrainingContent = {
    ...trainingConfig,
    trainId,
    trainingMeta: {
      ...((trainingConfig['trainingMeta'] && typeof trainingConfig['trainingMeta'] === 'object')
        ? trainingConfig['trainingMeta'] as JsonObject
        : {}),
      trainId
    },
    regimeRouting: {
      ...((trainingConfig['regimeRouting'] && typeof trainingConfig['regimeRouting'] === 'object')
        ? trainingConfig['regimeRouting'] as JsonObject
        : {}),
      routerConfigPath: buildRelativeConfigRef(args.trainConfigRef, artifacts.routerConfigKey),
      policyCatalogPath: buildRelativeConfigRef(args.trainConfigRef, artifacts.policyConfigKey)
    }
  };

  await upsertTrainConfig(connection as mysql.Pool | mysql.Connection, artifacts.routerConfigKey, artifacts.routerContent, {
    explicitType: 'router'
  });
  await upsertTrainConfig(connection as mysql.Pool | mysql.Connection, artifacts.policyConfigKey, {
    ...artifacts.policyContent,
    source: {
      ...((artifacts.policyContent['source'] && typeof artifacts.policyContent['source'] === 'object')
        ? artifacts.policyContent['source'] as JsonObject
        : {}),
      routerConfigPath: path.posix.basename(artifacts.routerConfigKey),
      trainingConfigPath: args.trainConfigRef
    },
    trainId,
    trainingMeta: {
      ...((artifacts.policyContent['trainingMeta'] && typeof artifacts.policyContent['trainingMeta'] === 'object')
        ? artifacts.policyContent['trainingMeta'] as JsonObject
        : {}),
      trainId,
      trainingConfigKey: args.trainConfigRef
    }
  }, {
    explicitType: 'policy'
  });
  await upsertTrainConfig(connection as mysql.Pool | mysql.Connection, args.trainConfigRef, nextTrainingContent, {
    explicitType: 'training'
  });

  return {
    trainId,
    trainingConfigKey: args.trainConfigRef,
    routerConfigKey: artifacts.routerConfigKey,
    policyConfigKey: artifacts.policyConfigKey,
    routerRelativeRef: artifacts.routerRelativeRef,
    policyRelativeRef: artifacts.policyRelativeRef,
    strategyCatalogCount: Object.keys((artifacts.routerContent['strategyCatalog'] as JsonObject | undefined) || {}).length,
    carriedRuleCount: Array.isArray(artifacts.routerContent['rules']) ? artifacts.routerContent['rules'].length : 0
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runBuildRouterArtifacts(args);
  process.stdout.write(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main()
    .then(async () => {
      await db.end();
    })
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      await db.end();
      process.exit(1);
    });
}
