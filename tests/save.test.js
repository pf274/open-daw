// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});

const App = (await import('../src/App.vue')).default;
const { saveProject, saveState, jsonFileName, loadProjectFile, newProject } = await import('../src/engine/files.js');
const { resetProject, serialize } = await import('../src/stores/project.js');
const { ui } = await import('../src/stores/ui.js');

describe('choosing the file name when saving', () => {
  let w, downloads;
  beforeEach(async () => {
    resetProject();
    Object.assign(saveState, { name: 'whistle-project.json', handle: null });
    downloads = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloads.push(this.download); });
    ui.tab = 'file';
    w = mount(App, { attachTo: document.body });
    await flushPromises();
  });
  afterEach(() => { w.unmount(); vi.restoreAllMocks(); delete window.showSaveFilePicker; });

  it('cleans up typed names', () => {
    expect(jsonFileName('my song')).toBe('my song.json');
    expect(jsonFileName('Verse.JSON')).toBe('Verse.JSON');
    expect(jsonFileName('a/b:c?')).toBe('a-b-c-.json');
    expect(jsonFileName('   ')).toBe('whistle-project.json');
  });

  it('without a system save window: asks for a name (name selected, not ".json"), then downloads under it', async () => {
    const saving = saveProject();
    await flushPromises();
    const input = w.find('.modal input[type=text]');
    expect(input.exists()).toBe(true);
    expect(input.element.value).toBe('whistle-project.json');
    expect([input.element.selectionStart, input.element.selectionEnd]).toEqual([0, 'whistle-project'.length]);
    await input.setValue('  ');
    expect(w.find('.modal button.ok').attributes('disabled')).toBeDefined(); // no empty names
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    input.element.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false); // spaces can be typed in the name
    await input.setValue('Summer jam');
    await w.find('.modal button.ok').trigger('click');
    await saving;
    expect(downloads).toEqual(['Summer jam.json']);
    // offered again next time; Cancel saves nothing
    const again = saveProject();
    await flushPromises();
    expect(w.find('.modal input[type=text]').element.value).toBe('Summer jam.json');
    await w.find('.modal button.cancel').trigger('click');
    await again;
    expect(downloads).toHaveLength(1);
  });

  it('with the system save window (Chrome / Edge): writes the chosen file and starts there next time', async () => {
    const written = [];
    const handle = { name: 'Chorus ideas.json', createWritable: async () => ({ write: async (t) => written.push(t), close: async () => {} }) };
    window.showSaveFilePicker = vi.fn(async () => handle);
    await saveProject();
    expect(window.showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'whistle-project.json', startIn: 'documents' }));
    expect(JSON.parse(written[0])).toEqual(JSON.parse(serialize()));
    expect(downloads).toEqual([]);
    await saveProject();
    expect(window.showSaveFilePicker).toHaveBeenLastCalledWith(expect.objectContaining({ suggestedName: 'Chorus ideas.json', startIn: handle }));
    // cancelling the window saves nothing and asks nothing more
    window.showSaveFilePicker = vi.fn(async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); });
    await saveProject();
    await flushPromises();
    expect(w.find('.modal').exists()).toBe(false);
    expect(written).toHaveLength(2);
  });

  it('opening a project offers its name when saving; New goes back to the default', async () => {
    await loadProjectFile(new File([serialize()], 'Bridge.json', { type: 'application/json' }));
    expect(saveState.name).toBe('Bridge.json');
    newProject();
    expect(saveState.name).toBe('whistle-project.json');
  });
});
