// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));
const previewSpy = vi.fn(() => 1);
const gmSpy = vi.fn(async () => 1);
const previewClock = { active: false, id: 0, t0: 0, first: 0, spb: 0.5, end: 0, voices: [], synth: null };
vi.mock('../src/engine/preview.js', () => ({
  previewNotes: (...a) => previewSpy(...a),
  previewGmProgram: (...a) => gmSpy(...a),
  stopPreview: vi.fn(),
  previewClock,
}));

// happy-dom has no 2D canvas or ResizeObserver: provide no-op stand-ins
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.confirm = () => true;
});

const App = (await import('../src/App.vue')).default;
const { project, curTrack } = await import('../src/stores/project.js');
const { ui } = await import('../src/stores/ui.js');
const { pick } = await import('../src/engine/pick.js');

/** Open the context menu and return a helper that finds a menu button by its leading text. */
async function openMenu(w, ids) {
  if (ids) ui.sel = new Set(ids);
  Object.assign(ui.ctxMenu, { open: true, x: 10, y: 10, beat: 0 });
  await flushPromises();
}
const menuButton = (w, label) => w.findAll('.ctx button').find((b) => b.text().startsWith(label));
async function hoverSub(w, label) {
  await menuButton(w, label).element.parentElement.dispatchEvent(new Event('pointerenter'));
  await flushPromises();
}
const tab = (w, label) => w.findAll('[role=tab]').find((b) => b.text() === label);

