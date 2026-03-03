function parseList(value) {
  if (!value) return null;
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function toInt(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTrainCliArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    limit: null,
    types: null,
    topN: 10,
    retainDays: 1
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--limit=')) parsed.limit = toInt(arg.split('=')[1], null);
    else if (arg === '--limit') parsed.limit = toInt(args[++i], null);
    else if (arg.startsWith('--types=')) parsed.types = parseList(arg.split('=')[1]);
    else if (arg === '--types') parsed.types = parseList(args[++i]);
    else if (arg.startsWith('--topN=')) parsed.topN = toInt(arg.split('=')[1], 10);
    else if (arg === '--topN') parsed.topN = toInt(args[++i], 10);
    else if (arg.startsWith('--retainDays=')) parsed.retainDays = toInt(arg.split('=')[1], 1);
    else if (arg === '--retainDays') parsed.retainDays = toInt(args[++i], 1);
    else if (parsed.limit === null) parsed.limit = toInt(arg, null);
    else if (parsed.types === null) parsed.types = parseList(arg);
  }

  return parsed;
}

module.exports = {
  parseTrainCliArgs
};
