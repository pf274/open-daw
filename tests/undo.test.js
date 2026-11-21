// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));
vi.mock('../src/engine/preview.js', () => ({ previewNotes: () => 1, stopPreview: vi.fn() }));

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});

const App = (await import('../src/App.vue')).default;
const { history, undo, redo } = await import('../src/stores/history.js');
const { view, bx, py } = await import('../src/stores/view.js');
const { createRollInteraction } = await import('../src/roll/interaction.js');
const { ACTIONS, applyTremor } = await import('../src/engine/editing.js');
const { curTrack } = await import('../src/stores/project.js');
const { ui } = await import('../src/stores/ui.js');

const slides = () => curTrack().notes.map((n) => n.slideTo ?? null);
const tremors = () => curTrack().notes.map((n) => (n.tremor ? n.tremor.depth : null));
const key = (k, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, ...opts }));

describe('undo/redo of slides and tremor through the UI', () => {
  let w;
  const click = (label) => w.findAll('button').find((b) => b.text().startsWith(label)).trigger('click');
  const menu = async (label) => {
    Object.assign(ui.ctxMenu, { open: true, x: 10, y: 10, beat: 0 });
    await flushPromises();
    await w.findAll('.ctx button').find((b) => b.text().startsWith(label)).trigger('click');
    await flushPromises();
  };
  beforeAll(() => { w = mount(App, { attachTo: document.body }); });

  it('connect → undo → redo (buttons and keys)', async () => {
    curTrack().notes = [
      { id: 1, start: 0, dur: 1, pitch: 60, vel: 90 },
      { id: 2, start: 1, dur: 1, pitch: 62, vel: 90 },
      { id: 3, start: 2, dur: 1, pitch: 64, vel: 90 },
    ];
    ui.sel = new Set([1, 2, 3]);
    await menu('Connect');
    expect(slides()).toEqual([2, 3, null]);
    await click('↶');
    expect(slides()).toEqual([null, null, null]);
    await click('↷');
    expect(slides()).toEqual([2, 3, null]);
    key('z');
    expect(slides()).toEqual([null, null, null]);
    key('z', { shiftKey: true });
    expect(slides()).toEqual([2, 3, null]);
  });

  it('tremor → undo → redo', async () => {
    ui.sel = new Set([2]);
    await menu('Tremor');
    await w.find('.modal input[type=range]').setValue('60');
    await w.findAll('.modal button').find((b) => b.text() === 'Apply').trigger('click');
    expect(tremors()).toEqual([null, 60, null]);
    key('z');
    expect(tremors()).toEqual([null, null, null]);
    key('y');
    expect(tremors()).toEqual([null, 60, null]);
  });

  it('a later edit, undone, keeps the earlier slides and tremor', async () => {
    ui.sel = new Set([1, 2, 3]);
    key('ArrowUp', { ctrlKey: false }); // transpose
    expect(curTrack().notes.map((n) => n.pitch)).toEqual([61, 63, 65]);
    key('z');
    expect(curTrack().notes.map((n) => n.pitch)).toEqual([60, 62, 64]);
    expect(slides()).toEqual([2, 3, null]);
    expect(tremors()).toEqual([null, 60, null]);
  });

  it('dragging notes, then undo, keeps slides and tremor', async () => {
    // simulate a move-drag the way interaction.js does: pushUndo + mutate proxies
    const { pushUndo, undo } = await import('../src/stores/history.js');
    pushUndo();
    curTrack().notes.forEach((n) => { n.start += 4; });
    undo();
    expect(curTrack().notes.map((n) => n.start)).toEqual([0, 1, 2]);
    expect(slides()).toEqual([2, 3, null]);
    expect(tremors()).toEqual([null, 60, null]);
  });
});

describe('mouse gestures and history (regression: a click used to wipe redo)', () => {
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }), style: {} };
  let r;
  const at = (beat, pitch) => ({ clientX: bx(beat), clientY: py(pitch) + 5 });
  const down = (beat, pitch, mods = {}) => r.onMouseDown({ button: 0, shiftKey: false, altKey: false, ...at(beat, pitch), ...mods });
  const move = (beat, pitch, dx = 0) => { const p = at(beat, pitch); r.onMouseMove({ clientX: p.clientX + dx, clientY: p.clientY }); };
  const up = () => r.onMouseUp({});

  beforeAll(() => {
    r = createRollInteraction(canvas);
    Object.assign(view, { W: 800, H: 500, KEYW: 46 });
    Object.assign(ui, { topPitch: 72, scrollX: 0, ppb: 80, row: 14, snap: 0.25 });
  });
  const seed = () => {
    curTrack().notes = [
      { id: 11, start: 0, dur: 1, pitch: 60, vel: 90 },
      { id: 12, start: 1, dur: 1, pitch: 62, vel: 90 },
    ];
    ui.sel = new Set([11, 12]);
  };

  it('clicking a note after undo keeps redo (slides come back)', () => {
    seed();
    ACTIONS.connect();
    undo();
    expect(history.canRedo).toBe(true);
    down(0.5, 60); up();
    expect(history.canRedo).toBe(true);
    redo();
    expect(slides()).toEqual([12, null]);
  });

  it('clicking a note after undo keeps redo (tremor comes back)', () => {
    seed();
    applyTremor({ depth: 45, rate: 6 });
    undo();
    down(1.5, 62); up();
    redo();
    expect(tremors()).toEqual([45, 45]);
  });

  it('a 1–2 px jitter is still a click: no change, no history entry', () => {
    seed();
    const before = curTrack().notes.map((n) => n.start);
    const canUndo = history.canUndo;
    down(0.5, 60); move(0.5, 60, 2); up();
    expect(curTrack().notes.map((n) => n.start)).toEqual(before);
    expect(history.canUndo).toBe(canUndo);
  });

  it('a real drag is one undo step and keeps slides/tremor through undo', () => {
    seed();
    ACTIONS.connect();
    ui.sel = new Set([12]);
    applyTremor({ depth: 30, rate: 5 });
    ui.sel = new Set([11, 12]);
    down(0.5, 60); move(2.5, 60); up();
    expect(curTrack().notes.map((n) => n.start)).toEqual([2, 3]);
    undo();
    expect(curTrack().notes.map((n) => n.start)).toEqual([0, 1]);
    expect(slides()).toEqual([12, null]);
    expect(tremors()).toEqual([null, 30]);
    redo();
    expect(curTrack().notes.map((n) => n.start)).toEqual([2, 3]);
    expect(slides()).toEqual([12, null]);
  });

  it('Alt-click without dragging leaves no copies and no history', () => {
    seed();
    const canRedo = history.canRedo, count = curTrack().notes.length;
    down(0.5, 60, { altKey: true }); up();
    expect(curTrack().notes).toHaveLength(count);
    expect(history.canRedo).toBe(canRedo);
  });
});
