/**
 * In-app confirmation dialog (rendered by ConfirmModal.vue), used like window.confirm but styled:
 *   if (await askConfirm({ title: 'Delete "Verse"?', message: '…', confirmLabel: 'Delete' })) …
 * Resolves true on confirm, false on cancel / Esc / clicking outside. A new request cancels a pending one.
 * askText({ title, value, … }) is the same dialog with a text field: resolves the text, or null on cancel.
 */
import { reactive } from 'vue';

export const confirmState = reactive({ open: false, title: '', message: '', confirmLabel: 'OK', danger: false, input: null, inputLabel: '' });
let pending = null;

export function askConfirm({ title, message = '', confirmLabel = 'OK', danger = false }) {
  pending?.(false);
  Object.assign(confirmState, { open: true, title, message, confirmLabel, danger, input: null, inputLabel: '' });
  return new Promise((resolve) => { pending = resolve; });
}

export function askText({ title, message = '', value = '', label = '', confirmLabel = 'OK' }) {
  pending?.(false);
  Object.assign(confirmState, { open: true, title, message, confirmLabel, danger: false, input: value, inputLabel: label });
  return new Promise((resolve) => { pending = (yes) => resolve(yes ? confirmState.input : null); });
}

export function answerConfirm(yes) {
  confirmState.open = false;
  const r = pending;
  pending = null;
  r?.(!!yes);
}

import.meta.hot?.decline();
