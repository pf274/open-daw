import { describe, it, expect, vi, beforeEach } from 'vitest';

// real URL/cache logic; fake audio + network
const { sampleUrl, loadSample, SAMPLE_RANGE } = await import('../src/audio/gmSamples.js');
const { withContext } = await import('../src/audio/context.js');
const { GM_SAMPLE_NAMES, GM_PROGRAMS } = await import('../src/core/gm.js');

describe('GM sample URLs', () => {
  it('maps program + pitch to the FluidR3 file (flats, 1-based programs)', () => {
    expect(sampleUrl(1, 60)).toBe('https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/C4.mp3');
    expect(sampleUrl(82, 63)).toMatch(/lead_2_sawtooth-mp3\/Eb4\.mp3$/);
    expect(sampleUrl(88, 70)).toMatch(/lead_8_bass__lead-mp3\/Bb4\.mp3$/);
  });
  it('clamps to the notes the set provides', () => {
    expect(sampleUrl(1, 5)).toMatch(/\/A0\.mp3$/);
    expect(sampleUrl(1, 127)).toMatch(/\/C8\.mp3$/);
    expect(SAMPLE_RANGE).toEqual([21, 108]);
  });
  it('has a sample name for every GM program', () => {
    expect(GM_SAMPLE_NAMES).toHaveLength(GM_PROGRAMS.length);
    expect(() => sampleUrl(129, 60)).toThrow();
  });
});

describe('sample loading', () => {
  const ctx = { decodeAudioData: vi.fn(async () => ({ duration: 2 })) };
  const ok = () => vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));

  it('caches decoded samples per URL', async () => {
    const fetchImpl = ok();
    const a = await withContext(ctx, null, () => loadSample(5, 64, fetchImpl));
    const b = await withContext(ctx, null, () => loadSample(5, 64, fetchImpl));
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures, so a retry can succeed', async () => {
    const fail = vi.fn(async () => ({ ok: false, status: 404 }));
    await expect(withContext(ctx, null, () => loadSample(6, 64, fail))).rejects.toThrow('HTTP 404');
    const fetchImpl = ok();
    await expect(withContext(ctx, null, () => loadSample(6, 64, fetchImpl))).resolves.toEqual({ duration: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('previewGmProgram', () => {
  const played = [];
  let failLoad = false;
  beforeEach(() => { played.length = 0; failLoad = false; vi.resetModules(); });

  async function setup() {
    vi.doMock('../src/audio/gmSamples.js', () => ({
      loadSample: vi.fn(async (program, midi) => { if (failLoad) throw new Error('offline'); return { program, midi }; }),
      playSample: (dest, buf, when, dur, vel) => played.push({ dest, buf, when, dur, vel }),
    }));
    vi.doMock('../src/audio/mixer.js', () => ({ busFor: (id, gain) => ({ id, gain }), silenceAll: vi.fn() }));
    vi.doMock('../src/audio/context.js', () => ({ ensureAudio: () => ({ currentTime: 3 }), getCtx: () => ({}) }));
    vi.doMock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));
    const { previewGmProgram } = await import('../src/engine/preview.js');
    const { project } = await import('../src/stores/project.js');
    project.bpm = 120;
    return { previewGmProgram, project };
  }
  const tr = { id: 7, inst: 'custom', vol: 0.6, synth: {} };
  const notes = [{ start: 2, dur: 1, pitch: 60, vel: 100 }, { start: 3, dur: 0.5, pitch: 64, vel: 80 }];

  it('loads, then plays the notes with that program, transposed and timed from now', async () => {
    const { previewGmProgram, project } = await setup();
    project.transpose = 2;
    const secs = await previewGmProgram(tr, 82, notes);
    expect(played.map((x) => x.buf)).toEqual([{ program: 82, midi: 62 }, { program: 82, midi: 66 }]);
    expect(played.map((x) => x.when)).toEqual([3.05, 3.55]);
    expect(played[1].dur).toBe(0.25);
    expect(played[0].dest).toEqual({ id: 7, gain: 0.6 });
    expect(secs).toBeCloseTo(1.15, 9);
    project.transpose = 0;
  });

  it('does not play if cancelled while loading', async () => {
    const { previewGmProgram } = await setup();
    const ctrl = new AbortController();
    const p = previewGmProgram(tr, 1, notes, { signal: ctrl.signal });
    ctrl.abort();
    await p;
    expect(played).toHaveLength(0);
  });

  it('rejects when samples cannot be loaded', async () => {
    const { previewGmProgram } = await setup();
    failLoad = true;
    await expect(previewGmProgram(tr, 1, notes)).rejects.toThrow('offline');
    expect(played).toHaveLength(0);
  });
});
