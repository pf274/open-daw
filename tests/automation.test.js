import { describe, it, expect, vi, beforeEach } from 'vitest';
import { valueAt, sampleCurve, curvePath, normalizePoints, handleBeats, segment, DEFAULT_EASE } from '../src/core/automation.js';
import { AUTOMATION_EFFECTS } from '../src/audio/effects.js';
import { fakeCtx } from './helpers/fake-audio.js';

vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));
const P = await import('../src/stores/project.js');
const { project, resetProject, serialize, loadProjectData, addTrack, curPattern } = P;
const { ui } = await import('../src/stores/ui.js');
const { undo, clearHistory } = await import('../src/stores/history.js');
const A = await import('../src/engine/automation.js');
const { removeSongTrack } = await import('../src/engine/song.js');

const pt = (beat, value, ease = DEFAULT_EASE) => ({ beat, value, ease });

describe('curves (pure)', () => {
  it('hold the first/last value outside the points; no points → the default', () => {
    const pts = [pt(4, 0.2), pt(8, 0.8)];
    expect(valueAt(pts, 0, 1)).toBe(0.2);
    expect(valueAt(pts, 20, 1)).toBe(0.8);
    expect(valueAt([], 3, 0.5)).toBe(0.5);
  });

  it('ease 0 gives straight lines; the default ease gives a smooth S-curve with horizontal handles', () => {
    const lin = [pt(0, 0, 0), pt(4, 1, 0)];
    expect(valueAt(lin, 1, 0)).toBeCloseTo(0.25, 6);
    expect(valueAt(lin, 2, 0)).toBeCloseTo(0.5, 6);
    const s = [pt(0, 0), pt(4, 1)];
    expect(valueAt(s, 2, 0)).toBeCloseTo(0.5, 6); // symmetric
    expect(valueAt(s, 0.5, 0)).toBeLessThan(0.125); // eases out of the first point…
    expect(valueAt(s, 3.5, 0)).toBeGreaterThan(0.875); // …and into the second
    const [, p1, p2] = segment(s[0], s[1]);
    expect(p1[1]).toBe(0); // handles are horizontal
    expect(p2[1]).toBe(1);
  });

  it('is monotonic between points and never overshoots', () => {
    const pts = [pt(0, 0.1, 1), pt(3, 0.9, 1), pt(5, 0.4, 0.3)];
    const vals = sampleCurve(pts, 0, 3, 50, 0);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1] - 1e-6);
    for (const v of sampleCurve(pts, 0, 6, 200, 0)) { expect(v).toBeGreaterThanOrEqual(0.1 - 1e-6); expect(v).toBeLessThanOrEqual(0.9 + 1e-6); }
    expect(vals[0]).toBeCloseTo(0.1, 6);
    expect(vals.at(-1)).toBeCloseTo(0.9, 6);
  });

  it('draws as an SVG path of cubic beziers across the whole lane', () => {
    const d = curvePath([pt(1, 0), pt(3, 1)], (b) => b * 10, (v) => 100 - v * 100, 200, 0.5);
    expect(d.startsWith('M0,100.0 L10.0,100.0 C')).toBe(true);
    expect(d.endsWith('L200.0,0.0')).toBe(true);
    expect(curvePath([], (b) => b, (v) => v * 10, 50, 0.5)).toBe('M0,5 L50,5');
  });

  it('normalizes points and places handles', () => {
    expect(normalizePoints([{ beat: 5, value: 2 }, { beat: -1, value: 0.5, ease: 3 }, { beat: 'x', value: 1 }]))
      .toEqual([{ beat: 0, value: 0.5, ease: 1 }, { beat: 5, value: 1, ease: DEFAULT_EASE }]);
    const pts = [pt(0, 0), pt(4, 1, 0.5), pt(12, 0)];
    expect(handleBeats(pts, 1)).toEqual({ left: 3, right: 6 });
    expect(handleBeats(pts, 0).left).toBeNull();
  });
});

describe('effects', () => {
  it('map curve values to their parameters', () => {
    const { volume, pan, lowpass, highpass } = AUTOMATION_EFFECTS;
    expect([volume.toParam(volume.default), volume.format(0.5), volume.format(0)]).toEqual([1, '-12.0 dB', '−∞ dB']);
    expect([pan.toParam(0), pan.toParam(0.5), pan.toParam(1), pan.format(0.5), pan.format(0.3)]).toEqual([-1, 0, 1, 'Centre', 'L 40%']);
    expect(lowpass.toParam(lowpass.default)).toBeCloseTo(20000, 6);
    expect(highpass.toParam(highpass.default)).toBeCloseTo(20, 6);
    expect(lowpass.format(0.5)).toBe('632 Hz');
  });
});

