import { describe, it, expect, vi, beforeEach } from 'vitest';

// a fake audio context, and recordings that are "loaded" only when a test says so
const loaded = new Map(); // `${program}:${note}` → buffer
const requested = [];
vi.mock('../src/audio/context.js', async () => {
  const { fakeCtx } = await import('./helpers/fake-audio.js');
  const ctx = fakeCtx();
  return { getCtx: () => ctx, getMaster: () => ctx.createGain(), ensureAudio: () => ctx, withContext: (c, m, fn) => fn(), outLat: () => 0 };
});
vi.mock('../src/audio/gmSamples.js', async (orig) => {
  const real = await orig();
  return {
    ...real,
    peekSample: (program, midi) => loaded.get(`${program}:${real.sampleNote(midi)}`) || null,
    loadSample: (program, midi) => { requested.push([program, real.sampleNote(midi)]); return Promise.resolve(); },
    normalizeGain: () => 1,
  };
});

const { getCtx } = await import('../src/audio/context.js');
const { playVoice } = await import('../src/audio/synth.js');
const { specFor, gmProgramFor, INSTRUMENTS } = await import('../src/audio/instruments.js');
const { loopPoints, isSustained } = await import('../src/audio/recorded.js');
const { midiToFreq } = await import('../src/core/pitch.js');
const { setInstrument } = await import('../src/engine/synthEditor.js');

/** A fake decoded recording: a 220 Hz-ish tone of `secs` seconds at 48 kHz. */
function recording(secs) {
  const b = getCtx().createBuffer(1, Math.round(48000 * secs), 48000);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin(i / 20);
  return b;
}
const sources = () => getCtx().nodes.filter((n) => n.kind === 'noise' && n.buffer); // buffer sources

beforeEach(() => { loaded.clear(); requested.length = 0; getCtx().nodes.length = 0; });

describe('recorded instruments', () => {
  const sax = { inst: 'recorded', program: 66, notes: [] };

  it('a layer picks a GM instrument; MIDI export uses it', () => {
    expect(specFor(sax)).toMatchObject({ sampled: 66, name: 'Alto Sax', sustained: true });
    expect(gmProgramFor(sax)).toBe(65); // 0-based in MIDI files
    expect(specFor({ inst: 'recorded', program: 999 }).sampled).toBe(128); // clamped
    expect(isSustained(1)).toBe(false); // piano rings out
    expect(INSTRUMENTS.recorded.recorded).toBe(true);
  });

  it('plays the recording when it is loaded, transposed from the nearest recorded note', () => {
    loaded.set('66:69', recording(3));
    playVoice({ connect() {} , kind: 'dest', out: [] }, specFor(sax), 69, 1, 0.5, 100);
    const [src] = sources();
    expect(src).toBeDefined();
    expect(src.playbackRate.events[0]).toEqual(['setValueAtTime', 1, 1]); // A4 recorded at A4
    expect(src.loop).toBeFalsy(); // a short note: no looping needed
    expect(requested).toEqual([]);
  });

  it('while a recording is loading: asks for it and plays the stand-in synth (a sax-like one for reeds)', () => {
    playVoice({ connect() {}, kind: 'dest', out: [] }, specFor(sax), 62, 1, 0.5, 100);
    expect(requested).toEqual([[66, 62]]);
    expect(sources()).toHaveLength(0);
    expect(getCtx().nodes.some((n) => n.kind === 'osc')).toBe(true); // synth oscillators instead
  });

  it('holds long notes of sustained instruments by looping a steady stretch, a whole number of periods long', () => {
    loaded.set('66:57', recording(2.5));
    playVoice({ connect() {}, kind: 'dest', out: [] }, specFor(sax), 57, 0, 6, 100); // 6 s: longer than the recording
    const [src] = sources();
    expect(src.loop).toBe(true);
    const periods = (src.loopEnd - src.loopStart) * midiToFreq(57);
    expect(periods).toBeCloseTo(Math.round(periods), 6);
    expect(src.loopStart).toBeGreaterThan(0.5);
    expect(loopPoints(recording(0.3), 57)).toBe(null); // too short to have a steady part
    // a plucked instrument just rings out
    getCtx().nodes.length = 0;
    loaded.set('25:57', recording(2.5));
    playVoice({ connect() {}, kind: 'dest', out: [] }, specFor({ inst: 'recorded', program: 25 }), 57, 0, 6, 100);
    expect(sources()[0].loop).toBeFalsy();
  });

  it('switching a layer to a recorded instrument starts from the same kind of instrument', () => {
    const tr = { inst: 'marimba', notes: [] };
    setInstrument(tr, 'recorded');
    expect(tr.program).toBe(13); // Marimba
    const drums = { inst: 'drums', notes: [] };
    setInstrument(drums, 'recorded');
    expect(drums.program).toBe(66); // no drum kit among melodic instruments: Alto Sax
  });
});
