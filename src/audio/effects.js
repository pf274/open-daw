/**
 * Effects that automation tracks can drive. Curve values are 0–1; each effect maps them to
 * one AudioParam. To add an effect, add an entry here.
 *   create(ctx, options) → { input, output, param }   (simple effects: one node is input and output)
 *   toParam(v) → param value      format(v) → label      default: curve value with no points
 *   options?: { defaults, normalize(o) }               extra per-track settings (e.g. reverb size)
 */
import { createReverb, normalizeReverb, wetFor, DEFAULT_REVERB, REVERB_LIMITS } from './reverb.js';
import { FX, createFx, normalizeFxSettings } from './fx.js';

const unit = (node, param) => ({ input: node, output: node, param });
const hz = (v) => 20 * 1000 ** v; // 20 Hz … 20 kHz, logarithmic
const fmtHz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);

export const AUTOMATION_EFFECTS = {
  volume: {
    label: 'Volume',
    default: 1,
    create: (ctx) => { const n = ctx.createGain(); return unit(n, n.gain); },
    toParam: (v) => v * v, // perceptual: half-way ≈ −12 dB
    format: (v) => (v <= 0.001 ? '−∞ dB' : `${(20 * Math.log10(v * v)).toFixed(1)} dB`),
  },
  pan: {
    label: 'Pan',
    default: 0.5,
    create: (ctx) => { const n = ctx.createStereoPanner(); return unit(n, n.pan); },
    toParam: (v) => v * 2 - 1,
    format: (v) => (Math.abs(v - 0.5) < 0.01 ? 'Centre' : v < 0.5 ? `L ${Math.round((0.5 - v) * 200)}%` : `R ${Math.round((v - 0.5) * 200)}%`),
  },
  lowpass: {
    label: 'Low-pass filter',
    default: 1,
    create: (ctx) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.7; return unit(f, f.frequency); },
    toParam: hz,
    format: (v) => fmtHz(hz(v)),
  },
  highpass: {
    label: 'High-pass filter',
    default: 0,
    create: (ctx) => { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.Q.value = 0.7; return unit(f, f.frequency); },
    toParam: hz,
    format: (v) => fmtHz(hz(v)),
  },
  reverb: {
    label: 'Reverb',
    default: 0,
    /** the curve drives how much reverb is added; the room's size/tone/pre-delay are track options */
    create: (ctx, o) => { const r = createReverb(ctx, { ...o, amount: 0 }); return { input: r.input, output: r.output, param: r.wet }; },
    toParam: wetFor,
    format: (v) => (v <= 0.001 ? 'Dry' : `${Math.round(v * 100)}% reverb`),
    options: {
      defaults: { decay: DEFAULT_REVERB.decay, tone: DEFAULT_REVERB.tone, preDelay: DEFAULT_REVERB.preDelay },
      normalize: (o) => { const { decay, tone, preDelay } = normalizeReverb(o); return { decay, tone, preDelay }; },
      params: {
        decay: { label: 'Decay', min: REVERB_LIMITS.decay[0], max: REVERB_LIMITS.decay[1], step: 0.1, fmt: (v) => `${v.toFixed(1)} s` },
        tone: { label: 'Tone', min: 0, max: 1, step: 0.01, fmt: (v) => (v < 0.33 ? 'dark' : v > 0.66 ? 'bright' : 'warm') },
        preDelay: { label: 'Pre-delay', min: REVERB_LIMITS.preDelay[0], max: REVERB_LIMITS.preDelay[1], step: 0.005, fmt: (v) => `${Math.round(v * 1000)} ms` },
      },
    },
  },
};

/*
 * Every insert effect (audio/fx.js) is also an automation effect: the curve drives its `auto`
 * control (always 0–1, so the curve value is the control value); its other controls become
 * the track's ⚙ options.
 */
for (const [type, def] of Object.entries(FX)) {
  const ap = def.params[def.auto];
  const rest = Object.fromEntries(Object.entries(def.params).filter(([k]) => k !== def.auto));
  AUTOMATION_EFFECTS[type] = {
    label: `${def.label} — ${ap.label.toLowerCase()}`,
    default: ap.def,
    create: (ctx, o) => {
      const u = createFx(ctx, type, { ...o, [def.auto]: ap.def });
      return { input: u.input, output: u.output, param: u.autoParam, dispose: u.dispose };
    },
    toParam: def.autoMap,
    format: ap.fmt,
    tail: def.tail ? (o) => def.tail(normalizeFxSettings(type, o)) : null,
    options: Object.keys(rest).length ? {
      defaults: { ...Object.fromEntries(Object.entries(rest).map(([k, d]) => [k, d.def])), ...(def.autoDefaults || {}) },
      normalize: (o) => { const all = normalizeFxSettings(type, o); return Object.fromEntries(Object.keys(rest).map((k) => [k, all[k]])); },
      params: rest,
    } : null,
  };
}
export const EFFECT_KEYS = Object.keys(AUTOMATION_EFFECTS);
