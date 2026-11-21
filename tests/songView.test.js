// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.confirm = () => true;
});

const App = (await import('../src/App.vue')).default;
const { project, curPattern, resetProject } = await import('../src/stores/project.js');
const { ui } = await import('../src/stores/ui.js');
const { PATTERN_MIME } = await import('../src/engine/song.js');

const button = (w, text) => w.findAll('button').find((b) => b.text().trim().startsWith(text));
const lanes = (w) => w.findAll('.lane');
const clipsIn = (w, i) => lanes(w)[i].findAll('.clip');
const key = (k, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...opts }));

describe('Song view', () => {
  let w;
  beforeAll(async () => {
    resetProject();
    ui.view = 'pattern';
    w = mount(App, { attachTo: document.body });
    curPattern().layers[0].notes = [{ id: 501, start: 0, dur: 1, pitch: 60, vel: 90 }, { id: 502, start: 4, dur: 2, pitch: 67, vel: 90 }];
    await flushPromises();
  });

  it('opens from the header and shows patterns, named tracks and the first clip', async () => {
    await button(w, '🎼 Song').trigger('click');
    expect(ui.view).toBe('song');
    expect(w.text()).toContain('Patterns');
    expect(w.findAll('.pattern')).toHaveLength(1);
    expect(w.find('.pattern').text()).toContain('2 bars');
    expect(w.findAll('.head input.name').map((i) => i.element.value)).toEqual(['Track 1', 'Track 2', 'Track 3', 'Track 4']);
    expect(clipsIn(w, 0)).toHaveLength(1);
    expect(clipsIn(w, 0)[0].text()).toContain('Pattern 1');
    expect(clipsIn(w, 0)[0].findAll('svg.preview rect')).toHaveLength(2); // note preview
    expect(clipsIn(w, 0)[0].attributes('style')).toContain(`width: ${2 * ui.barPx - 2}px`); // 2 bars long
    expect(button(w, '● Rec').attributes('disabled')).toBeDefined();
  });

  it('tracks can be renamed and recoloured on the left', async () => {
    const head = w.findAll('.head')[1];
    await head.find('input.name').setValue('Bass line');
    await head.find('input[type=color]').setValue('#ff00aa');
    expect(project.song.tracks[1]).toMatchObject({ name: 'Bass line', color: '#ff00aa' });
    expect(clipsIn(w, 1)).toHaveLength(0);
  });

  it('dropping a pattern onto a track places a clip on the ¼-bar grid', async () => {
    const lane = lanes(w)[1];
    lane.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2000, height: 56 });
    const dataTransfer = { types: [PATTERN_MIME], getData: (t) => (t === PATTERN_MIME ? String(project.patterns[0].id) : ''), dropEffect: '' };
    await lane.trigger('dragover', { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('copy');
    await lane.trigger('drop', { dataTransfer, clientX: ui.barPx * 2.6 });
    expect(clipsIn(w, 1)).toHaveLength(1);
    expect(project.song.clips.at(-1)).toMatchObject({ trackId: project.song.tracks[1].id, start: 10 }); // 2.6 bars → bar 3, beat 3
  });

  it('clips drag across bars and tracks (one undo step)', async () => {
    const clip = clipsIn(w, 1)[0];
    await clip.trigger('pointerdown', { button: 0, clientX: 300, clientY: 100, pointerId: 1 });
    await clip.trigger('pointermove', { clientX: 300 + ui.barPx * 2, clientY: 100 + 56, pointerId: 1 });
    await clip.trigger('pointerup', { pointerId: 1 });
    const moved = project.song.clips.at(-1);
    expect(moved).toMatchObject({ trackId: project.song.tracks[2].id, start: 18 });
    expect(clipsIn(w, 2)).toHaveLength(1);
    await button(w, '↶').trigger('click');
    expect(project.song.clips.at(-1)).toMatchObject({ trackId: project.song.tracks[1].id, start: 10 });
  });

  it('a click without moving just selects; Delete removes selected clips (not notes)', async () => {
    const clip = clipsIn(w, 1)[0];
    await clip.trigger('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 2 });
    await clip.trigger('pointerup', { pointerId: 2 });
    expect(ui.songSel.size).toBe(1);
    expect(clip.classes()).toContain('sel');
    key('Delete');
    await flushPromises();
    expect(clipsIn(w, 1)).toHaveLength(0);
    expect(curPattern().layers[0].notes).toHaveLength(2);
  });

  it('right-click a clip → Make unique creates a variation pattern', async () => {
    const clip = clipsIn(w, 0)[0];
    await clip.trigger('contextmenu', { clientX: 50, clientY: 50 });
    expect(ui.ctxMenu).toMatchObject({ open: true, kind: 'clip' });
    await flushPromises();
    await w.findAll('.ctx button').find((b) => b.text().startsWith('Make unique')).trigger('click');
    expect(project.patterns.map((p) => p.name)).toEqual(['Pattern 1', 'Pattern 1 (variation)']);
    expect(w.findAll('.pattern')).toHaveLength(2);
    expect(clipsIn(w, 0)[0].text()).toContain('Pattern 1 (variation)');
  });

  it('Edit (or double-clicking a clip) opens the pattern editor on that pattern', async () => {
    const variation = project.patterns[1];
    await w.findAll('.pattern')[1].findAll('button').find((b) => b.text() === 'Edit').trigger('click');
    expect(ui.view).toBe('pattern');
    expect(curPattern().id).toBe(variation.id);
    expect(w.find('canvas').exists()).toBe(true);
    expect(w.find('select[aria-label="Pattern being edited"]').element.value).toBe(String(variation.id));
    expect(button(w, '🎹').text()).toContain('Pattern 1 (variation)');

    await button(w, '🎼 Song').trigger('click');
    await clipsIn(w, 0)[0].trigger('dblclick');
    expect(ui.view).toBe('pattern');
  });

  it('the pattern bar switches, renames and creates patterns', async () => {
    const select = w.find('select[aria-label="Pattern being edited"]');
    await select.setValue(String(project.patterns[0].id));
    expect(curPattern().id).toBe(project.patterns[0].id);
    await w.find('input[aria-label="Pattern name"]').setValue('Verse');
    expect(project.patterns[0].name).toBe('Verse');
    await w.findAll('button').find((b) => b.text() === '+ New').trigger('click');
    expect(project.patterns).toHaveLength(3);
    expect(curPattern().name).toBe('Pattern 3');
    expect(curPattern().layers[0].notes).toHaveLength(0);
  });

  it('File tab exports say what they cover', async () => {
    ui.tab = 'file';
    await flushPromises();
    expect(w.find('[role=tabpanel]').text()).toContain('Export pattern');
    await button(w, '🎼 Song').trigger('click');
    expect(w.find('[role=tabpanel]').text()).toContain('Export song');
  });
});

describe('Song view snap', () => {
  it('the corner snap selector changes where drops land', async () => {
    resetProject();
    ui.view = 'song';
    const w = mount(App, { attachTo: document.body });
    await flushPromises();
    const snap = w.find('select[aria-label="Song snap"]');
    expect(ui.songSnap).toBe(1);
    expect(snap.findAll('option').map((o) => o.text())).toEqual(['1 bar', '1 beat', '½ beat', '¼ beat', 'off']);
    const lane = w.findAll('.lane')[1];
    lane.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2000, height: 56 });
    const dataTransfer = { types: [PATTERN_MIME], getData: () => String(project.patterns[0].id), dropEffect: '' };
    await lane.trigger('drop', { dataTransfer, clientX: ui.barPx * 1.8 });
    expect(project.song.clips.at(-1).start).toBe(7); // 1.8 bars → bar 2, beat 4
    snap.element.selectedIndex = 0; // '1 bar'
    await snap.trigger('change');
    expect(ui.songSnap).toBe('bar');
    await lane.trigger('drop', { dataTransfer, clientX: ui.barPx * 1.8 });
    expect(project.song.clips.at(-1).start).toBe(4); // whole bars
    w.unmount();
  });
});

