import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterAtTime, filterSpec, normalizeFilter, patchToSpec } from '../src/audio/customSynth.js';
import { voiceSpans } from '../src/core/slides.js';
import { withContext } from '../src/audio/context.js';
import { playVoice } from '../src/audio/synth.js';
import { fakeCtx } from './helpers/fake-audio.js';

const sweep = (env) => filterSpec(normalizeFilter({ type: 'lowpass', freq: 500, env: { mode: 'freq', amount: 2, attack: 0.1, decay: 0.3, sustain: 0.5, release: 0.6, ...env } }));
const fade = (env) => filterSpec(normalizeFilter({ type: 'amplifier', freq: 1000, gain: 12, env: { mode: 'gain', attack: 0.2, decay: 0.3, sustain: 0.25, release: 0.4, ...env } }));

describe('filterAtTime mirrors the scheduled envelope', () => {
  it('frequency sweep: base → exponential attack → decay to sustain → release to base', () => {
    const s = sweep(), off = 2;
    expect(filterAtTime(s, 0, off).freq).toBe(500);
    expect(filterAtTime(s, 0.05, off).freq).toBeCloseTo(1000, 6); // halfway up an exponential ramp = geometric mean
    expect(filterAtTime(s, 0.1, off).freq).toBeCloseTo(2000, 6); // peak (+2 oct)
    expect(filterAtTime(s, 1.9, off).freq).toBeCloseTo(1000, 0); // settled at sustain (+1 oct)
    const atRelease = filterAtTime(s, 2, off).freq;
    expect(filterAtTime(s, 2.0001, off).freq).toBeCloseTo(atRelease, 0); // continuous at note-off
    expect(filterAtTime(s, 6, off).freq).toBeCloseTo(500, 1); // back to base
  });

  it('fade boost: linear rise, settle, fade to 0', () => {
    const s = fade(), off = 2;
    expect(filterAtTime(s, 0, off).gain).toBe(0);
    expect(filterAtTime(s, 0.1, off).gain).toBeCloseTo(6, 9);
    expect(filterAtTime(s, 0.2, off).gain).toBeCloseTo(12, 9);
    expect(filterAtTime(s, 1.9, off).gain).toBeCloseTo(3, 1);
    expect(filterAtTime(s, 5, off).gain).toBeCloseTo(0, 2);
  });

  it('a note shorter than the attack still reaches the peak before releasing', () => {
    const s = sweep({ attack: 0.5 });
    expect(filterAtTime(s, 0.5, 0.1).freq).toBeCloseTo(2000, 6);
  });

  it('filters without an envelope never move', () => {
    const still = filterSpec(normalizeFilter({ type: 'notch', freq: 800 }));
    expect(filterAtTime(still, 1, 2)).toBe(still);
  });

  it('agrees with the automation playVoice schedules (peak, sustain target, release target)', () => {
    const ctx = fakeCtx(), out = ctx.createGain();
    const spec = patchToSpec({ attack: 0.01, filters: [{ type: 'lowpass', freq: 500, env: { mode: 'freq', amount: 2, attack: 0.1, decay: 0.3, sustain: 0.5, release: 0.6 } }] });
    withContext(ctx, out, () => playVoice(out, spec, 60, 0, 2, 100));
    const ev = ctx.nodes.find((n) => n.kind === 'filter').frequency.events;
    const s = spec.filters[0], off = 2;
    expect(filterAtTime(s, 0, off).freq).toBeCloseTo(ev[0][1], 6); // start value
    expect(filterAtTime(s, ev[1][2], off).freq).toBeCloseTo(ev[1][1], 6); // ramp end value at its time
    expect(filterAtTime(s, 1.99, off).freq).toBeCloseTo(ev[2][1], 3); // late in the decay (18 time-constants) → sustain target
    expect(filterAtTime(s, off + 50 * 0.2, off).freq).toBeCloseTo(ev[3][1], 3); // long after release → release target
  });
});

describe('voiceSpans', () => {
  it('counts a slide chain as one voice', () => {
    const notes = [
      { id: 1, start: 0, dur: 1, pitch: 60, slideTo: 2 }, { id: 2, start: 1, dur: 1, pitch: 62 },
      { id: 3, start: 3, dur: 0.5, pitch: 64 },
    ];
    expect(voiceSpans(notes)).toEqual([{ start: 0, end: 2 }, { start: 3, end: 3.5 }]);
  });
});

describe('previewClock', () => {
  beforeEach(() => vi.resetModules());
  async function setup() {
    vi.doMock('../src/audio/synth.js', () => ({ playVoice: vi.fn(), click: vi.fn() }));
    vi.doMock('../src/audio/mixer.js', () => ({ busFor: () => ({}), silenceAll: vi.fn() }));
    vi.doMock('../src/audio/context.js', () => ({ ensureAudio: () => ({ currentTime: 10 }), getCtx: () => ({}) }));
    vi.doMock('../src/audio/gmSamples.js', () => ({ loadSample: async () => ({}), playSample: vi.fn() }));
    vi.doMock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));
    const mod = await import('../src/engine/preview.js');
    (await import('../src/stores/project.js')).project.bpm = 120;
    return mod;
  }
  const notes = [{ id: 1, start: 2, dur: 1, pitch: 60, vel: 90, slideTo: 2 }, { id: 2, start: 3, dur: 1, pitch: 62, vel: 90 }];

  it('records the timing, voices and patch of a synth preview; stop clears it', async () => {
    const { previewNotes, stopPreview, previewClock } = await setup();
    const synth = { wave: 'square' };
    const secs = previewNotes({ id: 1, inst: 'custom', vol: 1, synth }, notes);
    expect(previewClock).toMatchObject({ active: true, t0: 10.05, first: 2, spb: 0.5, synth, voices: [{ start: 2, end: 4 }] });
    expect(previewClock.end).toBeCloseTo(10.05 + secs, 9);
    const id = previewClock.id;
    previewNotes({ id: 1, inst: 'piano', vol: 1 }, notes);
    expect(previewClock.id).toBe(id + 1);
    expect(previewClock.synth).toBeNull(); // built-in instrument: nothing to animate
    stopPreview();
    expect(previewClock.active).toBe(false);
  });

  it('a GM sample preview switches the animation off', async () => {
    const { previewNotes, previewGmProgram, previewClock } = await setup();
    previewNotes({ id: 1, inst: 'custom', vol: 1, synth: {} }, notes);
    await previewGmProgram({ id: 1, inst: 'custom', vol: 1 }, 1, notes);
    expect(previewClock.active).toBe(false);
  });
});
