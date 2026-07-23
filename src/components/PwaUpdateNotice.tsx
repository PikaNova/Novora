import { useEffect, useState } from 'react';
import { PWA_UPDATE_EVENT, applyPwaUpdate } from '../services/pwa';
import '../styles/pwa-update.css';

export default function PwaUpdateNotice() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const show = () => setAvailable(true);
    window.addEventListener(PWA_UPDATE_EVENT, show);
    return () => window.removeEventListener(PWA_UPDATE_EVENT, show);
  }, []);
  if (!available) return null;
  return <div className="pwa-update-notice" role="status"><span>发现新版本，考试本地数据会保留</span><button onClick={() => { void applyPwaUpdate(); }}>立即更新</button><button className="pwa-update-notice__later" onClick={() => setAvailable(false)}>稍后</button></div>;
}
