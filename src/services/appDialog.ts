export type AppDialogTone = 'info' | 'warning' | 'danger';

export type AppDialogOptions = {
  title: string;
  message: string;
  tone?: AppDialogTone;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type AppDialogRequest = AppDialogOptions & {
  id: string;
  resolve: (confirmed: boolean) => void;
};

export const APP_DIALOG_EVENT = 'novora:app-dialog';

/**
 * 当前有多少个确认框还没关闭。
 * 弹窗层（例如编辑器弹窗）的 Esc 处理要先问一下：确认框开着时 Esc 只该关确认框，
 * 不能顺手把下面那一层也关掉。
 */
let openDialogCount = 0;

export function hasOpenAppDialog(): boolean {
  return openDialogCount > 0;
}

export function setAppDialogOpenCount(count: number): void {
  openDialogCount = Math.max(0, Math.trunc(count));
}

function openDialog(options: AppDialogOptions): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const detail: AppDialogRequest = {
      tone: 'info',
      confirmLabel: '确定',
      ...options,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      resolve,
    };
    window.dispatchEvent(new CustomEvent(APP_DIALOG_EVENT, { detail }));
  });
}

export function confirmDialog(options: AppDialogOptions): Promise<boolean> {
  return openDialog({ cancelLabel: '取消', ...options });
}

export async function infoDialog(options: AppDialogOptions): Promise<void> {
  await openDialog(options);
}
