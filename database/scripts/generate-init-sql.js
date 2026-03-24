const fs = require('fs');
const path = require('path');
const { INIT_DDLS } = require('..');

const outputPath = path.resolve(__dirname, '..', 'sql', 'init.sql');
const header = [
  '-- Generated from @money/database. Do not edit manually.',
  'SET NAMES utf8mb4;',
  ''
].join('\n');
const body = INIT_DDLS.map((ddl) => `${ddl.trim()};`).join('\n\n');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${header}${body}\n`, 'utf8');

console.log(`Wrote ${outputPath}`);
