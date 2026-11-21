/**
 * Custom synth patches (pure data). A layer with inst 'custom' carries `synth: <patch>`;
 * patchToSpec() turns it into the same voice spec the built-in instruments use, so
 * slides, tremor, transpose, preview and WAV export all work unchanged.
 *
 * A patch has a chain of up to MAX_FILTERS filters, each with its own envelope.
 * Old patches (single filterType/cutoff/resonance) are migrated by normalizePatch().
 */
import { clamp } from '../core/music.js';
import { widthToQ } from '../core/filterResponse.js';
import { DEFAULT_REVERB, normalizeReverb } from './reverb.js';
import { FX, normalizeFxSettings } from './fx.js';

export const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];

/* ---------------- filters ---------------- */
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'amplifier'];
export const FILTER_LABELS = {
  lowpass: 'Low-pass', highpass: 'High-pass', bandpass: 'Band-pass', notch: 'Notch', amplifier: 'Frequency Amplifier',
};
/** Which controls a filter type uses. */
export const usesResonance = (type) => type === 'lowpass' || type === 'highpass';
export const usesWidth = (type) => !usesResonance(type);
export const usesGain = (type) => type === 'amplifier';
/** Web Audio node type for each filter type. */
const NODE_TYPE = { lowpass: 'lowpass', highpass: 'highpass', bandpass: 'bandpass', notch: 'notch', amplifier: 'peaking' };

/** Envelope modes: off, sweep the frequency by `amount` octaves, or fade the amplifier's boost. */
export const ENV_MODES = ['off', 'freq', 'gain'];
export const ENV_MODE_LABELS = { off: 'Off', freq: 'Sweep frequency', gain: 'Fade boost' };
export const MAX_FILTERS = 6;

export const FILTER_LIMITS = {
  freq: [20, 20000],    // Hz (cutoff / centre)
  resonance: [0, 20],   // dB peak at the cutoff (low/high-pass)
  width: [0.1, 4],      // octaves (band-pass, notch, amplifier)
  gain: [0, 24],        // dB boost (amplifier)
  amount: [-4, 4],      // octaves the envelope sweeps the frequency
  attack: [0.001, 4], decay: [0.01, 4], sustain: [0, 1], release: [0.01, 6],
};

const DEFAULT_ENV = { mode: 'off', amount: 2, attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.3 };
const DEFAULT_FILTER = { type: 'lowpass', enabled: true, freq: 3000, resonance: 1, width: 1, gain: 9, env: DEFAULT_ENV };
const TYPE_DEFAULTS = {
  lowpass: { freq: 2000, resonance: 3 },
  highpass: { freq: 300, resonance: 1 },
  bandpass: { freq: 1000, width: 1 },
  notch: { freq: 1000, width: 0.5 },
  amplifier: { freq: 1000, width: 1, gain: 9 },
};

let filterUid = 1; // stable keys for the editor; persisted with the patch

export function normalizeFilter(f = {}) {
  const out = { ...DEFAULT_FILTER, ...f, env: { ...DEFAULT_ENV, ...(f.env || {}) } };
  if (!FILTER_TYPES.includes(out.type)) out.type = DEFAULT_FILTER.type;
  out.enabled = out.enabled !== false;
  for (const k of ['freq', 'resonance', 'width', 'gain']) {
    const v = +out[k];
    out[k] = clamp(Number.isFinite(v) ? v : DEFAULT_FILTER[k], ...FILTER_LIMITS[k]);
  }
  for (const k of ['amount', 'attack', 'decay', 'sustain', 'release']) {
    const v = +out.env[k];
    out.env[k] = clamp(Number.isFinite(v) ? v : DEFAULT_ENV[k], ...FILTER_LIMITS[k]);
  }
  if (!ENV_MODES.includes(out.env.mode) || (out.env.mode === 'gain' && !usesGain(out.type))) out.env.mode = 'off';
  if (Number.isInteger(f.id) && f.id > 0) { out.id = f.id; filterUid = Math.max(filterUid, f.id + 1); }
  else out.id = filterUid++;
  return out;
}

