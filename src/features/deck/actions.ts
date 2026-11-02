import { useState, type ReactNode } from 'react';
import { useNotificationStore } from '@/stores';
import type { NotificationType } from '@/types';

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const notify = (message: string, type: NotificationType = 'success') =>
  useNotificationStore.getState().showNotification(message, type);

/** Asks in the dashboard's confirmation dialog; resolves true when confirmed. */
export const ask = (title: string, message: ReactNode, confirmText: string, danger = false) =>
  new Promise<boolean>((resolve) =>
    useNotificationStore.getState().showConfirmation({
      title,
      message,
      confirmText,
      variant: danger ? 'danger' : 'primary',
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    })
  );

/** One action at a time per component: its name while it runs, and its error as a notification. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);

    try {
      await action();
    } catch (error) {
      notify(messageOf(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  return { busy, run };
}
