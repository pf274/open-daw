// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));

let systemLight = false;
const listeners = [];
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.matchMedia = () => ({ get matches() { return systemLight; }, addEventListener: (_, fn) => listeners.push(fn) });
});

describe('light / dark mode', () => {
  it('follows the system by default, can be forced from Settings or the header, and is remembered', async () => {
    localStorage.removeItem('open-daw-theme');
    const App = (await import('../src/App.vue')).default;
    const { ui } = await import('../src/stores/ui.js');
    const html = document.documentElement;
    const w = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(ui.theme).toBe('system');
    expect(html.dataset.theme).toBe('dark');

    systemLight = true; // the OS switches to light
    listeners.forEach((fn) => fn());
    expect(html.dataset.theme).toBe('light');

    ui.tab = 'settings';
    await flushPromises();
    await w.find('select[aria-label="Theme"]').setValue('dark');
    expect(ui.theme).toBe('dark');
    await flushPromises();
    expect(html.dataset.theme).toBe('dark');
    expect(localStorage.getItem('open-daw-theme')).toBe('dark');
    listeners.forEach((fn) => fn()); // a forced theme ignores the system
    expect(html.dataset.theme).toBe('dark');

    await w.find('button.theme').trigger('click');
    await flushPromises();
    expect(ui.theme).toBe('light');
    expect(html.dataset.theme).toBe('light');
    expect(w.find('button.theme').text()).toBe('☾');
    w.unmount();
  });
});
