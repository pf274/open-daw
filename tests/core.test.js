import { describe, it, expect } from 'vitest';
import {
  midiToFreq, freqToMidi, detectPitch, snapToScale, alignTake, rhythmFromTaps,
  quantizeNotes, writeMidi, transposeLabel,
} from '../src/core/index.js';
import { parseMidi, noteOns } from './helpers/midi-parse.js';

const sr = 48000;
const settings = {
  winStart: -50, winLen: 300, tapShift: 0, durMode: 'legato', fixedBeats: 0.5, gapMs: 20,
  transpose: -12, scaleRoot: 0, scale: 'chromatic', minClarity: 0.7, vel: 96,
};

describe('pitch detection', () => {
  it.each([72, 79, 84, 91, 96])('detects midi %i from a pure tone', (midi) => {
    const f = midiToFreq(midi), buf = new Float32Array(2048);
    for (let i = 0; i < buf.length; i++) buf[i] = 0.3 * Math.sin((2 * Math.PI * f * i) / sr) + 0.01 * (Math.random() - 0.5);
    expect(freqToMidi(detectPitch(buf, sr).freq)).toBeCloseTo(midi, 1);
  });
  it('treats silence as unvoiced', () => {
    expect(detectPitch(new Float32Array(2048), sr).freq).toBe(0);
  });
});

describe('alignment of a synthetic whistled melody', () => {
  // whistle starts ~30 ms before each tap, slightly sharp/flat, with vibrato
  const melody = [76, 74, 72, 74, 76, 76, 76, 79];
  const tapTimes = melody.map((_, i) => 0.5 * i + (Math.random() - 0.5) * 0.04);
  const total = 4.3, audio = new Float32Array(Math.ceil(total * sr));
  let phase = 0;
  for (let i = 0; i < audio.length; i++) {
    const t = i / sr;
    let k = -1;
    for (let j = 0; j < tapTimes.length; j++) if (t >= tapTimes[j] - 0.03) k = j;
    if (k < 0) continue;
    const gapEnd = (k + 1 < tapTimes.length ? tapTimes[k + 1] - 0.03 : total) - 0.04; // breath between notes
    if (t > gapEnd) continue;
    const m = melody[k] + 0.25 * Math.sin(2 * Math.PI * 5 * t) + (k % 2 ? 0.15 : -0.15);
    phase += (2 * Math.PI * midiToFreq(m)) / sr;
    audio[i] = 0.2 * Math.sin(phase);
  }
  const frames = [];
  for (let s = 0; s + 2048 <= audio.length; s += 480) {
    const r = detectPitch(audio.subarray(s, s + 2048), sr);
    frames.push({ t: (s + 1024) / sr, midi: r.freq ? freqToMidi(r.freq) : 0, c: r.clarity });
  }
  const take = { bpm: 120, startBeat: 4, endT: total, frames, taps: tapTimes.map((d) => ({ down: d, up: d + 0.08 })) };

  it('recovers every pitch (transposed down an octave)', () => {
    const { notes, skipped } = alignTake(take, settings);
    expect(skipped).toBe(0);
    expect(notes.map((n) => n.pitch)).toEqual(melody.map((m) => m - 12));
  });
  it('maps tap times to beats', () => {
    const { notes } = alignTake(take, settings);
    expect(notes[2].start).toBeCloseTo(4 + tapTimes[2] * 2, 9);
  });
  it('legato duration runs to the next tap minus the gap', () => {
    const { notes } = alignTake(take, settings);
    expect(notes[0].dur).toBeCloseTo((tapTimes[1] - tapTimes[0] - 0.02) * 2, 6);
  });
  it('hold duration follows key-up', () => {
    expect(alignTake(take, { ...settings, durMode: 'hold' }).notes[0].dur).toBeCloseTo(0.16, 6);
  });
});

