import '@fontsource-variable/bricolage-grotesque/opsz.css'; // the app's typeface, bundled (no font CDN)
import '@fontsource/barlow-semi-condensed/500.css'; // the in-call chat: narrow, so more fits on a line
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/barlow-semi-condensed/700.css';
import '@livekit/components-styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store';
import './styles.css';

document.documentElement.lang = useStore.getState().lang;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