describe('new patterns accept instruments', () => {
  it('a pattern made with “+ New” (pattern box) or “+ New pattern” (song list) can get new layers and drums', async () => {
    resetProject();
    ui.view = 'pattern';
    const w = mount(App, { attachTo: document.body });
    await flushPromises();
    const add = (label) => w.findAll('button').find((b) => b.text().trim().startsWith(label)).trigger('click');

    await w.findAll('button').find((b) => b.text() === '+ New').trigger('click');
    expect(curPattern().name).toBe('Pattern 2');
    await add('+ Add layer');
    await add('+ Add drums');
    expect(curPattern().layers.map((l) => l.inst)).toEqual(['flute', 'bass', 'drums']);
    expect(w.findAll('.track')).toHaveLength(3);
    expect(project.patterns[0].layers).toHaveLength(1); // the original pattern is untouched

    await add('🎼 Song');
    await add('+ New pattern');
    await w.findAll('.pattern').at(-1).findAll('button').find((b) => b.text() === 'Edit').trigger('click');
    expect(curPattern().name).toBe('Pattern 3');
    const before = curPattern().layers.length;
    await add('+ Add layer');
    expect(curPattern().layers).toHaveLength(before + 1);
    expect(w.findAll('.track')).toHaveLength(before + 1);
    w.unmount();
  });
});

