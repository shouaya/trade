/**
 * 配置文件加载工具
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ConfigExtractResult {
  readonly configName: string;
  readonly passthroughArgv: readonly string[];
}

function assertSafeConfigName(name: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`invalid config name: ${name}`);
  }
}

export function loadNamedConfig<T = unknown>(category: string, name: string): T {
  assertSafeConfigName(name);
  const filePath = path.resolve(__dirname, `../../configs/${category}/${name}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`config not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid json config: ${filePath} (${message})`);
  }
}

export function extractConfigArg(argv: readonly string[], defaultConfig: string): ConfigExtractResult {
  const args = argv.slice(2);
  const passthrough: string[] = [];
  let configName = defaultConfig;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg.startsWith('--config=')) {
      configName = arg.slice('--config='.length).trim() || defaultConfig;
      continue;
    }

    if (arg === '--config') {
      const nextArg = args[i + 1];
      configName = (nextArg || '').trim() || defaultConfig;
      i++;
      continue;
    }

    passthrough.push(arg);
  }

  return {
    configName,
    passthroughArgv: ['node', 'script.js', ...passthrough]
  };
}
