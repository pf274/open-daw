import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FX, FX_TYPES, createFx, normalizeFxSettings, fxDefaults } from '../src/audio/fx.js';
import { createFxChain, fxSignature, fxTail } from '../src/audio/fxChain.js';
import { loadWorklets, workletReady } from '../src/audio/worklets.js';
import { AUTOMATION_EFFECTS } from '../src/audio/effects.js';
import { normalizePatch, presetPatch, PRESETS } from '../src/audio/customSynth.js';
import { fxFor } from '../src/audio/instruments.js';
import { withContext } from '../src/audio/context.js';
import { busFor, silenceAll } from '../src/audio/mixer.js';
import { writeMidi } from '../src/core/midi.js';
import { fakeCtx } from './helpers/fake-audio.js';
import { parseMidi } from './helpers/midi-parse.js';

const reach = (from, to, seen = new Set()) => { // is `to` downstream of `from`?
  if (from === to) return true;
  if (!from || seen.has(from)) return false;
  seen.add(from);
  return (from.out || []).some((n) => reach(n, to, seen));
};

describe('every effect', () => {
  it.each(FX_TYPES)('%s: builds, connects input → output, updates, exposes an automatable param, and stops its sources', (type) => {
    const ctx = fakeCtx();
    const u = createFx(ctx, type, {});
    expect(reach(u.input, u.output)).toBe(true);
    expect(u.autoParam).toBeTruthy();
    expect(typeof u.autoParam.setValueAtTime).toBe('function');
    u.update(fxDefaults(type));
    u.dispose();
    for (const n of ctx.nodes.filter((x) => x.kind === 'osc' || x.kind === 'constant')) expect(n.stopped).toBeTruthy();
  });
  it('settings are defaulted and clamped', () => {
    expect(normalizeFxSettings('echo', { time: 9, feedback: -1 })).toEqual({ time: 1.5, feedback: 0, tone: 0.6, mix: 0.35 });
    for (const t of FX_TYPES) expect(Object.keys(fxDefaults(t))).toEqual(Object.keys(FX[t].params));
  });
});