describe('automation rows', () => {
  it('add, target, draw points, drag a point and its horizontal handle, delete, undo', async () => {
    resetProject();
    ui.view = 'song';
    ui.songSnap = 1;
    const w = mount(App, { attachTo: document.body });
    await flushPromises();
    await w.findAll('button').find((b) => b.text() === '+ Add automation').trigger('click');
    const row = () => w.find('.auto-row');
    expect(row().exists()).toBe(true);
    expect(row().find('input.name').element.value).toBe('Volume 1');
    expect(row().find('summary').text()).toBe('→ Track 1');
    expect(row().text()).toContain('Double-click to add points');

    // effect + targets
    await row().find('select').setValue('pan');
    expect(project.song.automation[0].effect).toBe('pan');
    const boxes = row().findAll('.target-list input[type=checkbox]');
    expect(boxes).toHaveLength(4);
    await boxes[2].setValue(true);
    expect(project.song.automation[0].targets).toEqual([project.song.tracks[0].id, project.song.tracks[2].id]);
    expect(row().find('summary').text()).toBe('→ Track 1, Track 3');

    // double-click adds points (x → beat on the song grid, y → value)
    const svg = row().find('svg.auto-lane');
    svg.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 4000, height: 72 });
    const beatPx = ui.barPx / 4;
    await svg.trigger('dblclick', { clientX: beatPx * 2.1, clientY: 7 }); // top = 1
    await svg.trigger('dblclick', { clientX: beatPx * 8, clientY: 65 }); // bottom = 0
    const pts = () => project.song.automation[0].points;
    expect(pts().map((p) => [p.beat, +p.value.toFixed(2)])).toEqual([[2, 1], [8, 0]]);
    expect(row().find('path.curve').attributes('d')).toContain(' C');

    // drag the first point down and right (one undo step)
    const circle = () => row().findAll('circle.pt')[0];
    await circle().trigger('pointerdown', { clientX: beatPx * 2, clientY: 7, pointerId: 1 });
    await svg.trigger('pointermove', { clientX: beatPx * 3, clientY: 36, pointerId: 1 });
    expect(row().find('text.tip').text()).toMatch(/^L \d+%|^R \d+%|Centre/);
    await svg.trigger('pointerup', { pointerId: 1 });
    expect(pts()[0].beat).toBe(3);
    expect(pts()[0].value).toBeCloseTo(0.5, 1);

    // its right handle appears; dragging it in sharpens the curve
    expect(ui.autoSel).toEqual({ id: project.song.automation[0].id, index: 0 });
    const handle = row().find('rect.handle');
    expect(handle.exists()).toBe(true);
    await handle.trigger('pointerdown', { clientX: 0, clientY: 0, pointerId: 2 });
    await svg.trigger('pointermove', { clientX: beatPx * 3.5, clientY: 36, pointerId: 2 });
    await svg.trigger('pointerup', { pointerId: 2 });
    expect(pts()[0].ease).toBeCloseTo(0.2, 2); // 0.5 beat of a 2.5-beat half-gap

    // Delete removes the selected point, not clips
    const clips = project.song.clips.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    await flushPromises();
    expect(pts()).toHaveLength(1);
    expect(project.song.clips).toHaveLength(clips);
    // right-click deletes too
    await row().findAll('circle.pt')[0].trigger('contextmenu');
    expect(pts()).toHaveLength(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    await flushPromises();
    expect(pts()).toHaveLength(2);
    expect(pts()[0].ease).toBeCloseTo(0.2, 2);
    w.unmount();
  });
});

describe('Reverb automation row', () => {
  it('choosing Reverb shows room settings; each slider adjustment is one undo step', async () => {
    resetProject();
    ui.view = 'song';
    const w = mount(App, { attachTo: document.body });
    await flushPromises();
    await w.findAll('button').find((b) => b.text() === '+ Add automation').trigger('click');
    const row = () => w.find('.auto-row');
    expect(row().find('.fx-opts').exists()).toBe(false); // volume has no settings
    await row().find('select').setValue('reverb');
    expect(row().find('input.name').element.value).toBe('Volume 1'); // the name is yours to change
    expect(row().find('.fx-opts summary').text()).toBe('⚙');
    const decay = row().findAll('.fx-opts input[type=range]')[0];
    await decay.trigger('pointerdown');
    await decay.setValue('6');
    await decay.trigger('change');
    expect(project.song.automation[0].options.decay).toBe(6);
    expect(row().find('.fx-opts').text()).toContain('6.0 s');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    await flushPromises();
    expect(project.song.automation[0].options.decay).toBe(2.2);
    expect(project.song.automation[0].effect).toBe('reverb');
    w.unmount();
  });
});

describe('insert effects as automation', () => {
  it('Wah-wah automation offers its other controls in ⚙, with Rate off so the curve is the pedal', async () => {
    resetProject();
    ui.view = 'song';
    const w = mount(App, { attachTo: document.body });
    await flushPromises();
    await w.findAll('button').find((b) => b.text() === '+ Add automation').trigger('click');
    const row = () => w.find('.auto-row');
    const effects = row().find('select').findAll('option').map((o) => o.text());
    expect(effects).toEqual(expect.arrayContaining(['Echo — mix', 'Distortion — drive', 'Bitcrusher — mix', 'Wah-wah — position', 'Chorus — mix', 'Phaser — mix', 'Tremolo — depth']));
    await row().find('select').setValue('wah');
    const labels = row().findAll('.fx-opts label').map((l) => l.text());
    expect(labels.map((t) => t.split(' ')[0])).toEqual(['Rate', 'Depth', 'Resonance', 'Mix']);
    expect(labels[0]).toContain('off');
    expect(row().find('.opt-help').text()).toContain('position');
    w.unmount();
  });
});