/** A new filter of `type` with sensible starting values. */
export const makeFilter = (type = 'lowpass') => normalizeFilter({ ...TYPE_DEFAULTS[type], type, env: { ...DEFAULT_ENV } });

/* ---------------- insert effects ---------------- */
export const MAX_EFFECTS = 6;
let effectUid = 1;
/** { id, type, enabled, …settings } with settings clamped; keeps ids stable across edits. */
export function normalizeEffect(e) {
  const out = { type: e.type, enabled: e.enabled !== false, ...normalizeFxSettings(e.type, e) };
  if (Number.isInteger(e.id) && e.id > 0) { out.id = e.id; effectUid = Math.max(effectUid, e.id + 1); } else out.id = effectUid++;
  return out;
}
export const makeEffect = (type) => normalizeEffect({ type });

/* ---------------- patches ---------------- */
export const DEFAULT_PATCH = {
  wave: 'sawtooth',
  osc2Wave: 'square', osc2Octave: 0, osc2Detune: 7, osc2Level: 0,
  attack: 0.01, decay: 0.25, sustain: 0.7, release: 0.25,   // seconds / level 0–1
  filters: [{ type: 'lowpass', freq: 3000, resonance: 1 }],
  vibDepth: 0, vibRate: 5.5,                                 // cents, Hz
  effects: [],                                               // insert effects, in order (see audio/fx.js)
  reverb: { ...DEFAULT_REVERB },                             // per-layer reverb after the effects (amount 0 = off)
  volume: 0.8,
  gm: 82,                                                    // GM program 1–128 used for MIDI export
};

/** [min, max] for every numeric top-level field (sliders use these too). */
export const PATCH_LIMITS = {
  osc2Octave: [-2, 2], osc2Detune: [-50, 50], osc2Level: [0, 1],
  attack: [0.001, 4], decay: [0.01, 4], sustain: [0, 1], release: [0.01, 6],
  vibDepth: [0, 100], vibRate: [0.5, 12],
  volume: [0, 1], gm: [1, 128],
};

