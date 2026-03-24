import * as path from 'path';

interface DotenvLike {
  readonly config: (options?: { readonly path?: string }) => unknown;
}

export function resolveTrainEnvPaths(): readonly string[] {
  const isTestEnv = String(process.env['NODE_ENV'] || '').trim() === 'test';

  return [
    ...(isTestEnv ? [path.resolve(__dirname, '../../.env.test')] : []),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../backend/.env'),
    path.resolve(__dirname, '../../../.env')
  ];
}

export function loadTrainEnv(dotenv: DotenvLike): void {
  for (const envPath of resolveTrainEnvPaths()) {
    dotenv.config({ path: envPath });
  }
}
