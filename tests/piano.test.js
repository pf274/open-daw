import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withContext } from '../src/audio/context.js';
import { playVoice } from '../src/audio/synth.js';
import { playPiano, setPianoSamples, pianoPartials, pianoDecay, onsetOf, PIANO_PROGRAM } from '../src/audio/piano.js';
import { loadSample, peekSample } from '../src/audio/gmSamples.js';
import { fakeCtx } from './helpers/fake-audio.js';

/** A fake decoded sample: `lead` silent frames, then sound. */
const fakeBuffer = (lead = 441) => ({
  sampleRate: 44100, duration: 3, numberOfChannels: 1,
  getChannelData: () => { const d = new Float32Array(44100); d.fill(0.3, lead); return d; },
});
const run = (fn) => { const ctx = fakeCtx(), out = ctx.createGain(); const r = withContext(ctx, out, () => fn(out)); return { ctx, out, r }; };
async function preload(midi, buffer = fakeBuffer()) {
  const ctx = { decodeAudioData: async () => buffer };
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  await withContext(ctx, null, () => loadSample(PIANO_PROGRAM, midi, fetchImpl));
  return buffer;
}

beforeEach(() => setPianoSamples(false));

describe('modelled piano (fallback)', () => {
  it('has slightly stretched partials that get brighter with velocity', () => {
    const soft = pianoPartials(48, 30), hard = pianoPartials(48, 127);
    for (const p of soft.slice(1)) expect(p.ratio).toBeGreaterThan(p.n); // inharmonic stretch
    expect(soft[0].ratio).toBeCloseTo(1, 3);
    expect(hard[4].level / hard[0].level).toBeGreaterThan(soft[4].level / soft[0].level);
    expect(pianoPartials(100, 100).length).toBeLessThan(soft.length); // high notes: fewer partials below 14 kHz
  });
  it('low notes ring longer than high notes', () => {
    expect(pianoDecay(36)).toBeGreaterThan(pianoDecay(60));
    expect(pianoDecay(60)).toBeGreaterThan(pianoDecay(96));
  });
  it('plays unison string pairs, a hammer thunk, and drops the damper at note-off', () => {
    const { ctx, r } = run((out) => playVoice(out, 'piano', 60, 1, 0.5, 100));
    const oscs = ctx.nodes.filter((n) => n.kind === 'osc');
    const partials = pianoPartials(60, 100).length;
    expect(oscs).toHaveLength(partials + 3); // partials 1–3 doubled
    expect(oscs.filter((o) => o.detune.value !== 0).map((o) => o.detune.value)).toEqual([-1.2, 1.2, -1.2, 1.2, -1.2, 1.2]);
    expect(ctx.nodes.some((n) => n.kind === 'noise')).toBe(true);
    const damper = ctx.nodes.find((n) => n.kind === 'gain' && n.gain.events.some(([m, v, t]) => m === 'setTargetAtTime' && v === 0 && t === 1.5));
    expect(damper).toBeTruthy();
  });
});

describe('sampled piano', () => {
  it('uses the recording once loaded: on time (skips encoder padding), velocity-shaded, damped', async () => {
    const buf = await preload(64);
    expect(peekSample(PIANO_PROGRAM, 64)).toBe(buf);
    setPianoSamples(true);
    const { ctx, r } = run((out) => playPiano(out, 64, 2, 1, 127));
    expect(r).toBe('sample');
    const src = ctx.nodes.find((n) => n.kind === 'noise'); // buffer source
    expect(src.playbackRate.events[0]).toEqual(['setValueAtTime', 1, 2]); // recorded at this pitch
    expect(src.started[0]).toBe(2);
    expect(src.started[1]).toBeCloseTo((441 - 32) / 44100, 6); // skip the silent lead-in
    const bright = ctx.nodes.find((n) => n.kind === 'filter').frequency.value;
    const soft = run((out) => playPiano(out, 64, 0, 1, 40)).ctx.nodes.find((n) => n.kind === 'filter').frequency.value;
    expect(soft).toBeLessThan(bright);
  });

  it('notes outside the recorded range re-pitch the nearest sample; slides bend the playback rate', async () => {
    await preload(108);
    setPianoSamples(true);
    const hi = run((out) => playPiano(out, 110, 0, 1, 100)).ctx.nodes.find((n) => n.kind === 'noise');
    expect(hi.playbackRate.events[0][1]).toBeCloseTo(2 ** (2 / 12), 9);
    await preload(60);
    const slide = run((out) => playPiano(out, 60, 0, 2, 100, { glides: [{ from: 0.9, to: 1, midi: 67 }] })).ctx.nodes.find((n) => n.kind === 'noise');
    const ramp = slide.playbackRate.events.find(([m]) => m === 'exponentialRampToValueAtTime');
    expect(ramp[1]).toBeCloseTo(2 ** (7 / 12), 9);
  });

  it('a note that is not loaded yet plays the modelled piano and fetches the sample for next time', async () => {
    setPianoSamples(true);
    const spy = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    globalThis.fetch = spy;
    const first = run((out) => playPiano(out, 71, 0, 1, 100));
    expect(first.r).toBe('synth');
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/acoustic_grand_piano-mp3\/B4\.mp3$/));
    globalThis.fetch = () => Promise.reject(new Error('network disabled in tests'));
  });

  it('turned off: always the modelled piano, nothing downloaded', async () => {
    await preload(62);
    const spy = vi.fn();
    globalThis.fetch = spy;
    expect(run((out) => playPiano(out, 62, 0, 1, 100)).r).toBe('synth');
    expect(run((out) => playPiano(out, 73, 0, 1, 100)).r).toBe('synth');
    expect(spy).not.toHaveBeenCalled();
    globalThis.fetch = () => Promise.reject(new Error('network disabled in tests'));
  });

  it('measures leading silence once per buffer', () => {
    const b = fakeBuffer(0);
    expect(onsetOf(b)).toBe(0);
  });
});

