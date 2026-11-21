import { describe, it, expect, vi, beforeEach } from 'vitest';
import { impulseData, normalizeReverb, createReverb, wetFor, DEFAULT_REVERB } from '../src/audio/reverb.js';
import { withContext } from '../src/audio/context.js';
import { busFor, silenceAll } from '../src/audio/mixer.js';
import { normalizePatch, presetPatch } from '../src/audio/customSynth.js';
import { reverbFor } from '../src/audio/instruments.js';
import { writeMidi } from '../src/core/midi.js';
import { fakeCtx } from './helpers/fake-audio.js';
import { parseMidi } from './helpers/midi-parse.js';

vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));
const P = await import('../src/stores/project.js');
const { project, resetProject, curPattern, serialize, loadProjectData } = P;
const { clearHistory, undo } = await import('../src/stores/history.js');
const A = await import('../src/engine/automation.js');
const { buildSong, renderLength } = await import('../src/engine/files.js');

const energy = (d, from, to) => { let e = 0; for (let i = from; i < to; i++) e += d[i] * d[i]; return e; };
const roughness = (d) => { let r = 0, a = 0; for (let i = 1; i < d.length; i++) { r += Math.abs(d[i] - d[i - 1]); a += Math.abs(d[i]); } return r / a; };

describe('impulse response', () => {
  it('lasts `decay` seconds, decays, is stereo, and is identical every time', () => {
    const [l, r] = impulseData(8000, 2, 0.5);
    expect(l.length).toBe(16000);
    expect(energy(l, 0, 1600)).toBeGreaterThan(energy(l, 14400, 16000) * 1000); // ≈ −60 dB by the end
    expect(l).not.toEqual(r); // decorrelated channels = width
    expect(impulseData(8000, 2, 0.5)[0]).toEqual(l);
  });
  it('dark tone is smoother (less high frequency) than bright; loudness stays similar', () => {
    const [dark] = impulseData(8000, 1, 0), [bright] = impulseData(8000, 1, 1);
    expect(roughness(dark)).toBeLessThan(roughness(bright) / 3);
    const e = (d) => energy(d, 0, d.length);
    expect(e(dark) / e(bright)).toBeGreaterThan(0.8);
    expect(e(dark) / e(bright)).toBeLessThan(1.25);
  });
  it('settings are clamped', () => {
    expect(normalizeReverb({ amount: 3, decay: 0, tone: -1, preDelay: 1 })).toEqual({ amount: 1, decay: 0.2, tone: 0, preDelay: 0.15 });
    expect(normalizeReverb()).toEqual(DEFAULT_REVERB);
  });
});

describe('reverb unit', () => {
  it('passes the dry signal and adds a pre-delayed wet path; reuses impulses until the room changes', () => {
    const ctx = fakeCtx();
    const r = createReverb(ctx, { amount: 0.5, decay: 1.5, tone: 0.3, preDelay: 0.04 });
    expect(r.input.out).toContain(r.output); // dry
    const delay = r.input.out.find((n) => n.kind === 'delay');
    const conv = delay.out[0];
    expect(conv.kind).toBe('convolver');
    expect(conv.out[0].out).toContain(r.output);
    expect(r.wet.value).toBeCloseTo(wetFor(0.5), 9);
    expect(delay.delayTime.value).toBe(0.04);
    expect(conv.buffer.length).toBe(Math.round(48000 * 1.5));
    const first = conv.buffer;
    r.update({ amount: 0.9, decay: 1.5, tone: 0.3, preDelay: 0.01 });
    expect(conv.buffer).toBe(first); // same room → same impulse
    r.update({ amount: 0.9, decay: 3, tone: 0.3 });
    expect(conv.buffer).not.toBe(first);
  });

  it('layer buses insert a chain only when there is one, and update it in place', () => {
    const ctx = fakeCtx(), master = ctx.createGain();
    withContext(ctx, master, () => {
      const plain = busFor(1, 0.7);
      expect(plain.out).toEqual([master]);
      const wet = busFor(1, 0.7, { effects: [], reverb: { amount: 0.4, decay: 2, tone: 0.5, preDelay: 0.02 } });
      expect(wet).toBe(plain);
      const input = wet.out.at(-1);
      expect(input.out.some((n) => n === master)).toBe(false); // goes through the reverb now
      busFor(1, 0.7, { effects: [], reverb: { amount: 0.8, decay: 2, tone: 0.5, preDelay: 0.02 } });
      const wetGain = ctx.nodes.filter((n) => n.kind === 'convolver').at(-1).out[0];
      expect(wetGain.gain.value).toBeCloseTo(wetFor(0.8), 9);
      busFor(1, 0.7, null);
      expect(plain.out.at(-1)).toBe(master); // removed again
      silenceAll();
    });
  });
});