describe('App (mounted)', () => {
  let w;
  beforeAll(() => { w = mount(App, { attachTo: document.body }); });

  it('renders the header tabs, layers and roll; File tab is open by default', () => {
    expect(w.find('canvas').exists()).toBe(true);
    expect(w.text()).toContain('Layers');
    expect(w.findAll('[role=tab]').map((t) => t.text())).toEqual(['File', 'Settings']);
    expect(w.find('[role=tabpanel]').text()).toContain('Open…');
    expect(w.find('[role=tabpanel]').text()).toContain('⬇ MIDI');
    expect(w.findAll('.track')).toHaveLength(1);
    expect(w.text()).not.toContain('Selection:'); // the selection toolbar is gone
    expect(w.findAll('button').some((b) => b.text() === '+oct')).toBe(false);
  });

  it('switches to Settings, and clicking the active tab collapses the panel', async () => {
    await tab(w, 'Settings').trigger('click');
    expect(w.find('[role=tabpanel]').text()).toContain('Reading the pitch');
    expect(w.find('[role=tabpanel]').text()).toContain('Note snap');
    expect(w.find('[role=tabpanel]').text()).toContain('Time signature');
    await tab(w, 'Settings').trigger('click');
    expect(w.find('[role=tabpanel]').exists()).toBe(false);
    await tab(w, 'File').trigger('click');
    expect(w.find('[role=tabpanel]').text()).toContain('Save');
  });

  it('Settings: a custom scale (starting from the current one) and the whistle / hum switch', async () => {
    project.settings.scale = 'major';
    project.settings.scaleRoot = 7; // G major
    await tab(w, 'Settings').trigger('click');
    const panel = () => w.find('[role=tabpanel]');
    expect(panel().find('select[aria-label=Key]').exists()).toBe(true);
    const scale = panel().find('select[aria-label=Scale]');
    scale.element.value = 'custom';
    await scale.trigger('change');
    expect(project.settings.customNotes).toEqual([0, 2, 4, 6, 7, 9, 11]); // G major's notes, to edit
    expect(panel().find('select[aria-label=Key]').exists()).toBe(false); // the picked notes say it all
    const noteBtn = (n) => panel().findAll('.note-btn').find((b) => b.text() === n);
    expect(noteBtn('F#').attributes('aria-pressed')).toBe('true');
    await noteBtn('F#').trigger('click');
    await noteBtn('F').trigger('click');
    expect(project.settings.customNotes).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(panel().text()).toContain('Notes: C D E F G A B');

    expect(panel().text()).toContain('Whistle transpose');
    const mode = panel().find('select[aria-label="Recording input"]');
    await mode.setValue('hum');
    expect(project.settings.inputMode).toBe('hum');
    const tr = panel().find('input[aria-label="Hum transpose"]');
    expect(tr.element.value).toBe('0');
    await tr.setValue('12');
    expect(project.settings.humTranspose).toBe(12);
    expect(project.settings.transpose).toBe(-12); // whistling keeps its own
    const rt = panel().find('input[aria-label="Recording tempo"]');
    expect(rt.attributes('disabled')).toBeDefined(); // off: the song's tempo
    project.bpm = 120;
    await panel().find('input[aria-label="Own recording tempo"]').setValue(true);
    expect(project.settings.recTempo).toBe(90); // starts at ¾ speed
    expect(panel().text()).toContain('75% of 120');
    await rt.setValue('500');
    await rt.trigger('change');
    expect(project.settings.recTempo).toBe(300); // clamped
    await panel().find('input[aria-label="Own recording tempo"]').setValue(false);
    expect(project.settings.recTempo).toBe(0);
    project.bpm = 100;
    Object.assign(project.settings, { inputMode: 'whistle', humTranspose: 0, scale: 'chromatic', scaleRoot: 0 });
    await tab(w, 'Settings').trigger('click');
  });

  it('a layer can play a recorded instrument: pick it, choose the GM instrument; saved and exported', async () => {
    const { serialize, loadProjectData } = await import('../src/stores/project.js');
    const { buildSong } = await import('../src/engine/files.js');
    const tr = curTrack();
    const before = tr.inst;
    const inst = w.find('.track select');
    await inst.setValue('recorded');
    expect(tr.inst).toBe('recorded');
    expect(tr.program).toBeGreaterThan(0);
    const prog = w.find('select[aria-label="Recorded instrument"]');
    expect(prog.findAll('optgroup').map((g) => g.attributes('label'))).toContain('Reed');
    await prog.setValue('67'); // Tenor Sax
    expect(tr.program).toBe(67);
    tr.notes = [{ id: 99001, start: 0, dur: 1, pitch: 60, vel: 90 }];
    expect(buildSong('pattern').tracks[0].program).toBe(66);
    loadProjectData(JSON.parse(serialize()));
    expect(curTrack()).toMatchObject({ inst: 'recorded', program: 67 });
    curTrack().notes = [];
    curTrack().inst = before;
    await flushPromises();
  });

  it('adds a drum layer and selects it', async () => {
    await w.findAll('button').find((b) => b.text() === '+ Add drums').trigger('click');
    expect(project.tracks).toHaveLength(2);
    expect(curTrack().inst).toBe('drums');
    expect(w.findAll('.track')).toHaveLength(2);
  });

  it('context menu Select ▸ and Transpose ▸ submenus edit notes; undo button reverts', async () => {
    project.sel = project.tracks[0].id;
    curTrack().notes = [{ id: 9001, start: 0, dur: 1, pitch: 60, vel: 90 }];
    await openMenu(w, []);
    expect(menuButton(w, 'Copy').attributes('disabled')).toBeDefined(); // nothing selected yet
    await hoverSub(w, 'Select');
    await menuButton(w, 'All').trigger('click');
    expect(ui.ctxMenu.open).toBe(false);
    expect(w.find('footer').text()).toContain('1 selected');

    await openMenu(w);
    await hoverSub(w, 'Transpose');
    await menuButton(w, 'Up an octave').trigger('click');
    expect(curTrack().notes[0].pitch).toBe(72);
    const undoBtn = w.find('button[title^="Undo"]');
    await undoBtn.trigger('click');
    expect(curTrack().notes[0].pitch).toBe(60);
  });

  it('song key stepper in Transpose ▸ keeps the menu open and updates Settings + footer', async () => {
    await openMenu(w, [9001]);
    await hoverSub(w, 'Transpose');
    const stepper = w.find('.ctx .stepper');
    expect(stepper.text()).toContain('off');
    const plus = stepper.find('button[aria-label=Up]');
    for (let i = 0; i < 3; i++) await plus.trigger('click');
    expect(project.transpose).toBe(3);
    expect(ui.ctxMenu.open).toBe(true);
    expect(w.find('.ctx .stepper').text()).toContain('C → E♭');
    expect(w.find('footer').text()).toContain('transposed +3');
    await w.find('.ctx .stepper button[title=Reset]').trigger('click');
    expect(project.transpose).toBe(0);
    ui.ctxMenu.open = false;

    await tab(w, 'Settings').trigger('click');
    const sel = w.findAll('[role=tabpanel] select').find((s) => s.text().includes('(C → E♭)'));
    sel.element.value = '-2';
    await sel.trigger('change');
    expect(project.transpose).toBe(-2);
    project.transpose = 0;
    await tab(w, 'File').trigger('click');
  });

  it('Timing ▸ Quantize… opens a modal with preview; Apply quantizes and Q repeats it', async () => {
    curTrack().notes = [{ id: 9101, start: 0.1, dur: 0.9, pitch: 60, vel: 90 }, { id: 9102, start: 1.2, dur: 0.6, pitch: 62, vel: 90 }];
    await openMenu(w, [9101, 9102]);
    await hoverSub(w, 'Timing');
    await menuButton(w, 'Quantize').trigger('click');
    await flushPromises();
    const modal = w.find('.modal');
    expect(modal.text()).toContain('Quantize');
    expect(modal.text()).toContain('2 selected notes');

    await modal.find('select').setValue('1'); // quarter-note grid
    await modal.find('input[type=range]').setValue('50');
    previewSpy.mockClear();
    await modal.findAll('button').find((b) => b.text().includes('Preview')).trigger('click');
    const previewed = previewSpy.mock.calls[0][1];
    expect(previewed.map((n) => +n.start.toFixed(3))).toEqual([0.05, 1.1]); // 50% toward 0 and 1
    expect(curTrack().notes[0].start).toBe(0.1); // preview doesn't apply

    await modal.findAll('button').find((b) => b.text() === 'Apply').trigger('click');
    expect(w.find('.modal').exists()).toBe(false);
    expect(curTrack().notes.map((n) => +n.start.toFixed(3))).toEqual([0.05, 1.1]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ' })); // repeat: another 50%
    expect(curTrack().notes.map((n) => +n.start.toFixed(3))).toEqual([0.025, 1.05]);
  });

  it('Velocity ▸ presets and Move to layer ▸', async () => {
    curTrack().notes = [{ id: 9201, start: 0, dur: 1, pitch: 60, vel: 90 }];
    await openMenu(w, [9201]);
    await hoverSub(w, 'Velocity');
    expect(w.find('.ctx').text()).toContain('Now 90');
    await menuButton(w, 'ff').trigger('click');
    expect(curTrack().notes[0].vel).toBe(112);

    await openMenu(w, [9201]);
    await hoverSub(w, 'Move to layer');
    await menuButton(w, 'Drums').trigger('click');
    expect(curTrack().notes).toHaveLength(0);
    expect(project.tracks[1].notes.map((n) => n.id)).toEqual([9201]);
    curTrack().notes = [{ id: 9001, start: 0, dur: 1, pitch: 60, vel: 90 }];
  });

  it('context menu opens and "Change notes…" enters pick mode', async () => {
    ui.sel = new Set([9001]);
    Object.assign(ui.ctxMenu, { open: true, x: 10, y: 10, beat: 0 });
    await flushPromises();
    const item = w.findAll('.ctx button').find((b) => b.text().startsWith('Change notes'));
    await item.trigger('click');
    expect(ui.ctxMenu.open).toBe(false);
    expect(pick.active).toBe(true);
    await flushPromises();
    expect(w.text()).toContain('Note 1 / 1');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    expect(pick.active).toBe(false);
  });

  it('context menu "Connect" is enabled only for non-overlapping selections', async () => {
    project.sel = project.tracks[0].id;
    curTrack().notes = [
      { id: 7001, start: 0, dur: 1, pitch: 60, vel: 90 },
      { id: 7002, start: 1, dur: 1, pitch: 64, vel: 90 },
      { id: 7003, start: 1, dur: 1, pitch: 67, vel: 90 },
    ];
    const openMenu = async (ids) => {
      ui.sel = new Set(ids);
      Object.assign(ui.ctxMenu, { open: true, x: 10, y: 10, beat: 0 });
      await flushPromises();
      return w.findAll('.ctx button').find((b) => b.text().startsWith('Connect'));
    };
    let item = await openMenu([7002, 7003]); // overlapping
    expect(item.attributes('disabled')).toBeDefined();
    expect(item.attributes('title')).toContain('overlap');
    item = await openMenu([7001, 7002]);
    expect(item.attributes('disabled')).toBeUndefined();
    await item.trigger('click');
    expect(curTrack().notes[0].slideTo).toBe(7002);
    expect(w.text()).toContain('Connected 2 notes');
    curTrack().notes = [{ id: 9001, start: 0, dur: 1, pitch: 60, vel: 90 }];
  });

  it('Tremor… opens a modal; preview uses the sliders; apply sets tremor', async () => {
    project.sel = project.tracks[0].id;
    curTrack().notes = [{ id: 8001, start: 0, dur: 1, pitch: 60, vel: 90 }, { id: 8002, start: 1, dur: 1, pitch: 62, vel: 90 }];
    ui.sel = new Set([8001, 8002]);
    Object.assign(ui.ctxMenu, { open: true, x: 10, y: 10, beat: 0 });
    await flushPromises();
    await w.findAll('.ctx button').find((b) => b.text().startsWith('Tremor')).trigger('click');
    await flushPromises();
    const modal = w.find('.modal');
    expect(modal.exists()).toBe(true);
    expect(modal.text()).toContain('2 selected notes');

    const [strength, freq] = modal.findAll('input[type=range]');
    await strength.setValue('70');
    await freq.setValue('8');
    expect(modal.text()).toContain('±70¢');

    // global shortcuts are suspended while the modal is open
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete' }));
    expect(curTrack().notes).toHaveLength(2);

    previewSpy.mockClear();
    await modal.findAll('button').find((b) => b.text().includes('Preview')).trigger('click');
    expect(previewSpy).toHaveBeenCalledTimes(1);
    const [, notes, override] = previewSpy.mock.calls[0];
    expect(notes.map((x) => x.id)).toEqual([8001, 8002]);
    expect(override()).toEqual({ tremor: { depth: 70, rate: 8 } });
    expect(curTrack().notes[0].tremor).toBeUndefined(); // preview doesn't apply

    await modal.findAll('button').find((b) => b.text() === 'Apply').trigger('click');
    expect(w.find('.modal').exists()).toBe(false);
    expect(curTrack().notes.map((x) => x.tremor)).toEqual([{ depth: 70, rate: 8 }, { depth: 70, rate: 8 }]);
    curTrack().notes = [{ id: 9001, start: 0, dur: 1, pitch: 60, vel: 90 }];
  });

  it('choosing Custom synth opens the editor; preview uses the unsaved patch; Apply saves it', async () => {
    project.sel = project.tracks[0].id;
    await flushPromises();
    const instSelect = w.findAll('.track')[0].find('select');
    instSelect.element.value = 'custom';
    await instSelect.trigger('change');
    await flushPromises();
    const modal = w.find('.modal');
    expect(modal.text()).toContain('Synth — ');
    expect(modal.text()).toContain('Envelope');
    expect(modal.find('svg.adsr path').attributes('d')).toMatch(/^M/);

    await modal.findAll('.waves')[0].findAll('button').find((b) => b.text().includes('triangle')).trigger('click');
    const attack = modal.findAll('input[type=range]').find((i) => i.element.closest('label').textContent.includes('Attack'));
    await attack.setValue('0.5');
    expect(modal.text()).toContain('500 ms');

    previewSpy.mockClear();
    ui.sel = new Set();
    await modal.findAll('button').find((b) => b.text().includes('Preview')).trigger('click');
    const [stand, notes] = previewSpy.mock.calls[0];
    expect(stand.synth).toMatchObject({ wave: 'triangle', attack: 0.5 });
    expect(notes.length).toBe(7); // test phrase
    expect(curTrack().synth.wave).toBe('sawtooth'); // not applied yet

    await modal.findAll('button').find((b) => b.text() === 'Apply').trigger('click');
    expect(w.find('.modal').exists()).toBe(false);
    expect(curTrack().synth).toMatchObject({ wave: 'triangle', attack: 0.5 });

    await w.findAll('.track')[0].findAll('button').find((b) => b.text() === 'Edit synth…').trigger('click');
    await flushPromises();
    expect(w.find('.modal').text()).toContain('Synth — ');
    await w.find('.modal').findAll('button').find((b) => b.text() === 'Cancel').trigger('click');
  });

  it('Filters tab: response graph, add a Frequency Amplifier, drag its handle, envelope modes', async () => {
    project.sel = project.tracks[0].id; // custom-synth layer from earlier tests
    await w.findAll('.track')[0].findAll('button').find((b) => b.text() === 'Edit synth…').trigger('click');
    await flushPromises();
    const modal = w.find('.modal');
    const tabs = modal.findAll('[role=tab]');
    expect(tabs.map((t) => t.text().replace(/\s+/g, ' '))).toEqual(['Sound', 'Filters 1', 'Effects']);
    await tabs[1].trigger('click');
    expect(modal.find('svg.graph path.combined').attributes('d')).toMatch(/^M/);
    expect(modal.findAll('.card')).toHaveLength(1);

    const add = modal.find('select[aria-label="Add a filter"]');
    await add.setValue('amplifier');
    expect(modal.findAll('.card')).toHaveLength(2);
    expect(modal.findAll('[role=tab]')[1].text()).toContain('2');
    const card = modal.findAll('.card')[1];
    expect(card.text()).toContain('Boost');
    expect(card.text()).toContain('+9.0 dB');

    // drag handle 2 to ~1 kHz → ~4 kHz and higher
    const svg = modal.find('svg.graph').element;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 190 });
    const handle = modal.findAll('g.handle')[1];
    await handle.trigger('pointerdown', { clientX: 300, clientY: 80, pointerId: 1 });
    const x4k = 34 + (Math.log(4000 / 20) / Math.log(1000)) * (600 - 42);
    await handle.trigger('pointermove', { clientX: x4k, clientY: 40, pointerId: 1 });
    await handle.trigger('pointerup', { pointerId: 1 });
    const amp = ui.synthModal.patch.filters[1];
    expect(amp.freq).toBeGreaterThan(3800);
    expect(amp.freq).toBeLessThan(4200);
    expect(amp.gain).toBeGreaterThan(9);

    const envSelect = card.find('select[aria-label="Filter 2 envelope"]');
    expect(envSelect.findAll('option').map((o) => o.text())).toEqual(['Off', 'Sweep frequency', 'Fade boost']);
    await envSelect.setValue('gain');
    expect(card.find('svg.adsr').exists()).toBe(true);
    expect(card.text()).toContain('Attack');
    expect(card.text()).not.toContain('Amount'); // only for sweeps
    // a low-pass card can't fade a boost
    expect(modal.findAll('.card')[0].find('select[aria-label="Filter 1 envelope"]').findAll('option').map((o) => o.text())).toEqual(['Off', 'Sweep frequency']);

    await modal.findAll('.card')[0].find('button[aria-label="Remove filter 1"]').trigger('click');
    expect(modal.findAll('.card')).toHaveLength(1);
    await modal.findAll('button').find((b) => b.text() === 'Apply').trigger('click');
    expect(curTrack().synth.filters.map((f) => [f.type, f.env.mode])).toEqual([['amplifier', 'gain']]);
  });

  it('Effects tab: reverb sliders; preview uses the unsaved reverb; Apply saves it', async () => {
    project.sel = project.tracks[0].id; // custom-synth layer from earlier tests
    await w.findAll('.track')[0].findAll('button').find((b) => b.text() === 'Edit synth…').trigger('click');
    await flushPromises();
    const modal = w.find('.modal');
    await modal.findAll('[role=tab]')[2].trigger('click');
    expect(modal.text()).toContain('Reverb');
    const slider = (label) => modal.findAll('input[type=range]').find((i) => i.element.closest('label').textContent.includes(label));
    await slider('Amount').setValue('0.6');
    await slider('Decay').setValue('4');
    await slider('Tone').setValue('0.1');
    expect(modal.text()).toContain('60%');
    expect(modal.text()).toContain('dark');
    expect(modal.find('svg.tail path').attributes('d')).toMatch(/^M0,40/);
    expect(modal.findAll('[role=tab]')[2].text()).toContain('1'); // one effect on (the reverb)
    previewSpy.mockClear();
    await modal.findAll('button').find((b) => b.text().includes('Preview')).trigger('click');
    expect(previewSpy.mock.calls[0][0].synth.reverb).toMatchObject({ amount: 0.6, decay: 4, tone: 0.1 });
    expect(curTrack().synth.reverb.amount).toBe(0); // not applied yet
    await modal.findAll('button').find((b) => b.text() === 'Apply').trigger('click');
    expect(curTrack().synth.reverb).toMatchObject({ amount: 0.6, decay: 4, tone: 0.1 });
  });

  it('Effects tab: add, adjust, reorder and remove insert effects; preview includes them', async () => {
    project.sel = project.tracks[0].id;
    await w.findAll('.track')[0].findAll('button').find((b) => b.text() === 'Edit synth…').trigger('click');
    await flushPromises();
    const modal = w.find('.modal');
    await modal.findAll('[role=tab]')[2].trigger('click');
    const add = modal.find('select[aria-label="Add an effect"]');
    expect(add.findAll('option').map((o) => o.text()).slice(1)).toEqual(['Echo', 'Distortion', 'Bitcrusher', 'Wah-wah', 'Chorus', 'Phaser', 'Tremolo']);
    await add.setValue('echo');
    await add.setValue('bitcrusher');
    const cards = () => modal.findAll('.card');
    expect(cards().map((c) => c.find('strong').text())).toEqual(['Echo', 'Bitcrusher']);
    await modal.find('input[aria-label="Bitcrusher Bits"]').setValue('3');
    expect(cards()[1].text()).toContain('3-bit');
    await cards()[1].find('button[aria-label="Move Bitcrusher earlier"]').trigger('click');
    expect(cards().map((c) => c.find('strong').text())).toEqual(['Bitcrusher', 'Echo']);
    previewSpy.mockClear();
    await modal.findAll('button').find((b) => b.text().includes('Preview')).trigger('click');
    expect(previewSpy.mock.calls[0][0].synth.effects.map((e) => [e.type, e.bits ?? null])).toEqual([['bitcrusher', 3], ['echo', null]]);
    await cards()[1].find('button[aria-label="Remove Echo"]').trigger('click');
    expect(cards().map((c) => c.find('strong').text())).toEqual(['Bitcrusher']);
    await modal.findAll('button').find((b) => b.text() === 'Apply').trigger('click');
    expect(curTrack().synth.effects.map((e) => e.type)).toEqual(['bitcrusher']);
  });

  it('the filter graph animates while a preview plays, then settles back', async () => {
    project.sel = project.tracks[0].id;
    await w.findAll('.track')[0].findAll('button').find((b) => b.text() === 'Edit synth…').trigger('click');
    await flushPromises();
    const modal = w.find('.modal');
    await modal.findAll('[role=tab]')[1].trigger('click');
    expect(modal.find('path.live-curve').exists()).toBe(false);

    // simulate a preview that started 0.25 s ago (no AudioContext in tests → "now" is 0)
    Object.assign(previewClock, {
      active: true, id: previewClock.id + 1, t0: -0.25, first: 0, spb: 0.5, end: 10,
      voices: [{ start: 0, end: 4 }],
      synth: { filters: [{ type: 'lowpass', freq: 500, env: { mode: 'freq', amount: 2, attack: 0.5 } }, { type: 'amplifier', freq: 2000, gain: 6 }] },
    });
    await new Promise((r) => setTimeout(r, 60)); // let a few animation frames run
    expect(modal.find('svg.graph').classes()).toContain('live');
    expect(modal.find('path.live-curve').attributes('d')).toMatch(/^M/);
    expect(modal.findAll('circle.live-mark')).toHaveLength(2);
    expect(modal.find('text.live-badge').text()).toBe('● LIVE 0.25 s');
    // halfway through a 0.5 s exponential +2 oct sweep from 500 Hz → 1 kHz
    const cx = +modal.findAll('circle.live-mark')[0].attributes('cx');
    const x1k = 34 + (Math.log(1000 / 20) / Math.log(1000)) * (600 - 42);
    expect(cx).toBeCloseTo(x1k, 0);
    expect(modal.text()).toContain('Green: what the filters are doing right now.');

    previewClock.active = false;
    await new Promise((r) => setTimeout(r, 60));
    expect(modal.find('path.live-curve').exists()).toBe(false);
    expect(modal.find('svg.graph').classes()).not.toContain('live');
    await modal.findAll('button').find((b) => b.text() === 'Cancel').trigger('click');
  });

  it('"▶ Hear" previews the chosen MIDI export instrument, with loading and error states', async () => {
    project.sel = project.tracks[0].id; // a custom-synth layer from the previous test
    await w.findAll('.track')[0].findAll('button').find((b) => b.text() === 'Edit synth…').trigger('click');
    await flushPromises();
    const modal = w.find('.modal');
    const gmSelect = modal.findAll('select').find((s) => s.text().includes('Lead 2 (sawtooth)'));
    await gmSelect.setValue('41'); // Violin
    const hear = () => modal.find('button.hear');
    expect(hear().text()).toBe('▶ Hear');
    expect(hear().attributes('title')).toContain('Violin');

    let release;
    gmSpy.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await hear().trigger('click');
    expect(hear().text()).toBe('Loading…');
    const [tr, program, notes] = gmSpy.mock.calls.at(-1);
    expect(program).toBe(41);
    expect(tr.id).toBe(curTrack().id);
    expect(notes.length).toBe(7); // test phrase (nothing selected)
    release(1);
    await flushPromises();
    expect(hear().text()).toBe('■ Stop');
    await hear().trigger('click');
    expect(hear().text()).toBe('▶ Hear');

    gmSpy.mockImplementationOnce(async () => { throw new Error('offline'); });
    await hear().trigger('click');
    await flushPromises();
    expect(hear().text()).toBe('▶ Hear');
    expect(modal.find('[role=alert]').text()).toContain('Couldn’t load the GM sound');
    await modal.findAll('button').find((b) => b.text() === 'Cancel').trigger('click');
  });

  it('keyboard shortcuts route to editing actions', async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true }));
    expect(ui.sel.size).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp' }));
    expect(curTrack().notes[0].pitch).toBe(61);
  });
});

