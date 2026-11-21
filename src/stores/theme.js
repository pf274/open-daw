/**
 * Light / dark mode. The preference ('system' | 'light' | 'dark') is remembered per browser;
 * 'system' follows the OS setting live. The resolved theme goes on <html data-theme="…">,
 * which style.css keys its colour tokens on, and into ui.themeResolved for the canvas piano roll.
 */
import { watch } from 'vue';
import { ui } from './ui.js';

export const THEMES = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];
const KEY = 'open-daw-theme'; // ui.js reads it on startup

const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null);
const systemTheme = () => (media()?.matches ? 'light' : 'dark');
export const resolveTheme = (pref = ui.theme) => (pref === 'light' || pref === 'dark' ? pref : systemTheme());

function apply() {
  ui.themeResolved = resolveTheme();
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = ui.themeResolved;
    document.documentElement.style.colorScheme = ui.themeResolved; // native controls & scrollbars match
  }
}

export function setTheme(pref) {
  ui.theme = THEMES.some((t) => t.value === pref) ? pref : 'system';
  try { localStorage.setItem(KEY, ui.theme); } catch { /* per-viewer convenience only */ }
}
/** Header button: switch to the opposite of what's showing (an explicit choice, no longer following the system). */
export const toggleTheme = () => setTheme(ui.themeResolved === 'light' ? 'dark' : 'light');

let installed = false;
export function installTheme() {
  if (installed) { apply(); return; }
  installed = true;
  watch(() => ui.theme, apply, { immediate: true });
  const m = media();
  const onChange = () => { if (ui.theme === 'system') apply(); };
  m?.addEventListener?.('change', onChange);
}