describe('editing (undoable)', () => {
  beforeEach(() => { resetProject(); clearHistory(); ui.autoSel = null; });

  it('adds an automation track aimed at the first song track; points insert in order; same beat replaces', () => {
    const a = A.addAutomation('pan');
    expect(a).toMatchObject({ effect: 'pan', name: 'Pan 1', targets: [project.song.tracks[0].id] });
    expect(A.addPoint(a, 8, 0.2)).toBe(0);
    expect(A.addPoint(a, 0, 0.9)).toBe(0);
    expect(A.addPoint(a, 4, 0.5)).toBe(1);
    expect(a.points.map((p) => p.beat)).toEqual([0, 4, 8]);
    expect(A.addPoint(a, 4, 0.7)).toBe(1);
    expect(a.points).toHaveLength(3);
    expect(a.points[1].value).toBe(0.7);
    A.deletePoint(a, 0);
    expect(a.points.map((p) => p.beat)).toEqual([4, 8]);
    undo();
    expect(project.song.automation[0].points.map((p) => p.beat)).toEqual([0, 4, 8]);
  });

  it('targets toggle; effects switch; removing a song track removes it from targets', () => {
    const a = A.addAutomation();
    const [t1, t2] = project.song.tracks;
    A.toggleTarget(a, t2.id);
    expect(a.targets).toEqual([t1.id, t2.id]);
    A.toggleTarget(a, t1.id);
    expect(a.targets).toEqual([t2.id]);
    A.setEffect(a, 'lowpass');
    expect(a.effect).toBe('lowpass');
    removeSongTrack(t2.id);
    expect(project.song.automation[0].targets).toEqual([]);
    A.removeAutomation(a.id);
    expect(project.song.automation).toHaveLength(0);
  });

  it('saves and loads; bad data is cleaned; old files have no automation', () => {
    const a = A.addAutomation('highpass');
    A.addPoint(a, 2, 0.3);
    const data = JSON.parse(serialize());
    data.song.automation[0].targets.push(999999); // missing track
    data.song.automation.push({ effect: 'warp', points: [{ beat: 1, value: 5 }] });
    loadProjectData(data);
    expect(project.song.automation[0]).toMatchObject({ effect: 'highpass', targets: [project.song.tracks[0].id] });
    expect(project.song.automation[0].points).toEqual([{ beat: 2, value: 0.3, ease: DEFAULT_EASE }]);
    expect(project.song.automation[1]).toMatchObject({ effect: 'volume', points: [{ beat: 1, value: 1 }] });
    delete data.song.automation;
    loadProjectData(data);
    expect(project.song.automation).toEqual([]);
  });
});

describe('audio graph', () => {
  beforeEach(() => { resetProject(); clearHistory(); });

  it('routes each song track through one effect node per automation track that targets it', () => {
    const [t1, t2] = project.song.tracks;
    const vol = A.addAutomation('volume');
    const lp = A.addAutomation('lowpass');
    A.toggleTarget(lp, t2.id); // lowpass on t1 + t2, volume on t1 only
    const ctx = fakeCtx(), master = ctx.createGain();
    const g = A.buildSongGraph(ctx, master, { fromBeat: 0, endBeat: 16, at: (b) => b * 0.5 });
    const layer = curPattern().layers[0];
    const d1 = g.destFor(t1, layer), d2 = g.destFor(t2, layer);
    expect(g.destFor(t1, layer)).toBe(d1); // reused
    const chain = (dest) => { const out = []; let n = dest.out[0]; while (n && n !== master) { out.push(n.kind === 'filter' ? n.type : n.kind); n = n.out[0]; } return out; };
    expect(chain(d1)).toEqual(['gain', 'gain', 'lowpass']); // input, volume, lowpass
    expect(chain(d2)).toEqual(['gain', 'lowpass']);
    expect(d1.gain.value).toBe(layer.vol);
    layer.mute = true;
    g.updateMix();
    expect(d1.gain.value).toBe(0);
    g.dispose();
    void vol;
  });

  it('schedules the curve: one value for a flat line, a sampled value curve otherwise', () => {
    const a = A.addAutomation('volume');
    const ctx = fakeCtx();
    const flat = ctx.createGain();
    A.addPoint(a, 4, 0.5);
    A.scheduleAutomation(flat.gain, a, { fromBeat: 0, endBeat: 16, at: (b) => 1 + b * 0.5 });
    expect(flat.gain.events).toEqual([['setValueAtTime', 0.25, 1]]); // 0.5² = 0.25, held
    A.addPoint(a, 12, 1);
    const curve = ctx.createGain();
    A.scheduleAutomation(curve.gain, a, { fromBeat: 2, endBeat: 16, at: (b) => 1 + b * 0.5 });
    const [m, values, t, dur] = curve.gain.events[1];
    expect(m).toBe('setValueCurveAtTime');
    expect([t, dur]).toEqual([2, 7]); // beats 2…16 at 0.5 s/beat, starting at 1 s
    expect(values.length).toBe(350); // 50 samples per second
    expect(values[0]).toBeCloseTo(0.25, 6);
    expect(values.at(-1)).toBeCloseTo(1, 6);
  });
});

