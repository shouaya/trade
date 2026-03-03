const fs = require('fs');
const path = require('path');

function assertSafeConfigName(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`invalid config name: ${name}`);
  }
}

function loadNamedConfig(category, name) {
  assertSafeConfigName(name);
  const filePath = path.resolve(__dirname, `../configs/${category}/${name}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`config not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`invalid json config: ${filePath} (${error.message})`);
  }
}

function extractConfigArg(argv, defaultConfig) {
  const args = argv.slice(2);
  const passthrough = [];
  let configName = defaultConfig;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--config=')) {
      configName = arg.slice('--config='.length).trim() || defaultConfig;
      continue;
    }

    if (arg === '--config') {
      configName = (args[i + 1] || '').trim() || defaultConfig;
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

module.exports = {
  loadNamedConfig,
  extractConfigArg
};