describe('custom synth reverb', () => {
  it('patches carry reverb settings (off by default); some presets use it', () => {
    expect(normalizePatch().reverb).toEqual(DEFAULT_REVERB);
    expect(presetPatch('Choir ah').reverb.amount).toBeGreaterThan(0);
    expect(presetPatch('Acid bass').reverb.amount).toBe(0);
  });
  it('only custom layers with the amount above 0 get a reverb; MIDI gets CC91', () => {
    expect(reverbFor({ inst: 'piano' })).toBeNull();
    expect(reverbFor({ inst: 'custom', synth: {} })).toBeNull();
    expect(reverbFor({ inst: 'custom', synth: { reverb: { amount: 0.5 } } })).toMatchObject({ amount: 0.5 });
    const m = parseMidi(writeMidi({ bpm: 120, tracks: [{ name: 'x', program: 0, reverb: 0.5, notes: [{ start: 0, dur: 1, pitch: 60, vel: 90 }] }] }));
    expect(m.tracks[1].some((e) => (e.status & 0xf0) === 0xb0 && e.d1 === 91 && e.d2 === 64)).toBe(true);
  });
});

describe('song: synth reverb and Reverb automation', () => {
  beforeEach(() => { resetProject(); clearHistory(); });

  it('a custom layer’s reverb comes before the song track’s automation chain', () => {
    const layer = curPattern().layers[0];
    layer.inst = 'custom';
    layer.synth = normalizePatch({ reverb: { amount: 0.6 } });
    const [t1] = project.song.tracks;
    A.addAutomation('lowpass');
    const ctx = fakeCtx(), master = ctx.createGain();
    const g = A.buildSongGraph(ctx, master, { fromBeat: 0, endBeat: 8, at: (b) => b });
    const dest = g.destFor(t1, layer);
    const revIn = dest.out[0];
    expect(revIn.out.some((n) => n.kind === 'delay')).toBe(true); // into the reverb…
    const revOut = revIn.out.find((n) => n.kind === 'gain');
    const filter = revOut.out[0].out[0];
    expect(filter.type).toBe('lowpass'); // …then the track's automation
  });

  it('Reverb automation: room options per track, the curve drives the wet level', () => {
    const a = A.addAutomation('reverb');
    expect(a.options).toEqual({ decay: DEFAULT_REVERB.decay, tone: DEFAULT_REVERB.tone, preDelay: DEFAULT_REVERB.preDelay });
    a.options.decay = 5;
    A.addPoint(a, 0, 0);
    A.addPoint(a, 8, 1);
    const ctx = fakeCtx(), master = ctx.createGain();
    const g = A.buildSongGraph(ctx, master, { fromBeat: 0, endBeat: 8, at: (b) => b * 0.5 });
    g.destFor(project.song.tracks[0], curPattern().layers[0]);
    const conv = ctx.nodes.find((n) => n.kind === 'convolver');
    expect(conv.buffer.length).toBe(48000 * 5); // the track's room size
    const wet = conv.out[0];
    const [, values] = wet.gain.events.find(([m]) => m === 'setValueCurveAtTime');
    expect(values[0]).toBeCloseTo(0, 6);
    expect(values.at(-1)).toBeCloseTo(wetFor(1), 6);
  });

  it('switching effects sets/clears options; options survive save/load and undo', () => {
    const a = A.addAutomation('volume');
    expect(a.options).toBeNull();
    A.setEffect(a, 'reverb');
    expect(a.options.decay).toBe(DEFAULT_REVERB.decay);
    a.options.tone = 0.9;
    const json = serialize();
    resetProject();
    loadProjectData(JSON.parse(json));
    expect(project.song.automation[0].options).toMatchObject({ tone: 0.9 });
    A.setEffect(project.song.automation[0], 'pan');
    expect(project.song.automation[0].options).toBeNull();
    undo();
    expect(project.song.automation[0].options).toMatchObject({ tone: 0.9 });
  });

  it('WAV export leaves room for the longest reverb tail', () => {
    const layer = curPattern().layers[0];
    layer.notes = [{ id: 1, start: 0, dur: 1, pitch: 60, vel: 90 }];
    const dry = renderLength('pattern');
    layer.inst = 'custom';
    layer.synth = normalizePatch({ reverb: { amount: 0.5, decay: 6 } });
    expect(renderLength('pattern') - dry).toBeCloseTo(6.3 - 2, 6);
    expect(buildSong('pattern').tracks[0].reverb).toBe(0.5);
  });
});
