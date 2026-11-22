// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});

const App = (await import('../src/App.vue')).default;
const { project, curTrack, resetProject } = await import('../src/stores/project.js');
const { ui } = await import('../src/stores/ui.js');
const { device } = await import('../src/stores/device.js');
const { view, bx, py, RULER } = await import('../src/stores/view.js');
const { createRollInteraction } = await import('../src/roll/interaction.js');
const { installLongPress } = await import('../src/composables/touch.js');
const { pick, enterPick } = await import('../src/engine/pick.js');
const { rec } = await import('../src/engine/recorder.js');
const { transport } = await import('../src/engine/transport.js');
const { clearHistory } = await import('../src/stores/history.js');

let id = 1;
const touch = (x, y, extra = {}) => ({ pointerType: 'touch', pointerId: extra.pointerId ?? 1, button: 0, clientX: x, clientY: y, timeStamp: performance.now(), preventDefault() {}, ...extra });

describe('piano roll with a finger', () => {
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }), style: {} };
  let r;
  const at = (beat, pitch) => [bx(beat), py(pitch) + 5];
  const tap = (x, y, opts) => { r.onPointerDown(touch(x, y, opts)); r.onPointerUp(touch(x, y, opts)); };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    resetProject();
    clearHistory();
    r = createRollInteraction(canvas);
    Object.assign(view, { W: 800, H: 500, KEYW: 46 });
    Object.assign(ui, { topPitch: 72, scrollX: 4, ppb: 80, row: 14, snap: 0.25 });
    ui.sel.clear();
    ui.ctxMenu.open = false;
    curTrack().notes = [{ id: 7001, start: 5, dur: 1, pitch: 64, vel: 90 }];
  });
  afterEach(() => vi.useRealTimers());

  it('dragging empty space pans (no box selection); a tap clears the selection', () => {
    ui.sel = new Set([7001]);
    const [x, y] = at(8, 60);
    r.onPointerDown(touch(x, y));
    r.onPointerMove(touch(x - 160, y + 28));
    r.onPointerUp(touch(x - 160, y + 28));
    expect(ui.scrollX).toBeCloseTo(6); // 160 px = 2 beats later
    expect(ui.topPitch).toBeCloseTo(74);
    expect(ui.sel.has(7001)).toBe(true); // panning isn't a tap
    tap(x, y);
    expect(ui.sel.size).toBe(0);
  });

  it('double-tap empty space adds a note; double-tap a note deletes it', () => {
    const [x, y] = at(7, 60);
    tap(x, y);
    tap(x, y);
    expect(curTrack().notes.map((n) => [n.start, n.pitch])).toEqual([[5, 64], [7, 60]]);
    const [nx, ny] = at(5.3, 64);
    vi.advanceTimersByTime(1000);
    tap(nx, ny);
    tap(nx, ny);
    expect(curTrack().notes.map((n) => n.pitch)).toEqual([60]);
  });

  it('double-tap and drag on empty space box-selects (a plain drag still pans; lifting without a drag still adds a note)', () => {
    curTrack().notes.push({ id: 7002, start: 6, dur: 1, pitch: 62, vel: 90 }, { id: 7003, start: 9, dur: 1, pitch: 50, vel: 90 });
    const [x, y] = at(4.5, 66), [x2, y2] = at(7.5, 61);
    const scroll = ui.scrollX;
    tap(x, y);
    r.onPointerDown(touch(x, y));
    r.onPointerMove(touch(x2, y2));
    expect(view.drag?.mode).toBe('box');
    r.onPointerUp(touch(x2, y2));
    expect([...ui.sel].sort()).toEqual([7001, 7002]);
    expect(ui.scrollX).toBe(scroll); // no pan
    expect(view.drag).toBe(null);
    expect(curTrack().notes).toHaveLength(3); // no note added
    // the next tap starts afresh: it's not the second half of a double-tap
    vi.advanceTimersByTime(10);
    tap(x2, y2);
    expect(curTrack().notes).toHaveLength(3);
    // a second press that never drags is still a double-tap
    vi.advanceTimersByTime(1000);
    const [ax, ay] = at(11, 60);
    tap(ax, ay);
    tap(ax, ay);
    expect(curTrack().notes).toHaveLength(4);
  });

  it('a finger drags a note (with a wider resize edge), and a small wobble is still a tap', () => {
    const [x, y] = at(5.4, 64);
    r.onPointerDown(touch(x, y));
    r.onPointerMove(touch(x + 3, y + 2)); // wobble
    r.onPointerUp(touch(x + 3, y + 2));
    expect(curTrack().notes[0]).toMatchObject({ start: 5, pitch: 64, dur: 1 });
    r.onPointerDown(touch(x, y));
    r.onPointerMove(touch(x + 80, y));
    r.onPointerUp(touch(x + 80, y));
    expect(curTrack().notes[0].start).toBe(6);
    const [ex, ey] = at(6.9, 64); // 8 px from the end: a resize for a finger
    r.onPointerDown(touch(ex, ey));
    r.onPointerMove(touch(ex + 40, ey));
    r.onPointerUp(touch(ex + 40, ey));
    expect(curTrack().notes[0].dur).toBe(1.5);
  });

  it('long-press opens the note menu (and selects the pressed note)', () => {
    const [x, y] = at(5.5, 64);
    r.onPointerDown(touch(x, y));
    vi.advanceTimersByTime(600);
    expect(ui.ctxMenu).toMatchObject({ open: true, kind: 'note' });
    expect(ui.sel.has(7001)).toBe(true);
    r.onPointerUp(touch(x, y));
    expect(curTrack().notes).toHaveLength(1);
  });

  it('two fingers pinch to zoom time', () => {
    const [x, y] = at(8, 60);
    r.onPointerDown(touch(x - 50, y, { pointerId: 1 }));
    r.onPointerDown(touch(x + 50, y, { pointerId: 2 }));
    r.onPointerMove(touch(x - 100, y, { pointerId: 1 }));
    r.onPointerMove(touch(x + 100, y, { pointerId: 2 }));
    expect(ui.ppb).toBeCloseTo(160);
    expect(ui.scrollX + (x - 46) / ui.ppb).toBeCloseTo(8); // beat 8 stays between the fingers
    r.onPointerUp(touch(x - 100, y, { pointerId: 1 }));
    r.onPointerUp(touch(x + 100, y, { pointerId: 2 }));
    expect(curTrack().notes).toHaveLength(1); // nothing added or moved
  });

  it('a vertical pinch makes notes taller (up to 3×, never below the normal height); time zoom is untouched', () => {
    const [x, y] = at(8, 60);
    const ppb = ui.ppb;
    const pinch = (d) => { r.onPointerMove(touch(x, y - d, { pointerId: 1 })); r.onPointerMove(touch(x + 10, y + d, { pointerId: 2 })); };
    r.onPointerDown(touch(x, y - 40, { pointerId: 1 }));
    r.onPointerDown(touch(x + 10, y + 40, { pointerId: 2 })); // one above the other: a vertical pinch
    pinch(60);
    expect(ui.row).toBeCloseTo(21); // 80 → 120 px apart: 1.5×
    expect(ui.ppb).toBe(ppb);
    pinch(400);
    expect(ui.row).toBe(42); // at most 3× the normal 14 px
    pinch(5);
    expect(ui.row).toBe(14); // never smaller than normal
    r.onPointerUp(touch(x, y - 5, { pointerId: 1 }));
    r.onPointerUp(touch(x + 10, y + 5, { pointerId: 2 }));
    expect(curTrack().notes).toHaveLength(1); // nothing added or moved
  });

  it('the pitch between the fingers stays put while the rows grow', () => {
    const [x, y] = at(8, 60);
    const pitchAt = (yy) => ui.topPitch - (yy - RULER) / ui.row;
    const p0 = pitchAt(y);
    r.onPointerDown(touch(x, y - 40, { pointerId: 1 }));
    r.onPointerDown(touch(x, y + 40, { pointerId: 2 }));
    r.onPointerMove(touch(x, y - 80, { pointerId: 1 }));
    r.onPointerMove(touch(x, y + 80, { pointerId: 2 }));
    expect(ui.row).toBe(28);
    expect(pitchAt(y)).toBeCloseTo(p0);
    r.onPointerUp(touch(x, y - 80, { pointerId: 1 }));
    r.onPointerUp(touch(x, y + 80, { pointerId: 2 }));
  });

  it('while recording, tapping the screen counts as a tap', () => {
    transport.recording = true;
    rec.t0 = performance.now() - 1000;
    rec.taps = [];
    r.onPointerDown(touch(300, 200, { timeStamp: performance.now() }));
    r.onPointerUp(touch(300, 200, { timeStamp: performance.now() + 120 }));
    transport.recording = false;
    expect(rec.taps).toHaveLength(1);
    expect(rec.taps[0].up - rec.taps[0].down).toBeCloseTo(0.12, 2);
  });

  it('in pick mode, holding a key on the keyboard strip sets the pitch and confirms it', () => {
    curTrack().notes.push({ id: 7002, start: 7, dur: 1, pitch: 50, vel: 90 });
    enterPick([7001, 7002], 60, false);
    r.onPointerDown(touch(20, py(67) + 5));
    expect(curTrack().notes[0].pitch).toBe(67);
    vi.advanceTimersByTime(project.settings.holdMs + 10);
    expect(pick.done.has(7001)).toBe(true);
    expect(pick.i).toBe(1);
    r.onPointerUp(touch(20, py(67) + 5));
    r.onPointerDown(touch(20, py(62) + 5)); // a short press only previews
    r.onPointerUp(touch(20, py(62) + 5));
    vi.advanceTimersByTime(2000);
    expect(pick.done.has(7002)).toBe(false);
    pick.active = false;
  });
});

