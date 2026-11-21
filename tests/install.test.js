// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { install, setupInstall, promptInstall } = await import('../src/stores/install.js');

describe('installing as an app', () => {
  it('keeps the browser install prompt for the Install button, and forgets it once installed', async () => {
    setupInstall();
    expect(install.canPrompt).toBe(false);
    const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' }) });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true); // no browser mini-bar: our button shows it
    expect(install.canPrompt).toBe(true);
    expect(await promptInstall()).toBe(true);
    expect(e.prompt).toHaveBeenCalledOnce();
    expect(install.canPrompt).toBe(false);
    expect(await promptInstall()).toBe(false); // a prompt can only be shown once
    window.dispatchEvent(new Event('appinstalled'));
    expect(install.installed).toBe(true);
  });

  it('the manifest uses relative URLs (the app lives under /open-daw/) and its icons exist', () => {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(m).toMatchObject({ start_url: './', scope: './', display: 'standalone' });
    expect(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) {
      expect(i.src.startsWith('/')).toBe(false);
      expect(readFileSync(`public/${i.src}`).length).toBeGreaterThan(0);
    }
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('<link rel="manifest" href="manifest.webmanifest">');
  });
});

describe('the page never zooms', () => {
  it('cancels two-finger moves and iOS pinch gestures, not one-finger scrolling', async () => {
    const { installNoPageZoom } = await import('../src/composables/touch.js');
    const off = installNoPageZoom();
    const move = (n) => { const e = new Event('touchmove', { cancelable: true }); e.touches = Array(n).fill({}); document.dispatchEvent(e); return e.defaultPrevented; };
    expect(move(1)).toBe(false);
    expect(move(2)).toBe(true);
    const g = new Event('gesturestart', { cancelable: true });
    document.dispatchEvent(g);
    expect(g.defaultPrevented).toBe(true);
    off();
    expect(move(2)).toBe(false);
    expect(readFileSync('index.html', 'utf8')).toContain('user-scalable=no');
  });
});