describe('rhythm slots, scales, quantize', () => {
  it('builds rhythm-only slots', () => {
    const rh = rhythmFromTaps({ bpm: 120, startBeat: 2, endT: 2, taps: [{ down: 0, up: 0.1 }, { down: 0.5, up: 0.6 }, { down: 1, up: 1.9 }] }, settings);
    expect(rh).toHaveLength(3);
    expect(rh[1].start).toBe(3);
    expect(rh[0].dur).toBeCloseTo(0.96, 9);
    expect(rh[2].dur).toBeCloseTo(1.8, 9);
  });
  it('snaps to scale', () => {
    expect(snapToScale(73.4, 0, 'major')).toBe(74);
    expect(snapToScale(73.4, 0, 'chromatic')).toBe(73);
  });
  it('quantizes starts and ends', () => {
    const q = [{ start: 1.1, dur: 0.4 }];
    quantizeNotes(q, 0.5, 1, true);
    expect(q[0].start).toBeCloseTo(1, 9);
    expect(q[0].dur).toBeCloseTo(0.5, 9);
  });
  it('labels transpositions', () => {
    expect(transposeLabel(3, 0)).toBe('+3  (C → E♭)');
    expect(transposeLabel(-2, 7)).toBe('-2  (G → F)');
  });
});

describe('MIDI writer', () => {
  const notes = [{ start: 0, dur: 1, pitch: 64, vel: 90 }, { start: 1, dur: 1, pitch: 62, vel: 90 }];
  it('writes format 1 with a tempo track, names and program changes', () => {
    const m = parseMidi(writeMidi({ bpm: 120, tracks: [{ name: 'Lead', program: 73, volume: 1, notes }, { name: 'B', program: 33, notes: [] }] }));
    expect(m.fmt).toBe(1);
    expect(m.ppq).toBe(480);
    expect(m.tracks).toHaveLength(3);
    expect(noteOns(m.tracks[1]).map((e) => e.d1)).toEqual([64, 62]);
    expect(m.tracks[1].some((e) => (e.status & 0xf0) === 0xc0 && e.d1 === 73)).toBe(true);
  });
  it('puts drums on channel 10 without a program change; melodic layers avoid it', () => {
    const m = parseMidi(writeMidi({
      bpm: 100,
      tracks: [{ name: 'Drums', drums: true, notes: [{ start: 0, dur: 0.25, pitch: 36, vel: 100 }] },
        ...Array.from({ length: 10 }, (_, i) => ({ name: 'M' + i, program: 0, notes: [{ start: 0, dur: 1, pitch: 60, vel: 90 }] }))],
    }));
    const drumOn = noteOns(m.tracks[1])[0];
    expect(drumOn.status).toBe(0x99);
    expect(drumOn.d1).toBe(36);
    expect(m.tracks[1].some((e) => (e.status & 0xf0) === 0xc0)).toBe(false);
    const chans = m.tracks.slice(2).map((t) => noteOns(t)[0].status & 15);
    expect(chans).not.toContain(9);
  });
});

describe('meter', async () => {
  const M = await import('../src/core/meter.js');
  it('bar and counted-beat lengths in quarter notes', () => {
    expect(['4/4', '3/4', '6/8', '7/8', '2/2', '12/8'].map((s) => M.barBeats(M.parseTimeSig(s)))).toEqual([4, 3, 3, 3.5, 4, 6]);
    expect(M.countBeats({ num: 6, den: 8 })).toBe(0.5);
  });
  it('formats positions as bar.beat.hundredths in the time signature', () => {
    expect(M.formatPosition(0, { num: 4, den: 4 })).toBe('1.1.00');
    expect(M.formatPosition(5.5, { num: 4, den: 4 })).toBe('2.2.50');
    expect(M.formatPosition(3.5, { num: 7, den: 8 })).toBe('2.1.00');
    expect(M.formatPosition(4.25, { num: 6, den: 8 })).toBe('2.3.50');
  });
  it('normalizes bad input', () => {
    expect(M.normalizeTimeSig({ num: 0, den: 5 })).toEqual({ num: 1, den: 4 });
    expect(M.normalizeTimeSig({ num: 40, den: 16 })).toEqual({ num: 16, den: 16 });
    expect(M.normalizeTimeSig(undefined)).toEqual({ num: 4, den: 4 });
  });
});
