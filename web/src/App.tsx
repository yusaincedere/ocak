import { useEffect, useState } from 'react';
import { CallView } from './components/CallView';
import { useDesktopSettingsLoader } from './components/DesktopIntegration';
import { DesktopSettings } from './components/DesktopSettings';
import { Home } from './components/Home';
import { Gear } from './components/Icons';
import { api } from './api';
import { desktop } from './desktop-bridge';
import { useT } from './i18n';
import { roomFromLocation } from './links';
import { useStore } from './store';

export function App() {
  const call = useStore((s) => s.call);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The invite in the URL (/r/<id>#<password>) is used once; after that you're back to a normal home screen.
  const [invite, setInvite] = useState(roomFromLocation);
  useEffect(() => {
    if (call) setInvite(null);
  }, [call]);
  useDesktopSettingsLoader();
  useEffect(() => {
    api
      .config()
      .then((c) => useStore.getState().setServerConfig(c))
      .catch(() => {});
  }, []);
  const t = useT();

  return (
    <>
      {call ? <CallView call={call} /> : <Home invite={invite} />}
      {!call && desktop && (
        <button className="icon-btn corner" title={t('common.settings')} aria-label={t('common.settings')} onClick={() => setSettingsOpen(true)}>
          <Gear />
        </button>
      )}
      {settingsOpen && <DesktopSettings onClose={() => setSettingsOpen(false)} />}
      <Notice />
    </>
  );
}

function Notice() {
  const notice = useStore((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useStore.getState().setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className="toast" role="status" onClick={() => useStore.getState().setNotice(null)}>
      {notice}
    </div>
  );
}