describe('automation timing when a track starts later in the song', () => {
  beforeEach(() => { resetProject(); clearHistory(); });
  const curveOf = (ctx) => ctx.nodes.filter((n) => n.kind === 'filter').map((n) => n.frequency.events.find((e) => e[0] === 'setValueCurveAtTime'))[0];

  it('schedules every automated track’s curve when playback starts, not when its first clip plays', () => {
    const [t1] = project.song.tracks;
    const lp = A.addAutomation('lowpass'); // targets t1
    A.addPoint(lp, 4, 0);
    A.addPoint(lp, 8, 1);
    const ctx = fakeCtx(), master = ctx.createGain();
    A.buildSongGraph(ctx, master, { fromBeat: 0, endBeat: 16, at: (b) => 1 + b * 0.5 });
    const [, , t, dur] = curveOf(ctx); // built before any destFor()
    expect([t, dur]).toEqual([1, 8]);
    void t1;
  });

  it('a chain built after its start time has passed starts its curve at the current beat (not shifted later)', () => {
    const lp = A.addAutomation('lowpass');
    A.addPoint(lp, 4, 0);
    A.addPoint(lp, 8, 1);
    const ctx = fakeCtx(), master = ctx.createGain();
    const g = A.buildSongGraph(ctx, master, { fromBeat: 0, endBeat: 16, at: (b) => 1 + b * 0.5 });
    // a track that gains automation mid-play (its chain is built lazily, late)
    const t2 = project.song.tracks[1];
    A.toggleTarget(lp, t2.id);
    ctx.currentTime = 3; // beat 4 is playing
    ctx.nodes.length = 0;
    g.destFor(t2, curPattern().layers[0]);
    const [, values, t, dur] = curveOf(ctx);
    expect(t).toBeCloseTo(3.01);
    expect(t + dur).toBeCloseTo(9); // still ends at beat 16
    expect(values[0]).toBeCloseTo(AUTOMATION_EFFECTS.lowpass.toParam(0), 0); // the value at beat 4, i.e. in step with the song
  });
});

describe('insert effects on song tracks', () => {
  beforeEach(() => { resetProject(); clearHistory(); });
  it('a Wah-wah automation track sweeps the filter along the curve and stops its LFO when playback ends', () => {
    const a = A.addAutomation('wah');
    expect(a.options).toMatchObject({ rate: 0 });
    A.addPoint(a, 0, 0);
    A.addPoint(a, 4, 1);
    const ctx = fakeCtx(), master = ctx.createGain();
    const g = A.buildSongGraph(ctx, master, { fromBeat: 0, endBeat: 4, at: (b) => b });
    g.destFor(project.song.tracks[0], curPattern().layers[0]);
    const bp = ctx.nodes.find((n) => n.type === 'bandpass');
    const [, values] = bp.frequency.events.find(([m]) => m === 'setValueCurveAtTime');
    expect(values[0]).toBeCloseTo(350, 3);
    expect(values.at(-1)).toBeCloseTo(2500, 3);
    g.dispose();
    expect(ctx.nodes.filter((n) => n.kind === 'osc').every((o) => o.stopped)).toBe(true);
  });
});