const env = (mode, amount, attack, decay, sustain, release) => ({ mode, amount, attack, decay, sustain, release });
export const PRESETS = {
  Init: {},
  'Soft pad': { wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Detune: 12, osc2Level: 0.8, attack: 0.6, decay: 0.8, sustain: 0.8, release: 1.2,
    filters: [{ type: 'lowpass', freq: 900, resonance: 1, env: env('freq', 1, 1.2, 1.5, 0.6, 1.2) }], vibDepth: 6, reverb: { amount: 0.45, decay: 4, tone: 0.45, preDelay: 0.03 }, gm: 90 },
  Pluck: { wave: 'triangle', osc2Wave: 'sine', osc2Octave: 1, osc2Level: 0.3, attack: 0.002, decay: 0.35, sustain: 0, release: 0.15,
    filters: [{ type: 'lowpass', freq: 5000, resonance: 1 }], gm: 47 },
  'Wah pluck': { wave: 'sawtooth', osc2Level: 0, attack: 0.003, decay: 0.5, sustain: 0.2, release: 0.2,
    filters: [{ type: 'lowpass', freq: 400, resonance: 10, env: env('freq', 3, 0.02, 0.35, 0.1, 0.2) }], gm: 85 },
  'Fat bass': { wave: 'sawtooth', osc2Wave: 'square', osc2Octave: -1, osc2Detune: 0, osc2Level: 0.7, attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.08,
    filters: [{ type: 'lowpass', freq: 700, resonance: 4 }, { type: 'amplifier', freq: 90, width: 1.5, gain: 6 }], gm: 39 },
  'Square lead': { wave: 'square', osc2Wave: 'square', osc2Detune: 8, osc2Level: 0.5, attack: 0.01, decay: 0.1, sustain: 0.85, release: 0.15,
    filters: [{ type: 'lowpass', freq: 4500, resonance: 2 }, { type: 'amplifier', freq: 2200, width: 1, gain: 6 }], vibDepth: 12, vibRate: 5.5, gm: 81 },
  'Swell brass': { wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Detune: 6, osc2Level: 0.6, attack: 0.08, decay: 0.3, sustain: 0.8, release: 0.2,
    filters: [{ type: 'lowpass', freq: 1200, resonance: 2, env: env('freq', 1.5, 0.15, 0.4, 0.5, 0.2) },
      { type: 'amplifier', freq: 1500, width: 1.2, gain: 10, env: env('gain', 0, 0.3, 0.5, 0.6, 0.3) }], gm: 62 },
  Glass: { wave: 'sine', osc2Wave: 'sine', osc2Octave: 2, osc2Detune: 3, osc2Level: 0.35, attack: 0.003, decay: 1.2, sustain: 0.15, release: 1.5, filters: [], reverb: { amount: 0.4, decay: 3.2, tone: 0.75, preDelay: 0.01 }, gm: 99 },

  /* "Mowww": both filters snap open, then sweep down together.
     Low-pass closes from ~2.4 kHz to 300 Hz (closing mouth); the amplifier's vowel peak glides
     from the "ah" region (~1.25 kHz) down to the "oo/w" region (520 Hz). */
  'Cat meow': { wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Detune: 6, osc2Level: 0.5,
    attack: 0.03, decay: 0.5, sustain: 0.55, release: 0.25,
    filters: [
      { type: 'lowpass', freq: 300, resonance: 8, env: env('freq', 3, 0.06, 0.6, 0, 0.2) },
      { type: 'amplifier', freq: 520, width: 0.8, gain: 12, env: env('freq', 1.3, 0.06, 0.7, 0, 0.2) },
    ],
    vibDepth: 8, vibRate: 5, gm: 55 },
  /* Squelchy 303-style bass: resonant low-pass snapping shut on every note. */
  'Acid bass': { wave: 'sawtooth', osc2Level: 0, attack: 0.003, decay: 0.3, sustain: 0.5, release: 0.08,
    filters: [{ type: 'lowpass', freq: 250, resonance: 16, env: env('freq', 3.2, 0.005, 0.22, 0, 0.08) }], gm: 39 },
  'Sub bass': { wave: 'sine', osc2Wave: 'triangle', osc2Octave: 1, osc2Detune: 0, osc2Level: 0.15, attack: 0.008, decay: 0.2, sustain: 0.9, release: 0.12,
    filters: [{ type: 'lowpass', freq: 400, resonance: 0 }], gm: 40 },
  /* Two wide-detuned saws, gently filtered, with a little presence boost. */
  'Supersaw lead': { wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Detune: 18, osc2Level: 0.9, attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.3,
    filters: [{ type: 'lowpass', freq: 6000, resonance: 1 }, { type: 'amplifier', freq: 3000, width: 1.5, gain: 4 }], vibDepth: 6, gm: 82 },
  'Warm strings': { wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Detune: 10, osc2Level: 0.8, attack: 0.35, decay: 0.6, sustain: 0.85, release: 0.8, reverb: { amount: 0.35, decay: 2.8, tone: 0.5, preDelay: 0.03 },
    filters: [{ type: 'lowpass', freq: 2400, resonance: 0 }, { type: 'highpass', freq: 150, resonance: 0 }], vibDepth: 7, vibRate: 5.2, gm: 51 },
  'Organ': { wave: 'sine', osc2Wave: 'sine', osc2Octave: 1, osc2Detune: 0, osc2Level: 0.6, attack: 0.008, decay: 0.05, sustain: 1, release: 0.06,
    filters: [], vibDepth: 4, vibRate: 6.5, gm: 17 },
  'Chiptune': { wave: 'square', osc2Level: 0, attack: 0.001, decay: 0.08, sustain: 0.7, release: 0.03, filters: [], effects: [{ type: 'bitcrusher', bits: 5, downsample: 3, mix: 0.6 }], gm: 81 },
  'Dub stab': { wave: 'sawtooth', osc2Wave: 'square', osc2Detune: 10, osc2Level: 0.6, attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.15,
    filters: [{ type: 'lowpass', freq: 1400, resonance: 6 }], effects: [{ type: 'echo', time: 0.45, feedback: 0.55, tone: 0.35, mix: 0.45 }], reverb: { amount: 0.25, decay: 2.5, tone: 0.4, preDelay: 0.02 }, gm: 63 },
  'Funky wah': { wave: 'sawtooth', osc2Level: 0, attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.1,
    filters: [], effects: [{ type: 'wah', position: 0.45, rate: 3, depth: 0.8, resonance: 10, mix: 1 }, { type: 'distortion', drive: 0.25, tone: 0.5, mix: 0.6 }], gm: 29 },
  'Dreamy keys': { wave: 'triangle', osc2Wave: 'sine', osc2Octave: 1, osc2Level: 0.3, attack: 0.01, decay: 1.2, sustain: 0.3, release: 0.8,
    filters: [{ type: 'lowpass', freq: 4000, resonance: 0 }], effects: [{ type: 'chorus', rate: 0.6, depth: 0.6, mix: 0.5 }, { type: 'tremolo', rate: 4.5, depth: 0.3 }], reverb: { amount: 0.4, decay: 3, tone: 0.6, preDelay: 0.03 }, gm: 5 },
  /* Formant voice: amplifiers at the "ah" vowel's first three formants (~700, 1220, 2600 Hz). */
  'Choir ah': { wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Detune: 9, osc2Level: 0.7, attack: 0.25, decay: 0.4, sustain: 0.9, release: 0.6,
    filters: [
      { type: 'lowpass', freq: 3500, resonance: 0 },
      { type: 'amplifier', freq: 700, width: 0.5, gain: 14 },
      { type: 'amplifier', freq: 1220, width: 0.5, gain: 11 },
      { type: 'amplifier', freq: 2600, width: 0.5, gain: 8 },
    ],
    vibDepth: 9, vibRate: 5.3, reverb: { amount: 0.5, decay: 3.5, tone: 0.5, preDelay: 0.04 }, gm: 53 },
  'Hollow flute': { wave: 'triangle', osc2Wave: 'sine', osc2Octave: 1, osc2Level: 0.15, attack: 0.08, decay: 0.2, sustain: 0.9, release: 0.2,
    filters: [{ type: 'bandpass', freq: 1800, width: 1.5 }, { type: 'highpass', freq: 250, resonance: 0 }], vibDepth: 10, vibRate: 5, reverb: { amount: 0.3, decay: 2, tone: 0.6, preDelay: 0.02 }, gm: 74 },
};

