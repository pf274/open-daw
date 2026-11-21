import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slideLinks, buildChain, canConnect, connectNotes, glideSegments, cloneNotes, encodeWav, writeMidi } from '../src/core/index.js';
import { parseMidi, noteOns } from './helpers/midi-parse.js';

// record voices instead of making sound
const voices = [];
vi.mock('../src/audio/synth.js', () => ({ playVoice: (...a) => voices.push(a), click: () => {} }));
vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));

const { project, resetProject, curTrack, addTrack } = await import('../src/stores/project.js');
const { ui } = await import('../src/stores/ui.js');
const { undo, clearHistory } = await import('../src/stores/history.js');
const { ACTIONS, canConnectSel, paste } = await import('../src/engine/editing.js');
const { scheduleTrack } = await import('../src/engine/voices.js');
const { buildSong } = await import('../src/engine/files.js');

const n = (id, start, dur, pitch, extra = {}) => ({ id, start, dur, pitch, vel: 90, ...extra });

describe('slide logic (pure)', () => {
  it('only honours links to later notes that exist', () => {
    const notes = [n(1, 0, 1, 60, { slideTo: 2 }), n(2, 1, 1, 64, { slideTo: 1 }), n(3, 2, 1, 67, { slideTo: 99 })];
    const { next, prev } = slideLinks(notes);
    expect([...next.keys()]).toEqual([1]); // 2→1 points backwards, 3→99 is dangling
    expect(prev.get(2).id).toBe(1);
  });

  it('builds chains', () => {
    const notes = [n(1, 0, 1, 60, { slideTo: 2 }), n(2, 1, 1, 62, { slideTo: 3 }), n(3, 2, 1, 64)];
    expect(buildChain(notes[0], slideLinks(notes).next).map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it('allows connecting only 2+ non-overlapping notes', () => {
    expect(canConnect([n(1, 0, 1, 60)])).toBe(false);
    expect(canConnect([n(1, 0, 1, 60), n(2, 1, 1, 62)])).toBe(true); // back-to-back is fine
    expect(canConnect([n(2, 1, 1, 62), n(1, 0, 1.5, 60)])).toBe(false); // overlap, any order
    expect(canConnect([n(1, 0, 1, 60), n(2, 0, 1, 64)])).toBe(false); // chord
  });

  it('connects in time order regardless of selection order', () => {
    const a = n(1, 2, 1, 60), b = n(2, 0, 1, 62), c = n(3, 1, 1, 64);
    connectNotes([a, b, c]);
    expect([b.slideTo, c.slideTo, a.slideTo]).toEqual([3, 1, undefined]);
  });

  it('glides fill gaps between notes', () => {
    const at = (b) => b * 0.5; // 120 bpm
    expect(glideSegments([n(1, 0, 1, 60), n(2, 2, 1, 67)], at, 0.5)).toEqual([{ from: 0.5, to: 1, pitch: 67 }]);
  });

  it('back-to-back glides are split evenly across both notes', () => {
    const at = (b) => b * 0.5;
    const [g] = glideSegments([n(1, 0, 1, 60), n(2, 1, 1, 67)], at, 0.5); // boundary at 0.5 s
    expect(g.from).toBeCloseTo(0.46, 9); // 40 ms in the first note…
    expect(g.to).toBeCloseTo(0.54, 9); //   …and 40 ms in the second
    expect(0.5 - g.from).toBeCloseTo(g.to - 0.5, 9);
  });

  it('a tiny gap (< 30 ms) is treated as back-to-back, centred in the gap', () => {
    const at = (b) => b; // 1 s per beat
    const [g] = glideSegments([n(1, 0, 1, 60), n(2, 1.02, 1, 67)], at, 1);
    expect(g.from).toBeCloseTo(0.97, 9);
    expect(g.to).toBeCloseTo(1.05, 9);
  });

  it('short notes cap both halves equally so chained glides never overlap', () => {
    const at = (b) => b * 0.5;
    // 1/16 notes at 120 bpm = 62.5 ms each → each side capped at 31.25 ms
    const chain = [n(1, 0, 0.125, 60), n(2, 0.125, 0.125, 62), n(3, 0.25, 0.125, 64)];
    const [g1, g2] = glideSegments(chain, at, 0.5);
    expect(0.0625 - g1.from).toBeCloseTo(0.03125, 9);
    expect(g1.to - 0.0625).toBeCloseTo(0.03125, 9);
    expect(g2.from).toBeGreaterThanOrEqual(g1.to - 1e-12);
  });

  it('clones notes, remapping internal slides and dropping external ones', () => {
    let id = 100;
    const out = cloneNotes([n(1, 0, 1, 60, { slideTo: 2 }), n(2, 1, 1, 62, { slideTo: 9 })], () => id++, 4);
    expect(out.map((x) => [x.id, x.start, x.slideTo])).toEqual([[100, 4, 101], [101, 5, undefined]]);
  });

  it('MIDI writer ignores slides', () => {
    const m = parseMidi(writeMidi({ bpm: 120, tracks: [{ name: 'A', notes: [n(1, 0, 1, 60, { slideTo: 2 }), n(2, 1, 1, 64)] }] }));
    expect(noteOns(m.tracks[1]).map((e) => e.d1)).toEqual([60, 64]);
  });
});

describe('WAV encoder', () => {
  it('writes a valid 16-bit stereo header and samples', () => {
    const L = new Float32Array([0, 1, -1]), R = new Float32Array([0.5, 0, 2]);
    const bytes = encodeWav([L, R], 44100);
    const v = new DataView(bytes.buffer);
    const tag = (o) => String.fromCharCode(...bytes.slice(o, o + 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(40, true)).toBe(12);
    expect(bytes.length).toBe(44 + 12);
    expect(v.getInt16(44 + 2, true)).toBe(16383); // R[0] = 0.5
    expect(v.getInt16(44 + 4, true)).toBe(32767); // L[1] = 1
    expect(v.getInt16(44 + 10, true)).toBe(32767); // R[2] = 2 → clipped
  });
});

describe('connect in the editor + playback', () => {
  beforeEach(() => {
    resetProject();
    clearHistory();
    voices.length = 0;
    project.bpm = 120;
    curTrack().notes = [n(1, 0, 1, 60), n(2, 1, 1, 64), n(3, 3, 1, 67), n(4, 3, 1, 72)];
  });

  it('offers Connect only for non-overlapping selections on melodic layers', () => {
    ui.sel = new Set([1, 2, 3]);
    expect(canConnectSel()).toBe(true);
    ui.sel = new Set([3, 4]); // chord
    expect(canConnectSel()).toBe(false);
    addTrack('Drums', 'drums').notes = [n(10, 0, 0.25, 36), n(11, 1, 0.25, 38)];
    ui.sel = new Set([10, 11]);
    expect(canConnectSel()).toBe(false);
  });

  it('connect / disconnect are undoable', () => {
    ui.sel = new Set([1, 2, 3]);
    ACTIONS.connect();
    expect(curTrack().notes.map((x) => x.slideTo)).toEqual([2, 3, undefined, undefined]);
    ACTIONS.disconnect();
    expect(curTrack().notes.some((x) => x.slideTo != null)).toBe(false);
    undo();
    expect(curTrack().notes[0].slideTo).toBe(2);
  });

  it('plays a connected chain as one gliding voice', () => {
    ui.sel = new Set([1, 2, 3]);
    ACTIONS.connect();
    scheduleTrack(curTrack(), -Infinity, Infinity, (b) => b * 0.5, 0.5, 'bus');
    expect(voices).toHaveLength(2); // chain 1→2→3, plus note 4 on its own
    const [dest, inst, pitch, when, dur, vel, { glides }] = voices[0];
    expect([dest, pitch, when, dur]).toEqual(['bus', 60, 0, 2]); // beats 0..4 at 0.5 s/beat
    expect(glides.map((g) => g.midi)).toEqual([64, 67]);
    expect(voices[1][2]).toBe(72);
    expect(voices[1][6].glides).toBeFalsy();
  });

  it('starting playback mid-chain still sounds the rest of the chain', () => {
    ui.sel = new Set([1, 2, 3]);
    ACTIONS.connect();
    scheduleTrack(curTrack(), 1, Infinity, (b) => b * 0.5, 0.5, 'bus', 1);
    expect(voices[0][2]).toBe(64); // note 2 becomes the head
    expect(voices[0][6].glides.map((g) => g.midi)).toEqual([67]);
  });

  it('applies global transpose to glides; MIDI export drops slides', () => {
    ui.sel = new Set([1, 2]);
    ACTIONS.connect();
    project.transpose = 2;
    scheduleTrack(curTrack(), -Infinity, Infinity, (b) => b, 1, 'bus');
    expect(voices[0][2]).toBe(62);
    expect(voices[0][6].glides[0].midi).toBe(66);
    expect(buildSong().tracks[0].notes.every((x) => !('slideTo' in x))).toBe(true);
  });

  it('copy/paste keeps slides within the pasted notes', () => {
    ui.sel = new Set([1, 2]);
    ACTIONS.connect();
    ACTIONS.copy();
    paste(8);
    const pasted = curTrack().notes.filter((x) => x.start >= 8);
    expect(pasted[0].slideTo).toBe(pasted[1].id);
  });
});