describe('Song view grid follows the time signature', () => {
  const beatLines = (style) => {
    const sizes = (style.match(/background-size: ([^;]+)/) || [])[1]?.split(',').map((x) => parseFloat(x)) ?? [];
    return sizes;
  };
  it('draws one line per counted beat: 4 per bar in 4/4, 3 in 3/4, 6 in 6/8 (lanes and ruler)', async () => {
    resetProject();
    ui.view = 'song';
    ui.songSnap = 1;
    ui.barPx = 96;
    const { setTimeSig } = await import('../src/engine/editing.js');
    const w = mount(App, { attachTo: document.body });
    await flushPromises();
    const lane = () => w.findAll('.lane')[0].attributes('style');
    const ruler = () => w.find('.ruler').attributes('style');
    expect(beatLines(lane())).toEqual([96, 24]); // bar, beat (96 / 4)
    setTimeSig({ num: 3, den: 4 });
    await flushPromises();
    expect(beatLines(lane())).toEqual([96, 32]); // 96 / 3
    expect(ruler()).toContain('background-size: 32px 6px');
    setTimeSig({ num: 6, den: 8 });
    await flushPromises();
    expect(beatLines(lane())).toEqual([96, 16]); // 96 / 6
    ui.songSnap = 0.5; // half-beat snap adds fainter sub-lines
    await flushPromises();
    expect(beatLines(lane())).toEqual([96, 16, 8]);
    w.unmount();
  });

  it('the add buttons live in the left header column', async () => {
    resetProject();
    ui.view = 'song';
    const w = mount(App, { attachTo: document.body });
    await flushPromises();
    const head = w.find('.add-row .add-head');
    expect(head.findAll('button').map((b) => b.text())).toEqual(['+ Add track', '+ Add automation']);
    expect(w.find('.add-row > .help').exists()).toBe(true);
    w.unmount();
  });
});

describe('rearranging rows and switching automation off', () => {
  const setup = async () => {
    resetProject();
    ui.view = 'song';
    const w = mount(App, { attachTo: document.body });
    await flushPromises();
    await w.findAll('button').find((b) => b.text() === '+ Add automation').trigger('click');
    return w;
  };
  const names = (w) => w.findAll('.lane-row').map((r) => r.find('input.name').element.value);

  it('drag a row by its grip (with a drop line), or press ↑/↓ on it', async () => {
    const w = await setup();
    expect(names(w)).toEqual(['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Volume 1']);
    const grip = w.findAll('.lane-row')[4].find('.grip'); // centre at 4×56 + 36 = 260
    await grip.trigger('pointerdown', { button: 0, clientY: 260, pointerId: 1 });
    await grip.trigger('pointermove', { clientY: 70, pointerId: 1 }); // between Track 1 and Track 2
    expect(w.find('.drop-line').attributes('style')).toContain(`top: ${24 + 22 + 56}px`);
    expect(w.findAll('.lane-row')[4].classes()).toContain('dragging');
    await grip.trigger('pointerup', { pointerId: 1 });
    expect(names(w)).toEqual(['Track 1', 'Volume 1', 'Track 2', 'Track 3', 'Track 4']);
    expect(w.find('.drop-line').exists()).toBe(false);

    await w.findAll('.lane-row')[3].find('.grip').trigger('keydown', { key: 'ArrowUp' });
    expect(names(w)).toEqual(['Track 1', 'Volume 1', 'Track 3', 'Track 2', 'Track 4']);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    await flushPromises();
    expect(names(w)).toEqual(['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Volume 1']);
    w.unmount();
  });

  it('dragging a clip down skips over an automation row in between', async () => {
    const w = await setup();
    const { moveRow } = await import('../src/engine/song.js');
    moveRow(`a:${project.song.automation[0].id}`, 1); // Track 1, automation, Track 2, …
    await flushPromises();
    const clip = w.findAll('.lane-row')[0].find('.clip');
    await clip.trigger('pointerdown', { button: 0, clientX: 10, clientY: 28, pointerId: 3 });
    await clip.trigger('pointermove', { clientX: 10, clientY: 28 + 56, pointerId: 3 }); // over the automation row
    expect(project.song.clips[0].trackId).toBe(project.song.tracks[0].id); // stays put
    await clip.trigger('pointermove', { clientX: 10, clientY: 28 + 120, pointerId: 3 }); // over Track 2
    await clip.trigger('pointerup', { pointerId: 3 });
    expect(project.song.clips[0].trackId).toBe(project.song.tracks[1].id);
    w.unmount();
  });

  it('the On/Off toggle switches an automation track off (dimmed, curve kept) and back on', async () => {
    const w = await setup();
    const row = () => w.find('.auto-row');
    const toggle = () => row().find('button.onoff');
    expect(toggle().text()).toBe('On');
    expect(toggle().attributes('aria-pressed')).toBe('true');
    await toggle().trigger('click');
    expect(project.song.automation[0].enabled).toBe(false);
    expect(toggle().text()).toBe('Off');
    expect(row().classes()).toContain('disabled');
    await toggle().trigger('click');
    expect(project.song.automation[0].enabled).toBe(true);
    expect(row().classes()).not.toContain('disabled');
    w.unmount();
  });
});

