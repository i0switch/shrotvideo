'use strict';
const path = require('path');
const fs = require('fs');
const entry = path.join(__dirname, 'dist', 'electron', 'electron', 'main.js');
if (!fs.existsSync(entry)) {
  console.error('[electron-entry] main not found:', entry);
  process.exit(1);
}
console.info('[electron-entry] loading:', entry);
require(entry);
