#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import db from '../configs/database';
import { saveTrainArtifact } from '../services/train-artifact-store';
import { runRouterValidation } from '../services/regime-router-validation';

interface CliArgs {
  readonly validation: string;
  readonly router: string;
  readonly tradeCreatedAt?: string;
}

const TRAIN_ROOT = path.resolve(__dirname, '..', '..');

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function resolveArtifactConfigKey(filePath: string): string | null {
  const resolvedPath = path.resolve(filePath);
  const relativePath = toPosix(path.relative(TRAIN_ROOT, resolvedPath));
  if (relativePath && !relativePath.startsWith('../') && relativePath !== '..') {
    return relativePath;
  }

  const normalizedInput = toPosix(String(filePath || '').trim()).replace(/^\.\/+/, '');
  return normalizedInput.startsWith('configs/') ? normalizedInput : null;
}

function loadTrainIdFromValidationConfig(validationPath: string): string | null {
  try {
    const payload = JSON.parse(fs.readFileSync(path.resolve(validationPath), 'utf8'));
    return String(payload?.trainId || payload?.trainingMeta?.trainId || '').trim() || null;
  } catch {
    return null;
  }
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args = argv.slice(2);
  let validation = '';
  let router = '';
  let tradeCreatedAt: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg.startsWith('--validation=')) {
      validation = arg.slice('--validation='.length);
      continue;
    }
    if (arg === '--validation') {
      validation = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--router=')) {
      router = arg.slice('--router='.length);
      continue;
    }
    if (arg === '--router') {
      router = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--tradeCreatedAt=')) {
      tradeCreatedAt = arg.slice('--tradeCreatedAt='.length);
      continue;
    }
    if (arg === '--tradeCreatedAt') {
      tradeCreatedAt = args[index + 1] ?? '';
      index += 1;
    }
  }

  if (!validation) {
    throw new Error('missing --validation');
  }
  if (!router) {
    throw new Error('missing --router');
  }

  if (tradeCreatedAt) {
    return {
      validation,
      router,
      tradeCreatedAt
    };
  }

  return {
    validation,
    router
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const runOptions = args.tradeCreatedAt
    ? {
      validationConfigPath: args.validation,
      routerConfigPath: args.router,
      tradeCreatedAt: args.tradeCreatedAt
    }
    : {
      validationConfigPath: args.validation,
      routerConfigPath: args.router
    };

  const report = await runRouterValidation(runOptions);
  const trainId = loadTrainIdFromValidationConfig(args.validation);
  const configKey = resolveArtifactConfigKey(args.validation);
  const reportPayload = trainId
    ? {
        ...report,
        trainId
      }
    : report;

  await saveTrainArtifact(db, {
    artifactKey: `router-validation:${report.routerVersion}:${report.period.startTimeMs}:${report.period.endTimeMs}`,
    artifactType: 'router-validation',
    trainId,
    configKey,
    symbol: report.symbol,
    periodStartMs: report.period.startTimeMs,
    periodEndMs: report.period.endTimeMs,
    payload: reportPayload,
    metadata: {
      routerVersion: report.routerVersion,
      beatDefault: Number((report.comparison.router.totalPnl - report.comparison.defaultStrategy.totalPnl).toFixed(2))
    }
  });

  console.log(`Router validation artifact saved: router-validation:${report.routerVersion}:${report.period.startTimeMs}:${report.period.endTimeMs}`);
  console.log('Structured output is stored in DB; keep files only for AI summary markdown.');
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
