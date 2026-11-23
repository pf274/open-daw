import { describe, it, expect } from 'vitest';
import { midiToFreq, freqToMidi, detectPitch } from '../src/core/pitch.js';
import { scaleNotes, snapToNotes, snapToScale, CUSTOM_SCALE } from '../src/core/scales.js';
import { INPUT_MODES, inputMode, pitchShift, transposeKey } from '../src/core/voice.js';
import { alignTake } from '../src/core/align.js';

const sr = 48000;
/** A voice-like tone: a fundamental with a few harmonics. */
function voice(midi, n = 2048) {
  const f = midiToFreq(midi), buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    buf[i] = 0.5 * Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) + 0.12 * Math.sin(6 * Math.PI * f * t);
  }
  return buf;
}

describe('humming', () => {
  it.each([40, 45, 48, 55, 60, 67, 72])('the hum range detects midi %i (E2–C5), harmonics and all', (midi) => {
    expect(freqToMidi(detectPitch(voice(midi), sr, INPUT_MODES.hum).freq)).toBeCloseTo(midi, 0);
  });

  it('the whistle range does not hear a low hum (why hum mode exists)', () => {
    const r = detectPitch(voice(48), sr, INPUT_MODES.whistle);
    expect(r.freq === 0 || Math.abs(freqToMidi(r.freq) - 48) > 6).toBe(true);
  });

  it('each mode has its own transpose; a take keeps the mode it was recorded in', () => {
    const s = { inputMode: 'hum', transpose: -12, humTranspose: 3 };
    expect(inputMode(s)).toBe('hum');
    expect(pitchShift(s)).toBe(3);
    expect(transposeKey(s)).toBe('humTranspose');
    expect(pitchShift(s, { mode: 'whistle' })).toBe(-12);
    expect(pitchShift({ transpose: -12 })).toBe(-12); // old projects: whistle
  });

  it('alignment uses the take mode transpose', () => {
    const s = { winStart: -50, winLen: 300, tapShift: 0, durMode: 'legato', fixedBeats: 0.5, gapMs: 20, transpose: -12, humTranspose: 0, inputMode: 'whistle', scaleRoot: 0, scale: 'chromatic', minClarity: 0.7, vel: 96 };
    const frames = Array.from({ length: 30 }, (_, i) => ({ t: i * 0.01, midi: 57, c: 0.95 }));
    const take = { bpm: 120, startBeat: 0, endT: 1, frames, taps: [{ down: 0.02, up: 0.3 }] };
    expect(alignTake(take, s).notes[0].pitch).toBe(45); // whistled: an octave down
    expect(alignTake({ ...take, mode: 'hum' }, s).notes[0].pitch).toBe(57); // hummed: as sung
  });
});

describe('scales', () => {
  it('a named scale in a key gives its notes; custom gives the picked notes', () => {
    expect(scaleNotes({ scale: 'major', scaleRoot: 2 })).toEqual([1, 2, 4, 6, 7, 9, 11]); // D major
    expect(scaleNotes({ scale: CUSTOM_SCALE, scaleRoot: 5, customNotes: [7, 0, 4] })).toEqual([0, 4, 7]); // key ignored
    expect(scaleNotes({ scale: CUSTOM_SCALE, customNotes: [] })).toHaveLength(12); // nothing picked: no snapping
  });

  it('snaps to the nearest picked note, across octaves', () => {
    const cge = [0, 4, 7];
    expect(snapToNotes(61.2, cge)).toBe(60);
    expect(snapToNotes(62.4, cge)).toBe(64);
    expect(snapToNotes(70, cge)).toBe(72); // B♭ → the C above (closer than G)
    expect(snapToNotes(66, [0])).toBe(60); // a single note: its nearest octave
    expect(snapToScale(61, 0, 'major')).toBe(60); // the named-scale form still works
  });
});

describe('pitch from the whole note', () => {
  const base = { winStart: -50, winLen: 300, tapShift: 0, durMode: 'legato', fixedBeats: 0.5, gapMs: 20, transpose: 0, humTranspose: 0, scaleRoot: 0, scale: 'chromatic', minClarity: 0.7, vel: 96 };
  // one 1-second note (frames every 10 ms), a second tap at 1 s ends it
  const take = (pitchAt) => ({
    bpm: 60, startBeat: 0, endT: 2,
    frames: Array.from({ length: 200 }, (_, i) => ({ t: i * 0.01, midi: pitchAt(i * 0.01), c: 0.95 })),
    taps: [{ down: 0, up: 0.9 }, { down: 1, up: 1.9 }],
  });

  it('averages over the whole note by default; the window mode only hears the start', () => {
    const drifting = take((t) => (t < 0.3 ? 63.4 : 64.3)); // starts flat, settles a little sharp of E
    expect(alignTake(drifting, base).notes[0].pitch).toBe(64);
    expect(alignTake(drifting, { ...base, pitchFrom: 'note' }).notes[0].pitch).toBe(64);
    expect(alignTake(drifting, { ...base, pitchFrom: 'window' }).notes[0].pitch).toBe(63);
  });

  it('brief slips (an octave jump, a scoop) barely move the average', () => {
    const slips = take((t) => (t > 0.4 && t < 0.5 ? 76 : t < 0.08 ? 58 : 64));
    expect(alignTake(slips, base).notes[0].pitch).toBe(64);
  });

  it('stops at the next note', () => {
    const two = take((t) => (t < 1 ? 60 : 67));
    expect(alignTake(two, base).notes.map((n) => n.pitch)).toEqual([60, 67]);
  });
});
