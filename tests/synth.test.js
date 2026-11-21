import { describe, it, expect } from 'vitest';
import { withContext } from '../src/audio/context.js';
import { playVoice } from '../src/audio/synth.js';
import { midiToFreq } from '../src/core/pitch.js';
import { fakeCtx } from './helpers/fake-audio.js';

describe('playVoice', () => {
  it('drives oscillator detune from a tremor LFO whose depth/rate switch per segment', () => {
    const ctx = fakeCtx();
    const out = ctx.createGain();
    withContext(ctx, out, () => playVoice(out, 'whistle', 72, 1, 2, 100, {
      tremor: [{ from: 1, depth: 40, rate: 6 }, { from: 2, depth: 0, rate: 5.5 }],
    }));
    const oscs = ctx.nodes.filter((n) => n.kind === 'osc');
    // whistle: 1 built-in vibrato LFO + 1 tremor LFO + 1 partial
    expect(oscs).toHaveLength(3);
    const tremorDepth = ctx.nodes.find((n) => n.kind === 'gain' && n.gain.events.some(([, v]) => v === 40));
    expect(tremorDepth.gain.events.filter(([m]) => m === 'setValueAtTime').map(([, v, t]) => [v, t])).toEqual([[40, 1], [40, 1], [0, 2]]);
    const partial = oscs.find((o) => o.frequency.value === midiToFreq(72));
    expect(tremorDepth.out).toContain(partial.detune);
  });

  it('glides oscillator frequency between chain pitches', () => {
    const ctx = fakeCtx();
    const out = ctx.createGain();
    withContext(ctx, out, () => playVoice(out, 'flute', 60, 0, 2, 100, { glides: [{ from: 0.9, to: 1, midi: 67 }] }));
    const fundamental = ctx.nodes.find((n) => n.kind === 'osc' && n.frequency.value === midiToFreq(60));
    const ramp = fundamental.frequency.events.find(([m]) => m === 'exponentialRampToValueAtTime');
    expect(ramp[1]).toBeCloseTo(midiToFreq(67), 6);
    expect(ramp[2]).toBe(1);
  });

  it('plays without options exactly as before', () => {
    const ctx = fakeCtx();
    const out = ctx.createGain();
    expect(() => withContext(ctx, out, () => playVoice(out, 'organ', 60, 0, 1, 90))).not.toThrow();
    expect(ctx.nodes.filter((n) => n.kind === 'osc')).toHaveLength(4); // four partials, no LFOs
  });
});
