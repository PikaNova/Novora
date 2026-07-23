import { useCallback, useEffect, useState } from 'react';

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function currentFsElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const doc = document as FsDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * 全屏控制：兼容标准 API 与 -webkit- 前缀（旧版 Safari / 部分安卓 WebView）。
 * enter() 返回的 Promise 在浏览器因缺少用户手势而拒绝时会 reject，
 * 调用方可据此回退到“轻触进入全屏”的引导浮层。
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => !!currentFsElement());

  useEffect(() => {
    const sync = () => setIsFullscreen(!!currentFsElement());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync as EventListener);
    sync();
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync as EventListener);
    };
  }, []);

  const enter = useCallback(async () => {
    if (currentFsElement()) return;
    const el = document.documentElement as FsElement;
    const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (!request) throw new Error('Fullscreen API unavailable');
    await request.call(el);
  }, []);

  const exit = useCallback(async () => {
    if (!currentFsElement()) return;
    const doc = document as FsDocument;
    const request = document.exitFullscreen ?? doc.webkitExitFullscreen;
    if (!request) return;
    await request.call(document);
  }, []);

  const toggle = useCallback(async () => {
    if (currentFsElement()) await exit();
    else await enter();
  }, [enter, exit]);

  return { isFullscreen, enter, exit, toggle };
}