describe('track header column', () => {
  it('can be resized by dragging (or ←/→), is clamped, remembered, and double-click resets it', async () => {
    const { HEAD_W } = await import('../src/stores/ui.js');
    resetProject();
    ui.view = 'song';
    ui.headW = HEAD_W.def;
    const w = mount(App, { attachTo: document.body });
    await flushPromises();
    const view = () => w.find('.song-view').attributes('style');
    expect(view()).toContain(`--head-w: ${HEAD_W.def}px`);
    const grid = () => w.find('.grid').attributes('style');
    const r = w.find('.resizer');
    await r.trigger('pointerdown', { button: 0, clientX: 230, pointerId: 1 });
    await r.trigger('pointermove', { clientX: 330, pointerId: 1 });
    await r.trigger('pointerup', { pointerId: 1 });
    expect(ui.headW).toBe(HEAD_W.def + 100);
    expect(view()).toContain(`--head-w: ${HEAD_W.def + 100}px`);
    expect(grid()).toContain(`width: ${HEAD_W.def + 100 + 32 * ui.barPx}px`); // the timeline shifts with it
    expect(localStorage.getItem('whistle-midi-head-w')).toBe(String(HEAD_W.def + 100));
    await r.trigger('pointerdown', { button: 0, clientX: 0, pointerId: 2 });
    await r.trigger('pointermove', { clientX: 5000, pointerId: 2 });
    await r.trigger('pointerup', { pointerId: 2 });
    expect(ui.headW).toBe(HEAD_W.max);
    await r.trigger('keydown', { key: 'ArrowLeft' });
    expect(ui.headW).toBe(HEAD_W.max - 10);
    await r.trigger('dblclick');
    expect(ui.headW).toBe(HEAD_W.def);
    expect(w.findAll('.head input.name')[0].attributes('title')).toBe('Track 1'); // full name on hover
    expect(w.findAll('.head button.del').length).toBeGreaterThan(0);
    w.unmount();
  });
});

describe('pattern sidebar selection and clip copy/paste', () => {
  it('clicking a pattern selects it without leaving the Song view; double-click places it', async () => {
    resetProject();
    ui.view = 'song';
    const { newPattern } = await import('../src/engine/song.js');
    const w = mount(App, { attachTo: document.body }); // mounting restores the autosave…
    resetProject(); // …so set the scene afterwards
    newPattern();
    await flushPromises();
    const cards = () => w.findAll('.pattern');
    expect(curPattern().name).toBe('Pattern 1');
    await cards()[1].trigger('click');
    expect(curPattern().name).toBe('Pattern 2');
    expect(ui.view).toBe('song');
    expect(cards()[1].classes()).toContain('current');
    expect(cards()[1].attributes('aria-pressed')).toBe('true');
    await cards()[0].find('input.name').trigger('click'); // editing the name doesn't select
    expect(curPattern().name).toBe('Pattern 2');
    await cards()[0].trigger('keydown', { key: 'Enter' });
    expect(curPattern().name).toBe('Pattern 1');
    await cards()[1].trigger('click');
    const lane = w.findAll('.lane')[2];
    lane.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2000, height: 56 });
    await lane.trigger('dblclick', { clientX: ui.barPx * 2 });
    expect(project.song.clips.at(-1)).toMatchObject({ patternId: project.patterns[1].id, trackId: project.song.tracks[2].id, start: 8 });
    w.unmount();
  });

  it('Ctrl+C / Ctrl+V copy clips to the playhead; right-click a track → Paste here', async () => {
    resetProject();
    ui.view = 'song';
    const w = mount(App, { attachTo: document.body });
    await flushPromises();
    const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true }));
    const clip = w.findAll('.lane')[0].find('.clip');
    await clip.trigger('pointerdown', { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
    await clip.trigger('pointerup', { pointerId: 1 });
    key('c');
    ui.songPlayhead = 8;
    key('v');
    key('v');
    await flushPromises();
    expect(project.song.clips.map((c) => c.start)).toEqual([0, 8, 12]);
    expect(w.findAll('.lane')[0].findAll('.clip')).toHaveLength(3);

    const lane = w.findAll('.lane')[3]; // Track 4
    lane.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2000, height: 56 });
    await lane.trigger('contextmenu', { clientX: ui.barPx * 5.3, clientY: 10 });
    expect(ui.ctxMenu).toMatchObject({ open: true, kind: 'clip', trackId: project.song.tracks[3].id, beat: 21 });
    await flushPromises();
    expect(w.find('.ctx').text()).toContain('No clips selected');
    expect(w.findAll('.ctx button').find((b) => b.text().startsWith('Copy')).attributes('disabled')).toBeDefined();
    await w.findAll('.ctx button').find((b) => b.text().startsWith('Paste here')).trigger('click');
    expect(project.song.clips.at(-1)).toMatchObject({ trackId: project.song.tracks[3].id, start: 21 });
    key('x'); // cut the pasted (selected) clip
    await flushPromises();
    expect(project.song.clips).toHaveLength(3);
    w.unmount();
  });

  it('lists imported sounds; dropping one on a track places a waveform clip that only plays (no pattern menu)', async () => {
    const { cacheSound } = await import('../src/audio/soundBank.js');
    const { SOUND_MIME } = await import('../src/engine/song.js');
    ui.view = 'song';
    const w = mount(App, { attachTo: document.body });
    resetProject();
    project.song.clips = [];
    project.bpm = 120;
    project.sounds.push({ id: 7001, key: 'k7001', name: 'Thunder', duration: 2, vol: 0.8, mime: 'audio/wav', size: 10 });
    const data = new Float32Array(2000).map((_, i) => Math.sin(i / 10) * (i / 2000));
    cacheSound(7001, { length: 2000, duration: 2, sampleRate: 1000, numberOfChannels: 1, getChannelData: () => data });
    await flushPromises();
    expect(w.text()).toContain('Sounds');
    const card = w.find('.sound');
    expect(card.find('input.name').element.value).toBe('Thunder');
    expect(card.text()).toContain('2.0 s');
    expect(button(w, '+ Import sound')).toBeTruthy();

    const lane = lanes(w)[1];
    lane.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2000, height: 56 });
    const dataTransfer = { types: [SOUND_MIME], getData: (t) => (t === SOUND_MIME ? '7001' : ''), dropEffect: '' };
    await lane.trigger('dragover', { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('copy');
    await lane.trigger('drop', { dataTransfer, clientX: ui.barPx * 2 + 3 });
    await flushPromises();
    expect(project.song.clips).toEqual([expect.objectContaining({ soundId: 7001, trackId: project.song.tracks[1].id, start: 8 })]);
    const clip = clipsIn(w, 1)[0];
    expect(clip.classes()).toContain('sound');
    expect(clip.text()).toContain('Thunder');
    expect(clip.find('svg.wave path').attributes('d')).toMatch(/^M0,/);
    expect(clip.attributes('style')).toContain(`width: ${ui.barPx - 2}px`); // 2 s at 120 bpm = 4 beats = 1 bar
    expect(card.text()).toContain('used 1×');

    await clip.trigger('contextmenu', { clientX: 10, clientY: 10 });
    await flushPromises();
    const item = (t) => w.findAll('.ctx button').find((b) => b.text().startsWith(t));
    expect(item('Edit pattern').attributes('disabled')).toBeDefined();
    expect(item('Make unique').attributes('disabled')).toBeDefined();
    expect(item('Copy').attributes('disabled')).toBeUndefined();
    ui.ctxMenu.open = false;
    w.unmount();
  });
});