/** How presets are grouped in the editor's dropdown (every preset appears exactly once). */
export const PRESET_GROUPS = [
  ['Start', ['Init']],
  ['Bass', ['Fat bass', 'Acid bass', 'Sub bass']],
  ['Leads', ['Square lead', 'Supersaw lead', 'Chiptune', 'Funky wah', 'Wah pluck', 'Pluck', 'Dub stab']],
  ['Pads & keys', ['Soft pad', 'Warm strings', 'Dreamy keys', 'Organ', 'Glass', 'Swell brass']],
  ['Voices & character', ['Cat meow', 'Choir ah', 'Hollow flute']],
];

/** Convert a pre-filter-chain patch (filterType/cutoff/resonance) to a filters array. */
function legacyFilters(p) {
  if (p.filterType === 'off') return [];
  if (!p.filterType) return DEFAULT_PATCH.filters;
  if (p.filterType === 'bandpass') return [{ type: 'bandpass', freq: p.cutoff ?? 1000, width: 1 }];
  return [{ type: p.filterType, freq: p.cutoff ?? 3000, resonance: p.resonance ?? 1 }];
}

/** Fill defaults, clamp ranges, reject unknown enums. Always returns a new object. */
export function normalizePatch(p = {}) {
  const out = { ...DEFAULT_PATCH, ...p };
  if (!WAVES.includes(out.wave)) out.wave = DEFAULT_PATCH.wave;
  if (!WAVES.includes(out.osc2Wave)) out.osc2Wave = DEFAULT_PATCH.osc2Wave;
  for (const [k, [lo, hi]] of Object.entries(PATCH_LIMITS)) {
    const v = +out[k];
    out[k] = clamp(Number.isFinite(v) ? v : DEFAULT_PATCH[k], lo, hi);
  }
  out.osc2Octave = Math.round(out.osc2Octave);
  out.gm = Math.round(out.gm);
  const filters = Array.isArray(p.filters) ? p.filters : legacyFilters(p);
  out.filters = filters.slice(0, MAX_FILTERS).map(normalizeFilter);
  out.effects = (Array.isArray(p.effects) ? p.effects : []).filter((e) => FX[e?.type]).slice(0, MAX_EFFECTS).map(normalizeEffect);
  out.reverb = normalizeReverb(p.reverb);
  delete out.filterType; delete out.cutoff; delete out.resonance;
  return out;
}

