import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App.tsx';
import './index.css';

if (Capacitor.isNativePlatform()) {
  // Scroll the focused input into view once the soft keyboard settles.
  // `resize: Native` already shrinks the WebView, but the browser doesn't
  // always re-scroll inside modal/overflow containers.
  import('@capacitor/keyboard').then(({ Keyboard }) => {
    Keyboard.addListener('keyboardDidShow', () => {
      const el = document.activeElement;
      if (el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  }).catch(() => { /* plugin missing on web — safe to ignore */ });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