describe('row order and switching automation off', () => {
  beforeEach(() => { resetProject(); clearHistory(); });
  const { songRows, orderedTracks, orderKeys } = P;

  it('one order for pattern tracks and automation tracks; moves are undoable', async () => {
    const { moveRow, moveRowBy, addSongTrack } = await import('../src/engine/song.js');
    const [t1, t2] = project.song.tracks;
    const a = A.addAutomation();
    expect(songRows().map((r) => r.kind)).toEqual(['track', 'track', 'track', 'track', 'auto']);
    moveRow(`a:${a.id}`, 1); // right under Track 1
    expect(songRows().map((r) => (r.kind === 'auto' ? 'A' : r.item.name))).toEqual(['Track 1', 'A', 'Track 2', 'Track 3', 'Track 4']);
    moveRowBy(`t:${t2.id}`, -1); // Track 2 above the automation
    expect(orderedTracks().map((t) => t.name)).toEqual(['Track 1', 'Track 2', 'Track 3', 'Track 4']);
    expect(songRows()[2].kind).toBe('auto');
    moveRowBy(`t:${t1.id}`, -1); // already at the top: no-op
    const t5 = addSongTrack();
    expect(songRows().at(-1).item).toBe(project.song.tracks.at(-1)); // new rows go to the bottom
    expect(t5.name).toBe('Track 5');
    undo(); undo(); undo();
    expect(songRows().map((r) => r.kind)).toEqual(['track', 'track', 'track', 'track', 'auto']);
  });

  it('reading the order never writes it; a damaged order is repaired', () => {
    project.song.order = ['t:999', `t:${project.song.tracks[2].id}`, `t:${project.song.tracks[2].id}`];
    const before = [...project.song.order];
    const keys = orderKeys(project.song);
    expect(project.song.order).toEqual(before); // pure
    expect(keys).toHaveLength(4);
    expect(keys[0]).toBe(`t:${project.song.tracks[2].id}`);
  });

  it('removing rows removes them from the order; save/load keeps it; old files list tracks, then automation', async () => {
    const { removeSongTrack, moveRow } = await import('../src/engine/song.js');
    const a = A.addAutomation();
    moveRow(`a:${a.id}`, 0);
    removeSongTrack(project.song.tracks[3].id);
    expect(project.song.order).toHaveLength(4);
    const data = JSON.parse(serialize());
    resetProject();
    loadProjectData(data);
    expect(songRows()[0].kind).toBe('auto');
    delete data.song.order;
    loadProjectData(data);
    expect(songRows().map((r) => r.kind)).toEqual(['track', 'track', 'track', 'auto']);
  });

  it('an automation track that is off keeps its curve but is bypassed (and remembered)', () => {
    const lp = A.addAutomation('lowpass');
    A.addPoint(lp, 0, 0.2);
    expect(lp.enabled).toBe(true);
    A.setAutomationEnabled(lp, false);
    const ctx = fakeCtx(), master = ctx.createGain();
    const g = A.buildSongGraph(ctx, master, { fromBeat: 0, endBeat: 4, at: (b) => b });
    g.destFor(project.song.tracks[0], curPattern().layers[0]);
    expect(ctx.nodes.some((n) => n.type === 'lowpass')).toBe(false);
    expect(lp.points).toHaveLength(1);
    const data = JSON.parse(serialize());
    loadProjectData(data);
    expect(project.song.automation[0].enabled).toBe(false);
    undo();
    expect(project.song.automation[0].enabled).toBe(true);
    delete data.song.automation[0].enabled; // older files: on
    loadProjectData(data);
    expect(project.song.automation[0].enabled).toBe(true);
  });
});

describe('effect order', () => {
  beforeEach(() => { resetProject(); clearHistory(); });
  it('a track’s automation effects are chained top to bottom, following the rows', async () => {
    const { moveRow } = await import('../src/engine/song.js');
    const lp = A.addAutomation('lowpass'); // created first
    const hp = A.addAutomation('highpass'); // created second
    const t1 = project.song.tracks[0];
    const chain = () => {
      const ctx = fakeCtx(), master = ctx.createGain();
      const g = A.buildSongGraph(ctx, master, { fromBeat: 0, endBeat: 4, at: (b) => b });
      const out = [];
      for (let n = g.destFor(t1, curPattern().layers[0]); n && n !== master; n = n.out[0]) if (n.kind === 'filter') out.push(n.type);
      return out;
    };
    expect(chain()).toEqual(['lowpass', 'highpass']);
    moveRow(`a:${hp.id}`, 0); // drag the high-pass row to the top
    expect(chain()).toEqual(['highpass', 'lowpass']);
    expect(project.song.automation.map((a) => a.id)).toEqual([lp.id, hp.id]); // storage order untouched
  });
});
