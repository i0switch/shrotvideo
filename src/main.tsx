import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const rootEl = document.getElementById('root');
if (rootEl) {
	const root = createRoot(rootEl);
	root.render(React.createElement(App));
}
