import { jsx as _jsx } from "react/jsx-runtime";
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { SessionProvider } from './state/session';
import './styles/base.css';
const container = document.getElementById('root');
if (container === null)
    throw new Error('No #root element to mount into.');
createRoot(container).render(_jsx(StrictMode, { children: _jsx(BrowserRouter, { children: _jsx(SessionProvider, { children: _jsx(App, {}) }) }) }));
