// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

const ExportOverlay = (await import('../src/components/ExportOverlay.vue')).default;
const { exportState, cancelExport } = await import('../src/engine/files.js');
const { installKeyboard } = await import('../src/engine/keyboard.js');
const { transport } = await import('../src/engine/transport.js');

afterEach(() => Object.assign(exportState, { rendering: false, phase: '', progress: null, cancelled: false }));

describe('WAV export progress overlay', () => {
  it('is hidden until an export runs, then shows a spinner, the percentage while rendering, and Cancel', async () => {
    const w = mount(ExportOverlay);
    expect(w.find('.card').exists()).toBe(false);
    Object.assign(exportState, { rendering: true, phase: 'samples', progress: null, scope: 'song' });
    await nextTick();
    expect(w.text()).toContain('Loading piano samples');
    expect(w.find('svg').classes()).toContain('spin');
    expect(w.find('.pct').exists()).toBe(false);
    Object.assign(exportState, { phase: 'render', progress: 0.42 });
    await nextTick();
    expect(w.find('.pct').text()).toBe('42%');
    expect(w.text()).toContain('Rendering the song');
    expect(w.find('svg').classes()).not.toContain('spin');
    expect(w.find('[role=progressbar]').attributes('aria-valuenow')).toBe('42');
    await w.find('.card button').trigger('click');
    expect(exportState.cancelled).toBe(true);
    expect(w.find('.card button').text()).toBe('Cancelling…');
    exportState.rendering = false;
    await nextTick();
    expect(w.find('.card').exists()).toBe(false);
    w.unmount();
  });

  it('while exporting, Esc cancels and other shortcuts (Space = play) are ignored', () => {
    const off = installKeyboard();
    Object.assign(exportState, { rendering: true, phase: 'render', progress: 0.1 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', cancelable: true }));
    expect(transport.playing).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(exportState.cancelled).toBe(true);
    off();
  });

  it('cancelExport does nothing when no export is running', () => {
    cancelExport();
    expect(exportState.cancelled).toBe(false);
  });
});
