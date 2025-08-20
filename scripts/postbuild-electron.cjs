'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'dist', 'electron', 'electron');
const pkgPath = path.join(dir, 'package.json');
const preloadJs = path.join(dir, 'preload.js');
const preloadCjs = path.join(dir, 'preload.cjs');
fs.mkdirSync(dir, { recursive: true });
const data = { type: 'commonjs' };
fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2));
try {
	if (fs.existsSync(preloadJs)) {
		fs.copyFileSync(preloadJs, preloadCjs);
		console.log('[postbuild-electron] copied preload.js -> preload.cjs');
	}
} catch (e) {
	console.warn('[postbuild-electron] failed to create preload.cjs:', e?.message || e);
}
console.log('[postbuild-electron] wrote', pkgPath);