export const presetPatch = (name) => normalizePatch(PRESETS[name] || {});

/** One filter → the spec playVoice() builds a BiquadFilterNode from. */
export function filterSpec(f) {
  return {
    type: NODE_TYPE[f.type],
    freq: f.freq,
    q: usesResonance(f.type) ? f.resonance : widthToQ(f.width),
    gain: usesGain(f.type) ? f.gain : 0,
    env: f.env.mode === 'off' ? null : { ...f.env },
  };
}

/** A filter spec with its envelope held at `level` (0 = rest, 1 = peak) — for the response graph. */
export function filterAtEnvelope(s, level) {
  if (!s.env) return s;
  if (s.env.mode === 'freq') return { ...s, freq: clamp(s.freq * 2 ** (s.env.amount * level), ...FILTER_LIMITS.freq) };
  if (s.env.mode === 'gain') return { ...s, gain: s.gain * level };
  return s;
}

/**
 * A filter spec's enveloped value `t` seconds after note-on, for a note released at `offT`.
 * Mirrors applyFilterEnvelope() in audio/synth.js exactly (exponential attack ramp for
 * frequency / linear for boost, decay toward sustain, release from wherever it was).
 */
export function filterAtTime(s, t, offT) {
  if (!s.env) return s;
  const { mode, amount, attack: a, decay, sustain, release } = s.env;
  const hz = (v) => clamp(v, ...FILTER_LIMITS.freq);
  const isFreq = mode === 'freq';
  const base = isFreq ? hz(s.freq) : 0;
  const peak = isFreq ? hz(base * 2 ** amount) : s.gain;
  const target = isFreq ? hz(base * 2 ** (amount * sustain)) : s.gain * sustain;
  const relT = Math.max(offT, a + 0.01);
  const td = Math.max(0.003, decay / 3), tr = Math.max(0.003, release / 3);
  const held = (x) => target + (peak - target) * Math.exp(-(x - a) / td);
  let v;
  if (t <= 0) v = base;
  else if (t < a) v = isFreq ? base * (peak / base) ** (t / a) : peak * (t / a);
  else if (t < relT) v = held(t);
  else v = base + (held(relT) - base) * Math.exp(-(t - relT) / tr);
  return isFreq ? { ...s, freq: v } : { ...s, gain: v };
}

/** Patch → voice spec understood by audio/synth.js playVoice(). */
export function patchToSpec(patch) {
  const p = normalizePatch(patch);
  const partials = [[p.wave, 1, 1, 0]];
  if (p.osc2Level > 0) partials.push([p.osc2Wave, 2 ** p.osc2Octave, p.osc2Level, p.osc2Detune]);
  return {
    name: 'Custom synth',
    gm: p.gm - 1,
    partials,
    a: p.attack,
    s: p.sustain,
    dt: Math.max(0.003, p.decay / 3),   // decay given as ~time to settle; setTargetAtTime wants a time-constant
    r: p.release,
    filters: p.filters.filter((f) => f.enabled).map(filterSpec),
    vib: p.vibDepth,
    vibRate: p.vibRate,
    gain: p.volume,
  };
}
