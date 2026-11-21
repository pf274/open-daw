import { describe, it, expect, vi, beforeEach } from 'vitest';
import { biquadCoefficients, magnitudeDb, chainDb, widthToQ, logFrequencies, GRAPH_RANGE } from '../src/core/filterResponse.js';
import {
  normalizePatch, normalizeFilter, makeFilter, filterSpec, filterAtEnvelope, patchToSpec, presetPatch, MAX_FILTERS,
} from '../src/audio/customSynth.js';
import { withContext } from '../src/audio/context.js';
import { playVoice } from '../src/audio/synth.js';
import { fakeCtx } from './helpers/fake-audio.js';

vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));
const { resetProject, curTrack } = await import('../src/stores/project.js');
const { ui } = await import('../src/stores/ui.js');
const { undo, clearHistory } = await import('../src/stores/history.js');
const { setInstrument, openSynthEditor, addFilter, removeFilter, canAddFilter, applySynth, closeSynthEditor } = await import('../src/engine/synthEditor.js');

const db = (type, freq, q, gain, at) => magnitudeDb(biquadCoefficients(type, freq, q, gain), at);

describe('biquad response (Web Audio formulas)', () => {
  it('low-pass: flat below, rolls off above, resonance (dB) peaks at the cutoff', () => {
    expect(db('lowpass', 1000, 0, 0, 50)).toBeCloseTo(0, 1);
    expect(db('lowpass', 1000, 0, 0, 1000)).toBeCloseTo(0, 1); // Q 0 dB → |H(f0)| = 1
    expect(db('lowpass', 1000, 6, 0, 1000)).toBeCloseTo(6, 0); // resonance shows up as a peak
    expect(db('lowpass', 1000, 0, 0, 10000)).toBeLessThan(-35); // ~12 dB/oct
  });
  it('high-pass mirrors low-pass', () => {
    expect(db('highpass', 1000, 0, 0, 20000)).toBeCloseTo(0, 1);
    expect(db('highpass', 1000, 0, 0, 100)).toBeLessThan(-35);
  });
  it('frequency amplifier (peaking): +gain at the centre, soft curve, flat far away', () => {
    const q = widthToQ(1);
    expect(db('peaking', 1000, q, 9, 1000)).toBeCloseTo(9, 3);
    expect(db('peaking', 1000, q, 9, 20)).toBeCloseTo(0, 1);
    const oneOctUp = db('peaking', 1000, q, 9, 2000);
    expect(oneOctUp).toBeGreaterThan(0.5);
    expect(oneOctUp).toBeLessThan(9);
    expect(db('peaking', 1000, widthToQ(3), 9, 2000)).toBeGreaterThan(oneOctUp); // wider → more boost off-centre
  });
  it('band-pass passes the centre; notch removes it', () => {
    expect(db('bandpass', 1000, 2, 0, 1000)).toBeCloseTo(0, 3);
    expect(db('bandpass', 1000, 2, 0, 100)).toBeLessThan(-15);
    expect(db('notch', 1000, 2, 0, 1000)).toBeLessThan(-60);
    expect(db('notch', 1000, 2, 0, 100)).toBeCloseTo(0, 0);
  });
  it('chains add in dB; log frequencies span the graph', () => {
    const a = { type: 'peaking', freq: 500, q: 1, gain: 6 }, b = { type: 'peaking', freq: 500, q: 1, gain: 3 };
    expect(chainDb([a, b], 500)).toBeCloseTo(9, 3);
    const fs = logFrequencies(5);
    expect(fs[0]).toBeCloseTo(GRAPH_RANGE.fMin, 9);
    expect(fs[4]).toBeCloseTo(GRAPH_RANGE.fMax, 6);
    expect(fs[2]).toBeCloseTo(Math.sqrt(GRAPH_RANGE.fMin * GRAPH_RANGE.fMax), 6);
    expect(widthToQ(1)).toBeCloseTo(Math.SQRT2, 9);
  });
});

