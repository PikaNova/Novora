import { getAppSettings, APP_SETTINGS_CHANGED_EVENT, type MotionMode } from './appSettings';

/**
 * 将动效模式写到 <html data-motion="...">，由 motion.css 统一处理：
 * - auto：保持默认（各设计自己的 prefers-reduced-motion 仍生效）。
 * - best-effects：强制开启动效与平滑滚动（忽略系统“减少动态效果”）。
 * - best-performance：全局关停动画/过渡/毛玻璃，降低一体机/低端设备负载。
 */
export function applyMotionSettings(mode: MotionMode = getAppSettings().general.motionMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-motion', mode || 'auto');
}

export function bindMotionSettings(): () => void {
  const apply = () => applyMotionSettings();
  apply();
  window.addEventListener(APP_SETTINGS_CHANGED_EVENT, apply);
  window.addEventListener('storage', apply);
  return () => {
    window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, apply);
    window.removeEventListener('storage', apply);
  };
}
