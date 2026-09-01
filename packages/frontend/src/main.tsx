import React from 'react';
import * as ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { FeaturesProvider } from './context/FeaturesContext';
import { BackendGate } from './context/BackendGate';
import App from './App';
import LoadingScreen from './components/LoadingScreen';
import './i18n';
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { showUpdatePrompt } from './pwa/updatePrompt';

// Expose React globally for plugin ESM modules (shim pattern). `react-dom/client` only carries
// createRoot/hydrateRoot — plugins that import { createPortal, flushSync } from 'react-dom'
// need the full namespace, so __OSCARR_REACT_DOM__ exposes that, not the client subpath.
(globalThis as any).__OSCARR_REACT__ = React;
(globalThis as any).__OSCARR_REACT_DOM__ = ReactDOM;
(globalThis as any).__OSCARR_JSX_RUNTIME__ = jsxRuntime;

// A new build reaches open tabs as an offer, not as an interruption. The worker registers with
// `registerType: 'prompt'`, so it stays in `waiting` until `updateSW(true)` lets it through —
// the page keeps running against the assets it started with, and nothing typed into a form is
// lost to a reload nobody asked for.
const updateSW = registerSW({
  onNeedRefresh() {
    showUpdatePrompt(() => { void updateSW(true); });
  },
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <BackendGate fallback={<LoadingScreen />}>
        <AuthProvider>
          <FeaturesProvider>
            <App />
          </FeaturesProvider>
        </AuthProvider>
      </BackendGate>
    </BrowserRouter>
  </React.StrictMode>
);
