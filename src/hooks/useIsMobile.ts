import { useEffect, useState } from 'react';

/**
 * 手机端判定：窄屏（≤620px），或粗指针（触屏）且≤900px。
 * 专门用于“手机端只展示已适配设计”的检测；与各设计自身的响应式断点互不影响。
 */
export const MOBILE_MEDIA_QUERY = '(max-width: 620px), (pointer: coarse) and (max-width: 900px)';

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(() => isMobileDevice());
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    window.addEventListener('resize', on);
    return () => {
      mq.removeEventListener?.('change', on);
      window.removeEventListener('resize', on);
    };
  }, []);
  return mobile;
}
