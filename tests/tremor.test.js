import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tremorSegments, normalizeTremor, hasTremor, cloneNotes, DEFAULT_TREMOR } from '../src/core/index.js';

const voices = [];
vi.mock('../src/audio/synth.js', () => ({ playVoice: (...a) => voices.push(a), click: () => {} }));
vi.mock('../src/audio/mixer.js', () => ({ busFor: (id, gain) => ({ bus: id, gain }), silenceAll: vi.fn() }));
vi.mock('../src/audio/context.js', () => ({ ensureAudio: () => ({ currentTime: 10 }), getCtx: () => ({}) }));
vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));

const { project, resetProject, curTrack, addTrack } = await import('../src/stores/project.js');
const { ui } = await import('../src/stores/ui.js');
const { undo, clearHistory } = await import('../src/stores/history.js');
const { ACTIONS, openTremor, applyTremor, removeTremor, canTremorSel } = await import('../src/engine/editing.js');
const { scheduleTrack } = await import('../src/engine/voices.js');
const { previewNotes } = await import('../src/engine/preview.js');
const { buildSong } = await import('../src/engine/files.js');

const n = (id, start, dur, pitch, extra = {}) => ({ id, start, dur, pitch, vel: 90, ...extra });

describe('tremor (pure)', () => {
  it('clamps and rounds settings', () => {
    expect(normalizeTremor({ depth: 250, rate: 0.2 })).toEqual({ depth: 100, rate: 1 });
    expect(normalizeTremor({ depth: 33.6, rate: 5.55 })).toEqual({ depth: 34, rate: 5.6 });
  });
  it('builds per-note segments for a voice, or null without tremor', () => {
    const at = (b) => b * 0.5;
    expect(tremorSegments([n(1, 0, 1, 60)], at)).toBeNull();
    const segs = tremorSegments([n(1, 0, 1, 60, { tremor: { depth: 40, rate: 6 } }), n(2, 1, 1, 62)], at);
    expect(segs).toEqual([{ from: 0, depth: 40, rate: 6 }, { from: 0.5, depth: 0, rate: DEFAULT_TREMOR.rate }]);
  });
  it('clones tremor objects instead of sharing them', () => {
    const src = n(1, 0, 1, 60, { tremor: { depth: 20, rate: 4 } });
    const [copy] = cloneNotes([src], () => 9);
    expect(copy.tremor).toEqual(src.tremor);
    expect(copy.tremor).not.toBe(src.tremor);
  });
});

describe('tremor in the editor', () => {
  beforeEach(() => {
    resetProject();
    clearHistory();
    voices.length = 0;
    project.bpm = 120;
    ui.tremorModal.open = false;
    curTrack().notes = [n(1, 0, 1, 60), n(2, 1, 1, 64), n(3, 2, 1, 67)];
  });

  it('opens the dialog seeded from existing tremor', () => {
    curTrack().notes[1].tremor = { depth: 55, rate: 8 };
    ui.sel = new Set([1, 2]);
    ACTIONS.tremor();
    expect(ui.tremorModal).toMatchObject({ open: true, depth: 55, rate: 8 });
  });

  it('is unavailable without a selection or on drum layers', () => {
    ui.sel = new Set();
    openTremor();
    expect(ui.tremorModal.open).toBe(false);
    addTrack('Drums', 'drums').notes = [n(10, 0, 0.25, 36)];
    ui.sel = new Set([10]);
    expect(canTremorSel()).toBe(false);
  });

  it('applies to the selection only, and remove/undo work', () => {
    ui.sel = new Set([1, 3]);
    applyTremor({ depth: 40, rate: 6 });
    expect(curTrack().notes.map(hasTremor)).toEqual([true, false, true]);
    expect(curTrack().notes[0].tremor).toEqual({ depth: 40, rate: 6 });
    removeTremor();
    expect(curTrack().notes.some(hasTremor)).toBe(false);
    undo();
    expect(curTrack().notes[2].tremor).toEqual({ depth: 40, rate: 6 });
  });

  it('playback passes tremor to the voice; MIDI export drops it', () => {
    ui.sel = new Set([2]);
    applyTremor({ depth: 25, rate: 4 });
    scheduleTrack(curTrack(), -Infinity, Infinity, (b) => b * 0.5, 0.5, 'bus');
    expect(voices.map((v) => v[6].tremor)).toEqual([null, [{ from: 0.5, depth: 25, rate: 4 }], null]);
    expect(buildSong().tracks[0].notes.every((x) => !('tremor' in x))).toBe(true);
  });

  it('tremor follows notes inside a slide chain', () => {
    ui.sel = new Set([1, 2, 3]);
    ACTIONS.connect();
    ui.sel = new Set([3]);
    applyTremor({ depth: 60, rate: 7 });
    scheduleTrack(curTrack(), -Infinity, Infinity, (b) => b, 1, 'bus');
    expect(voices).toHaveLength(1);
    expect(voices[0][6].tremor.map((s) => s.depth)).toEqual([0, 0, 60]);
  });

  it('preview plays the selection now with unsaved settings, even on a muted layer', () => {
    curTrack().mute = true;
    ui.sel = new Set([2, 3]);
    const notes = curTrack().notes.filter((x) => ui.sel.has(x.id));
    const secs = previewNotes(curTrack(), notes, () => ({ tremor: { depth: 80, rate: 9 } }));
    expect(voices).toHaveLength(2);
    expect(voices[0][0]).toEqual({ bus: curTrack().id, gain: curTrack().vol }); // ignores mute
    expect(voices[0][3]).toBeCloseTo(10.05, 9); // starts right away, first note at t0
    expect(voices[1][3]).toBeCloseTo(10.55, 9);
    expect(voices[0][6].tremor[0]).toMatchObject({ depth: 80, rate: 9 });
    expect(curTrack().notes.some(hasTremor)).toBe(false); // preview doesn't apply
    expect(secs).toBeCloseTo(1.3, 9);
  });
});