describe('effect details', () => {
  it('mix cross-fades with ONE param: wet = mix, dry = 1 − mix', () => {
    const ctx = fakeCtx();
    const u = createFx(ctx, 'chorus', { mix: 0.3 });
    const src = ctx.nodes.find((n) => n.kind === 'constant');
    expect(u.autoParam).toBe(src.offset);
    expect(src.offset.value).toBe(0.3);
    const [wetGainParam, inv] = src.out;
    const wet = ctx.nodes.find((n) => n.gain === wetGainParam);
    expect(wet.gain.value).toBe(0); // 0 + mix
    expect(inv.gain.value).toBe(-1);
    expect(inv.out[0].value).toBe(1); // inv feeds the dry gain's param: 1 + (−mix)
  });
  it('echo: a damped feedback loop; tail follows time and feedback', () => {
    const ctx = fakeCtx();
    createFx(ctx, 'echo', { time: 0.5, feedback: 0.5, tone: 0 });
    const delay = ctx.nodes.find((n) => n.kind === 'delay');
    expect(delay.delayTime.value).toBe(0.5);
    const damp = delay.out[0];
    expect(damp.type).toBe('lowpass');
    expect(damp.frequency.value).toBeCloseTo(800, 6);
    expect(reach(damp, delay)).toBe(true); // feedback loop
    expect(FX.echo.tail({ time: 0.5, feedback: 0.5 })).toBeCloseTo(0.5 * Math.log(0.001) / Math.log(0.5), 6);
  });
  it('distortion: drive is a pre-gain into a bounded, symmetric soft-clipper', () => {
    const ctx = fakeCtx();
    const u = createFx(ctx, 'distortion', { drive: 0.5 });
    expect(u.autoParam.value).toBe(16);
    expect(FX.distortion.autoMap(1)).toBe(31);
    const c = ctx.nodes.find((n) => n.kind === 'shaper').curve;
    expect(Math.max(...c)).toBeCloseTo(1, 6);
    expect(c[0]).toBeCloseTo(-c[c.length - 1], 6);
  });
  it('bitcrusher without the worklet: a staircase with 2^bits steps', () => {
    const ctx = fakeCtx();
    createFx(ctx, 'bitcrusher', { bits: 3 });
    expect(new Set(ctx.nodes.find((n) => n.kind === 'shaper').curve).size).toBe(9); // −4/4 … 4/4
  });
  it('wah: position drives a resonant band-pass (350 Hz–2.5 kHz); rate 0 = pedal only', () => {
    const ctx = fakeCtx();
    const u = createFx(ctx, 'wah', { position: 1, rate: 0, resonance: 12 });
    const bp = ctx.nodes.find((n) => n.kind === 'filter' && n.type === 'bandpass');
    expect(u.autoParam).toBe(bp.frequency);
    expect(bp.frequency.value).toBeCloseTo(2500, 6);
    expect(FX.wah.autoMap(0)).toBeCloseTo(350, 6);
    expect(bp.Q.value).toBe(12);
    const lfoDepth = ctx.nodes.find((n) => n.kind === 'osc').out[0];
    expect(lfoDepth.gain.value).toBe(0);
    u.update({ ...fxDefaults('wah'), rate: 3, depth: 0.5 });
    expect(lfoDepth.gain.value).toBe(1200); // ± one octave in cents
  });
  it('chorus: two modulated voices panned apart; phaser: four all-passes with feedback; tremolo: −depth', () => {
    const c1 = fakeCtx();
    createFx(c1, 'chorus', {});
    expect(c1.nodes.filter((n) => n.kind === 'panner').map((n) => n.pan.value).sort()).toEqual([-0.7, 0.7]);
    const c2 = fakeCtx();
    createFx(c2, 'phaser', {});
    const aps = c2.nodes.filter((n) => n.type === 'allpass');
    expect(aps).toHaveLength(4);
    expect(reach(aps[3], aps[0])).toBe(true);
    const c3 = fakeCtx();
    expect(createFx(c3, 'tremolo', { depth: 0.4 }).autoParam.value).toBe(-0.4);
  });
});

describe('bitcrusher worklet', () => {
  afterEach(() => { delete globalThis.AudioWorkletNode; });
  it('loads once from inline code, then the bitcrusher uses it with bits/downsample params', async () => {
    const ctx = fakeCtx();
    const addModule = vi.fn(async () => {});
    ctx.audioWorklet = { addModule };
    globalThis.URL.createObjectURL = () => 'blob:crusher';
    expect(await loadWorklets(ctx)).toBe(true);
    await loadWorklets(ctx);
    expect(addModule).toHaveBeenCalledTimes(1);
    expect(workletReady(ctx)).toBe(true);
    const params = new Map([['bits', { value: 0 }], ['downsample', { value: 0 }]]);
    globalThis.AudioWorkletNode = class { constructor(c, name, opts) { this.name = name; this.opts = opts; this.parameters = params; this.out = []; } connect(d) { this.out.push(d); } };
    createFx(ctx, 'bitcrusher', { bits: 4, downsample: 8 });
    expect(params.get('bits').value).toBe(4);
    expect(params.get('downsample').value).toBe(8);
  });
  it('without AudioWorklet support it reports false and effects fall back', async () => {
    expect(await loadWorklets(fakeCtx())).toBe(false);
  });
});

