import '@fontsource-variable/bricolage-grotesque/opsz.css'; // the app's typeface, bundled (no font CDN)
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