describe('fine adjustment with Ctrl', () => {
  it('Ctrl ignores the song snap for dragging, dropping, placing, the ruler and automation points; ←/→ nudge', async () => {
    resetProject();
    ui.view = 'song';
    const w = mount(App, { attachTo: document.body });
    resetProject();
    ui.songSnap = 1;
    project.song.clips = [];
    await flushPromises();
    const beatPx = ui.barPx / 4;
    const lane = w.findAll('.lane')[0];
    lane.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 4000, height: 56 });
    const pid = String(project.patterns[0].id);
    const dataTransfer = { types: [PATTERN_MIME], getData: (t) => (t === PATTERN_MIME ? pid : ''), dropEffect: '' };

    // drop: snapped without Ctrl, exact (to 1/64 beat) with it
    await lane.trigger('drop', { dataTransfer, clientX: beatPx * 2.3 });
    expect(project.song.clips.at(-1).start).toBe(2);
    await lane.trigger('drop', { dataTransfer, clientX: beatPx * 20.3, ctrlKey: true });
    expect(project.song.clips.at(-1).start).toBeCloseTo(20.296875); // floor to 1/64
    // double-click placement
    await lane.trigger('dblclick', { clientX: beatPx * 40.5, ctrlKey: true });
    expect(project.song.clips.at(-1).start).toBe(40.5);
    await lane.trigger('dblclick', { clientX: beatPx * 50.5 });
    expect(project.song.clips.at(-1).start).toBe(50);

    // dragging the first clip: a 1/3-beat move snaps away without Ctrl, sticks with it
    project.song.clips = [project.song.clips[0]];
    await flushPromises();
    const clip = () => w.findAll('.lane')[0].find('.clip');
    const drag = async (dx, opts = {}) => {
      await clip().trigger('pointerdown', { button: 0, clientX: 100, clientY: 10, pointerId: 1 });
      await clip().trigger('pointermove', { clientX: 100 + dx, clientY: 10, pointerId: 1, ...opts });
      await clip().trigger('pointerup', { pointerId: 1 });
    };
    await drag(beatPx / 3);
    expect(project.song.clips[0].start).toBe(2);
    await drag(beatPx / 2 + 5, { ctrlKey: true });
    const fine = project.song.clips[0].start;
    expect(fine).toBeGreaterThan(2.5);
    expect(fine).toBeLessThan(2.75);
    expect((fine * 64) % 1).toBeCloseTo(0);

    // arrow keys nudge the selection: a snap step, or 1/64 beat with Ctrl (each one undo step)
    ui.songSel = new Set([project.song.clips[0].id]);
    key('ArrowRight');
    expect(project.song.clips[0].start).toBeCloseTo(fine + 1);
    key('ArrowLeft', { ctrlKey: true });
    expect(project.song.clips[0].start).toBeCloseTo(fine + 1 - 1 / 64);
    await button(w, '↶').trigger('click');
    expect(project.song.clips[0].start).toBeCloseTo(fine + 1);
    ui.songSel = new Set([project.song.clips[0].id]); // undo clears the selection
    for (let i = 0; i < 10; i++) key('ArrowLeft');
    expect(project.song.clips[0].start).toBe(0); // stops at the start of the song

    // ruler: Ctrl+click puts the playhead exactly there
    const ruler = w.find('.ruler');
    ruler.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 4000, height: 24 });
    await ruler.trigger('pointerdown', { clientX: beatPx * 3.4 });
    expect(ui.songPlayhead).toBe(3);
    await ruler.trigger('pointerdown', { clientX: beatPx * 3.4, ctrlKey: true });
    expect(ui.songPlayhead).toBeCloseTo(3.40625);

    // automation points
    await w.findAll('button').find((b) => b.text() === '+ Add automation').trigger('click');
    const svg = w.find('svg.auto-lane');
    svg.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 4000, height: 72 });
    await svg.trigger('dblclick', { clientX: beatPx * 4.3, clientY: 30 });
    await svg.trigger('dblclick', { clientX: beatPx * 8.3, clientY: 30, ctrlKey: true });
    expect(project.song.automation[0].points.map((p) => p.beat)).toEqual([4, 8.296875]); // nearest 1/64 with Ctrl
    w.unmount();
  });
});