describe('chains', () => {
  it('run effects in order, then the reverb; rebuild only when the shape changes', () => {
    const fx = { effects: [{ type: 'distortion', drive: 0.2 }, { type: 'echo' }], reverb: { amount: 0.5, decay: 1 } };
    expect(fxSignature(fx)).toBe('distortion>echo>reverb');
    const ctx = fakeCtx(), master = ctx.createGain();
    withContext(ctx, master, () => {
      const bus = busFor(7, 1, fx);
      const shaper = ctx.nodes.find((n) => n.kind === 'shaper');
      const delay = ctx.nodes.find((n) => n.kind === 'delay' && n.delayTime.value === 0.35);
      const conv = ctx.nodes.find((n) => n.kind === 'convolver');
      expect(reach(bus, shaper) && reach(shaper, delay) && reach(delay, conv) && reach(conv, master)).toBe(true);
      const before = ctx.nodes.length;
      busFor(7, 1, { ...fx, effects: [{ type: 'distortion', drive: 0.9 }, { type: 'echo' }] }); // same shape: update
      expect(ctx.nodes.length).toBe(before);
      expect(ctx.nodes.find((n) => n.kind === 'gain' && n.gain.value === 28)).toBeTruthy(); // drive 0.9 → 1 + 27
      busFor(7, 1, { effects: [{ type: 'echo' }], reverb: null }); // new shape: rebuilt
      expect(ctx.nodes.length).toBeGreaterThan(before);
      silenceAll();
    });
    expect(fxTail(fx)).toBeCloseTo(FX.echo.tail(fxDefaults('echo')), 6);
  });
});

describe('patches', () => {
  it('keep an ordered, capped effects list with stable ids; only enabled effects play', () => {
    const p = normalizePatch({ effects: [{ type: 'echo', time: 0.2 }, { type: 'warp' }, { type: 'chorus', enabled: false }, ...Array(8).fill({ type: 'tremolo' })] });
    expect(p.effects).toHaveLength(6);
    expect(p.effects.map((e) => e.type).slice(0, 2)).toEqual(['echo', 'chorus']);
    expect(normalizePatch(p).effects.map((e) => e.id)).toEqual(p.effects.map((e) => e.id));
    expect(fxFor({ inst: 'custom', synth: p }).effects.map((e) => e.type)).not.toContain('chorus');
    expect(fxFor({ inst: 'custom', synth: {} })).toBeNull();
    expect(fxFor({ inst: 'piano' })).toBeNull();
  });
  it('new presets show the effects off', () => {
    expect(presetPatch('Funky wah').effects.map((e) => e.type)).toEqual(['wah', 'distortion']);
    expect(presetPatch('Dub stab').effects[0].type).toBe('echo');
    expect(presetPatch('Chiptune').effects[0]).toMatchObject({ type: 'bitcrusher', bits: 5 });
    for (const name of Object.keys(PRESETS)) { const p = presetPatch(name); expect(normalizePatch(p)).toEqual(p); }
  });
  it('MIDI carries chorus depth as CC93', () => {
    const m = parseMidi(writeMidi({ bpm: 120, tracks: [{ name: 'x', program: 0, chorus: 1, notes: [{ start: 0, dur: 1, pitch: 60, vel: 90 }] }] }));
    expect(m.tracks[1].some((e) => (e.status & 0xf0) === 0xb0 && e.d1 === 93 && e.d2 === 127)).toBe(true);
  });
});

describe('as automation effects', () => {
  it('every insert effect is offered, driving its main control; the rest become ⚙ options', () => {
    for (const t of FX_TYPES) expect(AUTOMATION_EFFECTS[t]).toBeTruthy();
    expect(AUTOMATION_EFFECTS.wah.label).toBe('Wah-wah — position');
    expect(Object.keys(AUTOMATION_EFFECTS.wah.options.params)).toEqual(['rate', 'depth', 'resonance', 'mix']);
    expect(AUTOMATION_EFFECTS.wah.options.defaults.rate).toBe(0); // a pedal you draw
    expect(AUTOMATION_EFFECTS.distortion.toParam(0.5)).toBe(16);
    expect(AUTOMATION_EFFECTS.tremolo.options.params).toHaveProperty('rate');
    expect(AUTOMATION_EFFECTS.echo.format(0.5)).toBe('50%');
  });
});
