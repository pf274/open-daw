/**
 * In-app confirmation dialog (rendered by ConfirmModal.vue), used like window.confirm but styled:
 *   if (await askConfirm({ title: 'Delete "Verse"?', message: '…', confirmLabel: 'Delete' })) …
 * Resolves true on confirm, false on cancel / Esc / clicking outside. A new request cancels a pending one.
 */
import { reactive } from 'vue';

export const confirmState = reactive({ open: false, title: '', message: '', confirmLabel: 'OK', danger: false });
let pending = null;

export function askConfirm({ title, message = '', confirmLabel = 'OK', danger = false }) {
  pending?.(false);
  Object.assign(confirmState, { open: true, title, message, confirmLabel, danger });
  return new Promise((resolve) => { pending = resolve; });
}

export function answerConfirm(yes) {
  confirmState.open = false;
  const r = pending;
  pending = null;
  r?.(!!yes);
}

import.meta.hot?.decline();
