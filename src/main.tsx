import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Debug: mark that main.tsx executed
try { console.info('[renderer] main.tsx loaded'); } catch {}

const rootEl = document.getElementById('root');
if (rootEl) {
	try {
		// Show a small banner during first mount to verify paint
		try {
			const dbg = document.createElement('div');
			dbg.textContent = 'Mounting UI...';
			dbg.style.cssText = 'position:fixed;left:8px;bottom:8px;background:#10b981;color:#032;opacity:.85;padding:2px 6px;border-radius:4px;font-size:10px;z-index:2147483647;pointer-events:none';
			document.body.appendChild(dbg);
			setTimeout(() => dbg.remove(), 2500);
		} catch {}

		const root = createRoot(rootEl);
		root.render(React.createElement(App));
	} catch (e) {
		// Failsafe: show error on screen
		const msg = e instanceof Error ? e.message : String(e);
		rootEl.innerHTML = `<pre style="white-space:pre-wrap;background:#3b0d0d;color:#fff;padding:12px;border-radius:8px">Render error: ${msg}</pre>`;
		try { console.error('[renderer] mount failed:', e); } catch {}
	}
} else {
	try { console.warn('[renderer] #root not found'); } catch {}
}
