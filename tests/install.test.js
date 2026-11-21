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
