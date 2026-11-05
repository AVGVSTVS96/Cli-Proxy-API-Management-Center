import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/global.scss';
import { BRAND_MARK, BRAND_NAME } from '@/assets/brand';
import App from './App.tsx';

document.title = BRAND_NAME;
document.documentElement.setAttribute('translate', 'no');
document.documentElement.classList.add('notranslate');

const faviconEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (faviconEl) {
  faviconEl.href = BRAND_MARK;
  faviconEl.type = 'image/svg+xml';
} else {
  const newFavicon = document.createElement('link');
  newFavicon.rel = 'icon';
  newFavicon.type = 'image/svg+xml';
  newFavicon.href = BRAND_MARK;
  document.head.appendChild(newFavicon);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