describe('remembered preferences', () => {
  it('the metronome on/off survives a reload', async () => {
    const { loadPref } = await import('../src/stores/ui.js');
    const { installPrefs } = await import('../src/stores/persistence.js');
    installPrefs();
    ui.metronome = true;
    await flushPromises();
    ui.metronome = false;
    await flushPromises();
    expect(localStorage.getItem('whistle-midi-metronome')).toBe('false');
    expect(loadPref('whistle-midi-metronome', true)).toBe(false); // what a reload reads
    ui.metronome = true;
    await flushPromises();
    expect(loadPref('whistle-midi-metronome', true)).toBe(true);
    localStorage.removeItem('whistle-midi-metronome');
    expect(loadPref('whistle-midi-metronome', true)).toBe(true); // first visit: on
  });
});

describe('toolbar vs settings', () => {
  it('BPM and the mic switch live in Settings, not the toolbar; BPM changes are undoable', async () => {
    const App = (await import('../src/App.vue')).default;
    const { project } = await import('../src/stores/project.js');
    const { ui } = await import('../src/stores/ui.js');
    const { undo } = await import('../src/stores/history.js');
    ui.view = 'pattern';
    ui.tab = 'file';
    const w = mount(App, { attachTo: document.body });
    await flushPromises();
    const bar = () => w.find('.bar.top');
    expect(bar().text()).not.toContain('BPM');
    expect(bar().text()).not.toContain('Mic');
    expect(bar().text()).toContain('Metronome');
    expect(bar().text()).toContain('⏮ Restart');

    ui.tab = 'settings';
    await flushPromises();
    const bpm = w.find('.settings input[aria-label="BPM"]');
    await bpm.setValue('132');
    await bpm.trigger('change');
    expect(project.bpm).toBe(132);
    undo();
    expect(project.bpm).not.toBe(132);
    expect(w.find('.settings button[aria-pressed]').text()).toContain('Mic');
    w.unmount();
  });
});