describe('long-press opens context menus elsewhere', () => {
  it('dispatches contextmenu after holding still, not after moving, and swallows the native one', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const root = document.createElement('div');
    const el = document.createElement('div');
    root.appendChild(el);
    document.body.appendChild(root);
    const off = installLongPress(root);
    const seen = [];
    el.addEventListener('contextmenu', (e) => seen.push(e.isTrusted));
    const pe = (type, x, y) => Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }), { pointerType: 'touch' });
    el.dispatchEvent(pe('pointerdown', 10, 10));
    vi.advanceTimersByTime(600);
    expect(seen).toHaveLength(1);
    el.dispatchEvent(pe('pointerup', 10, 10));
    el.dispatchEvent(pe('pointerdown', 10, 10));
    el.dispatchEvent(pe('pointermove', 40, 10)); // a scroll, not a press
    vi.advanceTimersByTime(600);
    expect(seen).toHaveLength(1);
    off();
    root.remove();
    vi.useRealTimers();
  });
});

describe('phone layout and the Song view by touch', () => {
  let w;
  beforeEach(async () => {
    ui.view = 'song';
    w = mount(App, { attachTo: document.body });
    resetProject();
    device.narrow = true;
    await flushPromises();
  });
  afterEach(() => { w.unmount(); device.narrow = false; device.coarse = false; });

  it('the sidebar is a drawer: ☰ opens it, choosing a pattern closes it', async () => {
    expect(ui.drawer).toBe(false);
    await w.find('button.menu-btn').trigger('click');
    expect(ui.drawer).toBe(true);
    expect(w.find('aside').classes()).toContain('open');
    expect(w.find('.drawer-backdrop').exists()).toBe(true);
    await w.find('.pattern').trigger('click');
    expect(ui.drawer).toBe(false);
    await w.find('button.menu-btn').trigger('click');
    await w.find('.drawer-backdrop').trigger('click');
    expect(ui.drawer).toBe(false);
  });

  it('narrows the track headers; zoom buttons; double-tap a track places the pattern', async () => {
    ui.headW = 230;
    await flushPromises();
    expect(w.find('.song-view').attributes('style')).toContain('--head-w: 132px');
    const px = ui.barPx;
    await w.find('button[aria-label="Zoom in"]').trigger('click');
    expect(ui.barPx).toBeCloseTo(px * 1.25);
    ui.barPx = 72;
    await flushPromises();
    const lane = w.findAll('.lane')[1];
    lane.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2000, height: 56 });
    const n = project.song.clips.length;
    for (let i = 0; i < 2; i++) await lane.trigger('pointerup', { pointerType: 'touch', clientX: 72 * 2, clientY: 10 });
    expect(project.song.clips).toHaveLength(n + 1);
    expect(project.song.clips.at(-1)).toMatchObject({ trackId: project.song.tracks[1].id, start: 8 });
    await lane.trigger('dblclick', { clientX: 72 * 2 }); // the browser's own dblclick right after: ignored
    expect(project.song.clips).toHaveLength(n + 1);
  });

  it('double-tap and drag on a track box-selects clips; a plain press scrolls (no box)', async () => {
    ui.barPx = 72;
    await flushPromises();
    const lane = w.findAll('.lane')[0];
    project.song.clips.splice(0, project.song.clips.length,
      { id: 9101, trackId: project.song.tracks[0].id, patternId: project.curPattern, start: 4 },
      { id: 9102, trackId: project.song.tracks[0].id, patternId: project.curPattern, start: 16 });
    await flushPromises();
    const down = (x, y) => lane.trigger('pointerdown', { pointerType: 'touch', button: 0, clientX: x, clientY: y });
    const ev = (type, x, y) => window.dispatchEvent(Object.assign(new Event(type), { pointerType: 'touch', clientX: x, clientY: y }));
    const head = parseFloat(w.find('.song-view').attributes('style').match(/--head-w: ([\d.]+)px/)[1]);
    const rowY = 60 + 20, x0 = head + 72 * 0.2;
    // a single press: no box, the song scrolls natively
    await down(x0, rowY);
    const ts = new Event('touchstart', { cancelable: true });
    lane.element.dispatchEvent(ts);
    expect(ts.defaultPrevented).toBe(false);
    ev('pointermove', x0 + 200, rowY);
    expect(w.find('.marquee').exists()).toBe(false);
    ev('pointercancel', x0 + 200, rowY);
    // tap, then press and drag
    await lane.trigger('pointerup', { pointerType: 'touch', clientX: x0, clientY: rowY });
    await down(x0, rowY);
    const ts2 = new Event('touchstart', { cancelable: true });
    lane.element.dispatchEvent(ts2);
    expect(ts2.defaultPrevented).toBe(true); // no scrolling during the box
    ev('pointermove', head + 72 * 2, rowY + 10);
    await flushPromises();
    expect(w.find('.marquee').exists()).toBe(true);
    const n = project.song.clips.length;
    await lane.trigger('pointerup', { pointerType: 'touch', clientX: head + 72 * 2, clientY: rowY + 10 });
    ev('pointerup', head + 72 * 2, rowY + 10);
    await flushPromises();
    expect([...ui.songSel]).toEqual([9101]);
    expect(project.song.clips).toHaveLength(n); // nothing placed
    expect(w.find('.marquee').exists()).toBe(false);
  });

  it('two fingers pinch the song timeline to zoom it, keeping the bar between them in place', async () => {
    ui.barPx = 72;
    await flushPromises();
    const sc = w.find('.scroller');
    sc.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600 });
    const head = parseFloat(w.find('.song-view').attributes('style').match(/--head-w: ([\d.]+)px/)[1]);
    const t = (x) => ({ clientX: x, clientY: 200 });
    const fire = (type, pts) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      e.touches = pts.map(t);
      sc.element.dispatchEvent(e);
      return e;
    };
    // fingers 100 px apart around x = head + 2 bars (beat 8)
    const mid = head + 72 * 2;
    fire('touchstart', [mid - 50, mid + 50]);
    const mv = fire('touchmove', [mid - 100, mid + 100]); // twice as far apart
    expect(mv.defaultPrevented).toBe(true); // no native scroll / page zoom
    expect(ui.barPx).toBeCloseTo(144);
    await flushPromises();
    expect(sc.element.scrollLeft).toBeCloseTo(head + 144 * 2 - mid, 0); // beat 8 stays between the fingers
    fire('touchend', [mid - 100]);
    const one = fire('touchmove', [mid]);
    expect(one.defaultPrevented).toBe(false); // one finger: the browser scrolls
    expect(ui.barPx).toBeCloseTo(144);
    ui.barPx = 72;
  });

  it('soloing a track fades the others, like muting them', async () => {
    const lanes = () => w.findAll('.lane').slice(0, 2).map((l) => l.classes().includes('muted'));
    expect(lanes()).toEqual([false, false]);
    project.song.tracks[0].solo = true;
    await flushPromises();
    expect(lanes()).toEqual([false, true]);
    project.song.tracks[0].solo = false;
    project.song.tracks[1].mute = true;
    await flushPromises();
    expect(lanes()).toEqual([false, true]);
  });

  it('on a phone, each track row has a ⋯ menu: mute, solo, colour, move, delete (and on/off for automation)', async () => {
    const { addAutomation } = await import('../src/engine/automation.js');
    addAutomation();
    await flushPromises();
    const menuItems = () => w.findAll('.ctx button[role=menuitem]');
    const item = (label) => menuItems().find((b) => b.text().replace('✓ ', '').startsWith(label));
    const head = () => w.findAll('.lane-row')[0].find('.head');
    expect(head().find('button.actions').exists()).toBe(true);

    await head().find('button.actions').trigger('click');
    expect(ui.ctxMenu).toMatchObject({ open: true, kind: 'custom' });
    expect(w.find('.ctx').text()).toContain('Track 1');
    await item('Mute').trigger('click');
    expect(project.song.tracks[0].mute).toBe(true);
    expect(ui.ctxMenu.open).toBe(false);
    expect(head().find('.badge').text()).toBe('M');
    await head().find('button.actions').trigger('click');
    expect(item('Mute').text()).toBe('✓ Mute');
    await item('Move down').trigger('click');
    expect(w.findAll('.lane-row')[1].find('input.name').element.value).toBe('Track 1');

    const color = w.findAll('.lane-row')[1].find('input[type=color]');
    const opened = vi.fn();
    color.element.showPicker = opened;
    await w.findAll('.lane-row')[1].find('button.actions').trigger('click');
    await item('Change colour').trigger('click');
    expect(opened).toHaveBeenCalled();

    const auto = w.findAll('.lane-row').at(-1);
    await auto.find('button.actions').trigger('click');
    await item('Switch off').trigger('click');
    expect(project.song.automation[0].enabled).toBe(false);
    expect(w.findAll('.lane-row').at(-1).find('.badge').text()).toBe('Off');
    await w.findAll('.lane-row').at(-1).find('button.actions').trigger('click');
    await item('Delete automation').trigger('click');
    expect(project.song.automation).toHaveLength(0);
  });

  it('song sections by touch: double-tap the strip adds one, long-press menus add / rename / delete, a swipe adds nothing', async () => {
    await new Promise((res) => setTimeout(res, 750)); // clear of earlier double-taps
    const strip = w.find('.sections');
    strip.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 4000, height: 22 });
    const t = { pointerType: 'touch', button: 0 };
    await strip.trigger('pointerdown', { ...t, clientX: 72 * 2.5 });
    expect(project.song.sections).toHaveLength(0); // no drag-to-create with a finger (that scrolls)
    await strip.trigger('pointerup', { ...t, clientX: 72 * 2.5 });
    await strip.trigger('pointerup', { ...t, clientX: 72 * 2.5 });
    expect(project.song.sections.map((x) => [x.name, x.start, x.end])).toEqual([['Intro', 8, 24]]); // bar 3, 4 bars
    await flushPromises();
    await w.find('input.sec-name').trigger('blur');
    await strip.trigger('dblclick', { clientX: 72 * 2.5 }); // the browser's own dblclick that follows: ignored
    expect(project.song.sections).toHaveLength(1);

    await strip.trigger('contextmenu', { clientX: 72 * 10.2, clientY: 5 }); // long-press (dispatched by the long-press helper)
    const item = (label) => w.findAll('.ctx button[role=menuitem]').find((b) => b.text().startsWith(label));
    expect(w.find('.ctx').text()).toContain('Bar 11');
    await item('Add section here (8 bars)').trigger('click');
    expect(project.song.sections.at(-1)).toMatchObject({ name: 'Verse', start: 40, end: 72 });
    await flushPromises();
    await w.find('input.sec-name').trigger('blur');

    const sec = () => w.findAll('.section')[0];
    await sec().trigger('contextmenu', { clientX: 200, clientY: 5 });
    expect(w.find('.ctx').text()).toContain('Intro');
    await item('Rename').trigger('click');
    await flushPromises();
    expect(sec().find('input.sec-name').exists()).toBe(true);
    await sec().find('input.sec-name').setValue('Opening');
    await sec().find('input.sec-name').trigger('blur');
    expect(project.song.sections[0].name).toBe('Opening');

    await new Promise((res) => setTimeout(res, 400));
    for (let i = 0; i < 2; i++) { // double-tap a section: rename
      await sec().find('.sec-label').trigger('pointerdown', { ...t, clientX: 200 });
      await sec().find('.sec-label').trigger('pointerup', { ...t, clientX: 200 }); // bubbles to the window, where the drag listens
    }
    await flushPromises();
    expect(sec().find('input.sec-name').exists()).toBe(true);
    await sec().find('input.sec-name').trigger('blur');

    await sec().trigger('contextmenu', { clientX: 200, clientY: 5 });
    await item('Delete section').trigger('click');
    expect(project.song.sections.map((x) => x.name)).toEqual(['Verse']);
  });

  it('the Sections strip is taller on a touch screen, and the rows below line up with it', async () => {
    expect(w.find('.sections-row').attributes('style')).toContain('height: 22px');
    device.coarse = true;
    await flushPromises();
    expect(w.find('.sections-row').attributes('style')).toContain('height: 36px');
    // dragging a row's grip: the drop line is measured from below the (taller) header rows
    const grip = w.findAll('.lane-row')[2].find('.grip');
    await grip.trigger('pointerdown', { button: 0, clientY: 2 * 56 + 28, pointerId: 1 });
    await grip.trigger('pointermove', { clientY: 70, pointerId: 1 });
    expect(w.find('.drop-line').attributes('style')).toContain(`top: ${24 + 36 + 56}px`);
    await grip.trigger('pointerup', { pointerId: 1 });
  });

  it('a sound picked in the list (no drag and drop on a phone) is what double-tap places', async () => {
    const { cacheSound } = await import('../src/audio/soundBank.js');
    project.sounds.push({ id: 7301, key: 'k7301', name: 'Clap', duration: 1, vol: 0.8, mime: '', size: 1 });
    cacheSound(7301, { length: 10, duration: 1, sampleRate: 10, numberOfChannels: 1, getChannelData: () => new Float32Array(10) });
    await flushPromises();
    await w.find('.sound').trigger('click');
    expect(ui.placeSound).toBe(7301);
    expect(w.find('.sound').classes()).toContain('current');
    expect(w.find('.pattern').classes()).not.toContain('current');
    const lane = w.findAll('.lane')[2];
    lane.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2000, height: 56 });
    await new Promise((res) => setTimeout(res, 750)); // well after the previous test's double-tap
    await lane.trigger('dblclick', { clientX: ui.barPx });
    expect(project.song.clips.at(-1)).toMatchObject({ soundId: 7301, trackId: project.song.tracks[2].id });
    await w.find('.pattern').trigger('click'); // picking a pattern again switches back
    expect(ui.placeSound).toBe(null);
    await lane.trigger('dblclick', { clientX: ui.barPx * 3 });
    expect(project.song.clips.at(-1).patternId).toBe(project.patterns[0].id);
  });
});
