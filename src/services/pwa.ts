export type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: InstallPromptEvent | null = null;
let updateReady = false;
export const PWA_UPDATE_EVENT = 'pwa:update-ready';
export function registerPwa(): void {
  if ('serviceWorker' in navigator) window.addEventListener('load', () => {
    const hadController = !!navigator.serviceWorker.controller;
    void navigator.serviceWorker.register('/service-worker.js').then(registration => {
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            updateReady = true;
            window.dispatchEvent(new Event(PWA_UPDATE_EVENT));
          }
        });
      });
      if (registration.waiting) { updateReady = true; window.dispatchEvent(new Event(PWA_UPDATE_EVENT)); }
    }).catch(() => { /* PWA 注册失败不影响网页正常使用 */ });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) { updateReady = true; window.dispatchEvent(new Event(PWA_UPDATE_EVENT)); }
    });
  });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred = event as InstallPromptEvent; window.dispatchEvent(new Event('pwa:available')); });
}
export function canInstallPwa(): boolean { return !!deferred && !window.matchMedia('(display-mode: standalone)').matches; }
export async function promptInstallPwa(): Promise<boolean> { if (!deferred) return false; const e = deferred; await e.prompt(); const choice = await e.userChoice; if (choice.outcome === 'accepted') deferred = null; return choice.outcome === 'accepted'; }
export function isStandalonePwa(): boolean { return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true; }
/** 仅刷新应用代码；考试安排与待同步本地数据均保存在 localStorage，不会被清除。 */
export async function applyPwaUpdate(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration?.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
  if (updateReady || 'serviceWorker' in navigator) window.location.reload();
}
