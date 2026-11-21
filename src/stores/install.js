/**
 * Installing OpenDAW as an app (a PWA): registers the service worker that lets it start offline,
 * and keeps the browser's install prompt so Settings can offer an Install button.
 * Browsers without a prompt (Safari) install from their own menu: Share → Add to Home Screen.
 */
import { reactive } from 'vue';

export const install = reactive({
  canPrompt: false, // the browser offered an install prompt we can show
  installed: false, // running as the installed app
});

let deferred = null;

const standalone = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone === true);

export function setupInstall() {
  if (typeof window === 'undefined') return;
  install.installed = standalone();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show it from our button instead of the browser's mini-bar
    deferred = e;
    install.canPrompt = true;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    install.canPrompt = false;
    install.installed = true;
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ }));
  }
}

/** Show the browser's install dialog. Resolves true if the user accepted. */
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  install.canPrompt = false;
  e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === 'accepted';
}

/** Is this Safari on an iPhone / iPad (no install prompt: Share → Add to Home Screen)? */
export const isIOS = () => typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