describe('preloading', () => {
  it('collects the transposed notes of piano layers only; failures are reported, not thrown', async () => {
    vi.doMock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));
    const { project, resetProject, curPattern, addTrack } = await import('../src/stores/project.js');
    const { wantedPianoNotes, ensurePianoSamples, pianoSamples } = await import('../src/engine/samples.js');
    resetProject();
    curPattern().layers[0].inst = 'piano';
    curPattern().layers[0].notes = [{ id: 1, start: 0, dur: 1, pitch: 60, vel: 90 }, { id: 2, start: 1, dur: 1, pitch: 120, vel: 90 }];
    addTrack('Beat', 'drums').notes = [{ id: 3, start: 0, dur: 0.25, pitch: 36, vel: 90 }];
    project.transpose = 2;
    expect([...wantedPianoNotes()].sort((a, b) => a - b)).toEqual([62, 108]); // transposed; clamped to C8; drums ignored
    const res = await ensurePianoSamples([30, 31]); // fetch is blocked in tests
    expect(res).toEqual({ ok: 0, failed: 2 });
    expect(pianoSamples.failed).toBe(true);
    project.transpose = 0;
  });
});

describe('loudness (regression: recorded piano was near-silent)', () => {
  it('recordings are normalised to a standard peak before velocity is applied', async () => {
    const { normalizeGain, SAMPLE_PEAK } = await import('../src/audio/gmSamples.js');
    const quiet = { numberOfChannels: 2, getChannelData: (c) => Float32Array.from([0, 0.05, c ? -0.089 : 0.02]) };
    expect(normalizeGain(quiet)).toBeCloseTo(SAMPLE_PEAK / 0.089, 4); // the real C4 file peaks at ~0.089
    expect(normalizeGain({ numberOfChannels: 1, getChannelData: () => new Float32Array(4) })).toBe(1); // silence: no blow-up
  });

  it('a velocity-100 recorded note peaks at roughly the level of the synth instruments', async () => {
    const { normalizeGain } = await import('../src/audio/gmSamples.js');
    const buf = await preload(65, { ...fakeBuffer(0), numberOfChannels: 1, getChannelData: () => { const d = new Float32Array(1000); d.fill(0.089, 10); return d; } });
    setPianoSamples(true);
    const { ctx } = run((out) => playPiano(out, 65, 0, 1, 100));
    const amp = ctx.nodes.find((n) => n.kind === 'gain' && n.gain.events[0]?.[0] === 'setValueAtTime' && n.gain.events.length === 3);
    const outputPeak = amp.gain.events[0][1] * 0.089; // gain × the file's own peak
    expect(outputPeak).toBeGreaterThan(0.25);
    expect(outputPeak).toBeLessThan(0.45);
    expect(normalizeGain(buf)).toBeGreaterThan(5);
  });

  it('▶ Hear previews are normalised too', async () => {
    const { playSample, normalizeGain } = await import('../src/audio/gmSamples.js');
    const buf = { duration: 1, numberOfChannels: 1, getChannelData: () => Float32Array.from([0.1, -0.1]) };
    const { ctx } = run((out) => playSample(out, buf, 0, 0.5, 127));
    const g = ctx.nodes.find((n) => n.kind === 'gain' && n.gain.events.length);
    expect(g.gain.events[0][1] * 0.1).toBeCloseTo(0.35 * 0.9, 4);
    expect(normalizeGain(buf)).toBeCloseTo(9, 4);
  });
});
