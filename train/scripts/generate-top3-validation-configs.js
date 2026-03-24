#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

const scriptPath = path.resolve(__dirname, '../dist/scripts/generate-validation-artifacts.js');
const result = spawnSync(process.execPath, [scriptPath, ...process.argv.slice(2)], {
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
