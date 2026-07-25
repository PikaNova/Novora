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

function openDialog(options: AppDialogOptions): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise(resolve => {
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