describe('filter chain in patches', () => {
  it('migrates old single-filter patches', () => {
    expect(normalizePatch({ filterType: 'highpass', cutoff: 500, resonance: 2 }).filters[0]).toMatchObject({ type: 'highpass', freq: 500, resonance: 2 });
    expect(normalizePatch({ filterType: 'off' }).filters).toEqual([]);
    expect(normalizePatch({ filterType: 'bandpass', cutoff: 1800 }).filters[0]).toMatchObject({ type: 'bandpass', freq: 1800, width: 1 });
    const p = normalizePatch({ filterType: 'lowpass', cutoff: 900 });
    expect(p).not.toHaveProperty('filterType');
    expect(p).not.toHaveProperty('cutoff');
  });

  it('caps the chain, keeps ids, and new filters never reuse a loaded id', () => {
    const p = normalizePatch({ filters: Array.from({ length: 9 }, () => ({ type: 'notch' })) });
    expect(p.filters).toHaveLength(MAX_FILTERS);
    const loaded = normalizeFilter({ id: 5000, type: 'amplifier' });
    expect(loaded.id).toBe(5000);
    expect(makeFilter('lowpass').id).toBeGreaterThan(5000);
  });

  it('only the amplifier can fade its boost; everyone can sweep', () => {
    expect(normalizeFilter({ type: 'amplifier', env: { mode: 'gain' } }).env.mode).toBe('gain');
    expect(normalizeFilter({ type: 'bandpass', env: { mode: 'gain' } }).env.mode).toBe('off');
    expect(normalizeFilter({ type: 'bandpass', env: { mode: 'freq' } }).env.mode).toBe('freq');
  });

  it('builds node specs (disabled filters skipped) and envelope snapshots for the graph', () => {
    const spec = patchToSpec({ filters: [
      { type: 'amplifier', freq: 800, width: 1, gain: 12, env: { mode: 'gain' } },
      { type: 'lowpass', freq: 1000, resonance: 2, enabled: false },
      { type: 'notch', freq: 3000, width: 2, env: { mode: 'freq', amount: -1 } },
    ] });
    expect(spec.filters.map((f) => f.type)).toEqual(['peaking', 'notch']);
    expect(spec.filters[0]).toMatchObject({ freq: 800, gain: 12, q: widthToQ(1) });
    expect(filterAtEnvelope(spec.filters[0], 0.5).gain).toBe(6);
    expect(filterAtEnvelope(spec.filters[1], 1).freq).toBe(1500);
    const plain = filterSpec(normalizeFilter({ type: 'lowpass', freq: 400 }));
    expect(filterAtEnvelope(plain, 1)).toBe(plain);
  });

  it('presets with envelopes and amplifiers are valid', () => {
    const swell = presetPatch('Swell brass');
    expect(swell.filters.map((f) => [f.type, f.env.mode])).toEqual([['lowpass', 'freq'], ['amplifier', 'gain']]);
    expect(presetPatch('Glass').filters).toEqual([]);
  });
});

describe('playVoice filter chain', () => {
  const run = (filters, dur = 1) => {
    const ctx = fakeCtx(), out = ctx.createGain();
    withContext(ctx, out, () => playVoice(out, patchToSpec({ attack: 0.01, filters }), 60, 1, dur, 100));
    return { ctx, out, nodes: ctx.nodes.filter((n) => n.kind === 'filter') };
  };

  it('connects filters in series into the destination', () => {
    const { out, nodes } = run([{ type: 'highpass', freq: 200 }, { type: 'amplifier', freq: 1000, gain: 6 }, { type: 'lowpass', freq: 5000 }]);
    expect(nodes.map((n) => n.type)).toEqual(['highpass', 'peaking', 'lowpass']);
    expect(nodes[0].out).toContain(nodes[1]);
    expect(nodes[1].out).toContain(nodes[2]);
    expect(nodes[2].out).toContain(out);
    expect(nodes[1].gain.value).toBe(6);
  });

  it('sweeps frequency: attack to peak, decay to sustain, release back at note-off', () => {
    const { nodes } = run([{ type: 'lowpass', freq: 500, env: { mode: 'freq', amount: 2, attack: 0.1, decay: 0.3, sustain: 0.5, release: 0.6 } }], 1);
    const ev = nodes[0].frequency.events;
    expect(ev[0]).toEqual(['setValueAtTime', 500, 1]);
    expect(ev[1][0]).toBe('exponentialRampToValueAtTime');
    expect(ev[1][1]).toBeCloseTo(2000, 6); // +2 octaves
    expect(ev[1][2]).toBeCloseTo(1.1, 9);
    expect(ev[2][1]).toBeCloseTo(1000, 6); // sustain 50% of the sweep = +1 octave
    expect(ev[3][0]).toBe('setTargetAtTime');
    expect(ev[3][1]).toBe(500); // back to the base…
    expect(ev[3][2]).toBe(2); // …at note-off (1 + 1 s)…
    expect(ev[3][3]).toBeCloseTo(0.2, 9); // …with a time-constant of release / 3
  });

  it('fades an amplifier’s boost in and out', () => {
    const { nodes } = run([{ type: 'amplifier', freq: 1000, gain: 12, env: { mode: 'gain', attack: 0.2, sustain: 0.25 } }]);
    const ev = nodes[0].gain.events;
    expect(ev[0]).toEqual(['setValueAtTime', 0, 1]);
    expect(ev[1]).toEqual(['linearRampToValueAtTime', 12, 1.2]);
    expect(ev[2][1]).toBe(3);
    expect(ev[3][1]).toBe(0);
  });

  it('a note shorter than the attack still releases after the peak', () => {
    const { nodes } = run([{ type: 'lowpass', freq: 500, env: { mode: 'freq', attack: 0.5 } }], 0.1);
    const release = nodes[0].frequency.events.at(-1);
    expect(release[2]).toBeGreaterThan(1.5);
  });
});

