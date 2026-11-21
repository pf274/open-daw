/**
 * Convolution reverb with a generated impulse response (no downloads): decaying stereo noise,
 * low-pass damped by `tone`, reaching −60 dB after `decay` seconds.
 *
 * The unit is send-style:   input ─┬─────────────────────────────▶ output   (dry, unchanged)
 *                                  └▶ pre-delay ▶ convolver ▶ wet ▶ output   (wet = amount)
 * Used per layer by the custom synth, and on song tracks by Reverb automation (which drives `wet`).
 */
import { clamp } from '../core/music.js';

export const REVERB_LIMITS = { amount: [0, 1], decay: [0.2, 8], tone: [0, 1], preDelay: [0, 0.15] };
export const DEFAULT_REVERB = { amount: 0, decay: 2.2, tone: 0.5, preDelay: 0.02 };
const WET_GAIN = 0.8; // amount 1 → wet at 0.8: a big, but not overwhelming, reverb

export function normalizeReverb(r = {}) {
  const out = { ...DEFAULT_REVERB };
  for (const k of Object.keys(REVERB_LIMITS)) {
    const v = Number(r?.[k]);
    out[k] = clamp(Number.isFinite(v) ? v : DEFAULT_REVERB[k], ...REVERB_LIMITS[k]);
  }
  return out;
}

/** Small deterministic PRNG, so an impulse (and every render) is identical each time. */
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Impulse response samples [left, right]. Decays exponentially to −60 dB at `decay`;
 * `tone` 0 = dark (heavy damping) … 1 = bright. Pure — exported for tests.
 */
export function impulseData(sampleRate, decay, tone) {
  const len = Math.max(1, Math.round(sampleRate * decay));
  const k = 0.04 + 0.9 * tone * tone; // one-pole low-pass coefficient: lower = darker
  return [1, 2].map((seed) => {
    const rnd = mulberry32(seed * 7919), d = new Float32Array(len);
    let y = 0;
    for (let i = 0; i < len; i++) {
      y += k * (rnd() * 2 - 1 - y);
      d[i] = y * Math.exp((-6.9 * i) / len); // e^−6.9 ≈ −60 dB at the end
    }
    // normalise energy so decay/tone change the character, not the loudness
    let e = 0;
    for (let i = 0; i < len; i++) e += d[i] * d[i];
    const g = 1 / Math.sqrt(e / sampleRate + 1e-12) * 0.35;
    for (let i = 0; i < len; i++) d[i] *= g;
    return d;
  });
}

const impulses = new Map(); // `${sampleRate}:${decay}:${tone}` → AudioBuffer (buffers work in any context)
function impulse(ctx, decay, tone) {
  const key = `${ctx.sampleRate}:${decay.toFixed(2)}:${tone.toFixed(2)}`;
  if (!impulses.has(key)) {
    const data = impulseData(ctx.sampleRate, decay, tone);
    const buf = ctx.createBuffer(2, data[0].length, ctx.sampleRate);
    data.forEach((d, c) => buf.getChannelData(c).set(d));
    impulses.set(key, buf);
  }
  return impulses.get(key);
}

/** A reverb unit: { input, output, wet (AudioParam), update(settings) }. */
export function createReverb(ctx, settings = {}) {
  const input = ctx.createGain(), output = ctx.createGain();
  const delay = ctx.createDelay(REVERB_LIMITS.preDelay[1] + 0.01);
  const conv = ctx.createConvolver();
  const wet = ctx.createGain();
  input.connect(output); // dry
  input.connect(delay); delay.connect(conv); conv.connect(wet); wet.connect(output);
  let shape = '';
  const unit = {
    input, output, wet: wet.gain,
    settings: null,
    update(s) {
      const r = normalizeReverb(s);
      unit.settings = r;
      wet.gain.value = r.amount * WET_GAIN;
      delay.delayTime.value = r.preDelay;
      const next = `${r.decay.toFixed(2)}:${r.tone.toFixed(2)}`;
      if (next !== shape) { conv.buffer = impulse(ctx, r.decay, r.tone); shape = next; }
    },
  };
  unit.update(settings);
  return unit;
}

/** Wet level for an `amount` (for automation, which drives the wet gain directly). */
export const wetFor = (amount) => amount * WET_GAIN;
