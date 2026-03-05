/**
 * 命令行参数解析工具
 */

export interface TrainCliArgs {
  readonly limit: number | null;
  readonly types: readonly string[] | null;
  readonly topN: number;
  readonly retainDays: number;
}

function parseList(value: string | undefined | null): readonly string[] | null {
  if (!value) return null;
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function toInt(value: string | undefined | null, fallback: number | null = null): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseTrainCliArgs(argv: readonly string[]): TrainCliArgs {
  const args = argv.slice(2);
  const parsed: {
    limit: number | null;
    types: readonly string[] | null;
    topN: number;
    retainDays: number;
  } = {
    limit: null,
    types: null,
    topN: 10,
    retainDays: 1
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg.startsWith('--limit=')) {
      const parts = arg.split('=');
      parsed.limit = toInt(parts[1], null);
    } else if (arg === '--limit') {
      parsed.limit = toInt(args[++i], null);
    } else if (arg.startsWith('--types=')) {
      const parts = arg.split('=');
      parsed.types = parseList(parts[1]);
    } else if (arg === '--types') {
      parsed.types = parseList(args[++i]);
    } else if (arg.startsWith('--topN=')) {
      const parts = arg.split('=');
      parsed.topN = toInt(parts[1], 10) ?? 10;
    } else if (arg === '--topN') {
      parsed.topN = toInt(args[++i], 10) ?? 10;
    } else if (arg.startsWith('--retainDays=')) {
      const parts = arg.split('=');
      parsed.retainDays = toInt(parts[1], 1) ?? 1;
    } else if (arg === '--retainDays') {
      parsed.retainDays = toInt(args[++i], 1) ?? 1;
    } else if (parsed.limit === null) {
      parsed.limit = toInt(arg, null);
    } else if (parsed.types === null) {
      parsed.types = parseList(arg);
    }
  }

  return parsed;
}