describe('editor actions', () => {
  beforeEach(() => { resetProject(); clearHistory(); ui.synthModal.open = false; });

  it('add/remove edit only the working copy until Apply; max 6; undoable', () => {
    const t = curTrack();
    setInstrument(t, 'custom');
    openSynthEditor(t.id);
    const amp = addFilter('amplifier');
    expect(amp).toMatchObject({ type: 'amplifier', gain: 9, width: 1 });
    expect(t.synth.filters).toHaveLength(1); // layer untouched
    while (canAddFilter()) addFilter('notch');
    expect(ui.synthModal.patch.filters).toHaveLength(6);
    expect(addFilter('notch')).toBeNull();
    removeFilter(amp.id);
    expect(ui.synthModal.patch.filters).toHaveLength(5);
    ui.synthModal.patch.filters[0].freq = 777;
    expect(t.synth.filters[0].freq).toBe(3000); // working copy is independent
    applySynth();
    closeSynthEditor();
    expect(curTrack().synth.filters).toHaveLength(5);
    undo();
    expect(curTrack().synth.filters).toHaveLength(1);
  });
});

describe('character presets', () => {
  const specs = (name) => patchToSpec(presetPatch(name)).filters;

  it('Cat meow: low-pass and amplifier both snap open, then sweep downward together', async () => {
    const { filterAtTime } = await import('../src/audio/customSynth.js');
    const [lp, amp] = specs('Cat meow');
    expect([lp.type, amp.type]).toEqual(['lowpass', 'peaking']);
    const at = (s, t) => filterAtTime(s, t, 2).freq; // a 2 s held note
    expect(at(lp, 0)).toBe(300); // closed "mm"
    expect(at(lp, 0.06)).toBeCloseTo(2400, 0); // open "ah" (+3 oct)
    expect(at(amp, 0.06)).toBeCloseTo(520 * 2 ** 1.3, 0); // vowel peak ~1.28 kHz
    for (const s of [lp, amp]) { // strictly falling after the peak ("…owww")
      const curve = [0.06, 0.15, 0.3, 0.6, 1.2].map((t) => at(s, t));
      for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeLessThan(curve[i - 1]);
    }
    expect(at(lp, 1.9)).toBeLessThan(330); // settles back near 300 Hz while held
    expect(at(amp, 1.9)).toBeLessThan(560);
  });

  it('Choir ah: the response peaks at the "ah" formants (~700, 1220, 2600 Hz)', () => {
    const chain = specs('Choir ah');
    const isPeak = (f) => chainDb(chain, f) > chainDb(chain, f * 0.85) && chainDb(chain, f) > chainDb(chain, f / 0.85);
    for (const f of [700, 1220, 2600]) expect(isPeak(f)).toBe(true);
  });

  it('Acid bass is a fast, resonant low-pass sweep', () => {
    const [lp] = specs('Acid bass');
    expect(lp.q).toBeGreaterThanOrEqual(12);
    expect(lp.env).toMatchObject({ mode: 'freq', attack: 0.005, sustain: 0 });
  });
});