describe('dragging clips across tracks', () => {
  it('keeps following the pointer after the clip changes track, counts scrolling, reaches the bottom track', async () => {
    const { cacheSound } = await import('../src/audio/soundBank.js');
    const { addSoundClip } = await import('../src/engine/song.js');
    ui.view = 'song';
    const w = mount(App, { attachTo: document.body });
    resetProject();
    project.song.clips = [];
    project.sounds.push({ id: 7101, key: 'k7101', name: 'Boom', duration: 1, vol: 0.8, mime: '', size: 1 });
    cacheSound(7101, { length: 10, duration: 1, sampleRate: 10, numberOfChannels: 1, getChannelData: () => new Float32Array(10) });
    addSoundClip(project.song.tracks[0].id, 7101, 0);
    await flushPromises();
    const lane = () => project.song.tracks.findIndex((t) => t.id === project.song.clips[0].trackId);
    const move = (x, y) => window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));

    await w.find('.clip').trigger('pointerdown', { button: 0, clientX: 10, clientY: 30, pointerId: 1 });
    move(10, 30 + 56); // the clip's element is re-created in the next lane…
    await flushPromises();
    expect(lane()).toBe(1);
    move(10, 30 + 112); // …and the drag goes on (events come from the window, not the old element)
    await flushPromises();
    expect(lane()).toBe(2);
    w.find('.scroller').element.scrollTop = 56; // scrolled down one track while dragging
    move(10, 30 + 112);
    await flushPromises();
    expect(lane()).toBe(3); // the bottom track
    window.dispatchEvent(new MouseEvent('pointerup', {}));
    move(10, 30);
    expect(lane()).toBe(3); // released: no longer follows
    w.unmount();
  });
});

describe('truncating clips, the last selected pattern, and song sections', () => {
  const move = (x, y = 0, opts = {}) => window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, ...opts }));
  const up = () => window.dispatchEvent(new MouseEvent('pointerup', {}));

  async function setup() {
    ui.view = 'song';
    const w = mount(App, { attachTo: document.body });
    resetProject();
    curPattern().layers[0].notes = [{ id: 901, start: 0, dur: 1, pitch: 60, vel: 90 }, { id: 902, start: 6, dur: 1, pitch: 62, vel: 90 }]; // 2 bars
    ui.songSnap = 1;
    await flushPromises();
    return w;
  }

  it('drag a clip’s right edge to cut its end, the left edge to cut its start (one undo step each)', async () => {
    const w = await setup();
    const beatPx = ui.barPx / 4;
    const clip = () => project.song.clips[0];
    await w.find('.clip .trim.end').trigger('pointerdown', { button: 0, clientX: 500 });
    move(500 - beatPx * 3.2);
    up();
    expect(clip()).toMatchObject({ start: 0, len: 5 });
    await flushPromises();
    expect(w.find('.clip').attributes('style')).toContain(`width: ${5 * beatPx - 2}px`);
    expect(w.find('.clip').classes()).toContain('cut-end');

    await w.find('.clip .trim.start').trigger('pointerdown', { button: 0, clientX: 100 });
    move(100 + beatPx * 2.1);
    up();
    expect(clip()).toMatchObject({ start: 2, trim: 2, len: 3 });
    await flushPromises();
    expect(w.find('.clip svg.preview').attributes('viewBox')).toBe('2 0 3 100');
    expect(w.find('.clip').classes()).toContain('cut-start');

    await button(w, '↶').trigger('click');
    expect(clip()).toMatchObject({ start: 0, len: 5 });
    expect(clip().trim).toBeUndefined();
    w.unmount();
  });

  it('double-clicking empty space places the pattern last selected — in the list or as a clip', async () => {
    const w = await setup();
    const { newPattern } = await import('../src/engine/song.js');
    const p2 = newPattern();
    await flushPromises();
    await w.findAll('.pattern')[1].trigger('click'); // select Pattern 2 in the list
    expect(project.curPattern).toBe(p2.id);
    await w.find('.clip').trigger('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 }); // Pattern 1's clip
    up();
    expect(project.curPattern).toBe(project.patterns[0].id);
    expect(ui.view).toBe('song');
    const lane = w.findAll('.lane')[1];
    lane.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2000, height: 56 });
    await lane.trigger('dblclick', { clientX: ui.barPx * 4 });
    expect(project.song.clips.at(-1)).toMatchObject({ patternId: project.patterns[0].id, start: 16 });
    w.unmount();
  });

  it('drag in the Sections strip to add a labelled section that tints the lanes; move, resize, rename, delete', async () => {
    const w = await setup();
    const beatPx = ui.barPx / 4;
    const strip = w.find('.sections');
    strip.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 4000, height: 22 });
    await strip.trigger('pointerdown', { button: 0, clientX: 0 });
    move(ui.barPx * 4);
    up();
    await flushPromises();
    expect(project.song.sections).toHaveLength(1);
    expect(project.song.sections[0]).toMatchObject({ name: 'Intro', start: 0, end: 16 });
    const name = w.find('[data-section] input.sec-name'); // just drawn: its name is being edited
    expect(name.exists()).toBe(true);
    await name.setValue('Opening');
    await name.trigger('blur');
    expect(project.song.sections[0].name).toBe('Opening');
    expect(w.find('.section').text()).toContain('Opening');
    expect(w.find('.lane').attributes('style')).toContain('background-size: 96px 100%, 24px 100%, 100% 100%'); // a wash layer under the grid

    await w.find('.section .sec-label').trigger('pointerdown', { button: 0, clientX: 50 });
    move(50 + beatPx * 4);
    up();
    expect(project.song.sections[0]).toMatchObject({ start: 4, end: 20 });
    await w.find('.section .sec-edge.end').trigger('pointerdown', { button: 0, clientX: 50 });
    move(50 + beatPx * 8);
    up();
    expect(project.song.sections[0]).toMatchObject({ start: 4, end: 28 });

    await strip.trigger('dblclick', { clientX: ui.barPx * 10.5 }); // 4 bars from bar 11
    expect(project.song.sections[1]).toMatchObject({ name: 'Verse', start: 40, end: 56 });
    await flushPromises();
    await w.findAll('.section')[1].find('input.sec-name').trigger('blur');
    await w.findAll('.section')[0].trigger('keydown', { key: 'Delete' });
    expect(project.song.sections.map((x) => x.name)).toEqual(['Verse']);
    expect(project.song.clips).toHaveLength(1); // Delete on a section doesn't remove clips
    w.unmount();
  });
});

describe('box selection', () => {
  it('drag on empty track space selects the pattern and sound clips the box touches; Shift adds; a plain click clears', async () => {
    const { cacheSound } = await import('../src/audio/soundBank.js');
    const { addClip, addSoundClip } = await import('../src/engine/song.js');
    ui.view = 'song';
    const w = mount(App, { attachTo: document.body });
    resetProject();
    project.song.clips = [];
    project.sounds.push({ id: 7201, key: 'k7201', name: 'Hit', duration: 1, vol: 0.8, mime: '', size: 1 });
    cacheSound(7201, { length: 10, duration: 1, sampleRate: 10, numberOfChannels: 1, getChannelData: () => new Float32Array(10) });
    const T = project.song.tracks, pid = project.patterns[0].id;
    const a = addClip(T[0].id, pid, 0), b = addSoundClip(T[1].id, 7201, 4), c = addClip(T[2].id, pid, 16), d = addClip(T[0].id, pid, 32);
    ui.songSel = new Set();
    await flushPromises();
    const beatPx = ui.barPx / 4, head = ui.headW, top = 24 + 22; // grid coordinates (the grid's rect is at 0,0 here)
    const move = (x, y) => window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
    const up = () => window.dispatchEvent(new MouseEvent('pointerup', {}));

    // from track 1 beat 2 to track 3 beat 6: touches a (track 1) and b (track 2), not c (beat 16) or d
    await w.findAll('.lane')[0].trigger('pointerdown', { button: 0, clientX: head + beatPx * 2, clientY: top + 20 });
    move(head + beatPx * 6, top + 56 * 2 + 20);
    await flushPromises();
    expect(w.find('.marquee').exists()).toBe(true);
    expect([...ui.songSel].sort()).toEqual([a.id, b.id].sort());
    up();
    await flushPromises();
    expect(w.find('.marquee').exists()).toBe(false);
    expect(w.findAll('.clip.sel')).toHaveLength(2);

    // Shift: adds d (drawn right to left)
    await w.findAll('.lane')[0].trigger('pointerdown', { button: 0, shiftKey: true, clientX: head + beatPx * 40, clientY: top + 10 });
    move(head + beatPx * 33, top + 30);
    up();
    expect([...ui.songSel].sort()).toEqual([a.id, b.id, d.id].sort());

    // a click on empty space without dragging clears the selection
    await w.findAll('.lane')[3].trigger('pointerdown', { button: 0, clientX: head + beatPx * 50, clientY: top + 56 * 3 + 10 });
    up();
    expect(ui.songSel.size).toBe(0);
    expect(c).toBeTruthy();
    w.unmount();
  });
});
