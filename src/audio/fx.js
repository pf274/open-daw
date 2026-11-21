/**
 * Insert effects shared by the custom synth (per-layer chain) and automation tracks.
 * Each definition lists its controls (`params`, which also drive the UI sliders), which control
 * automation drives (`auto`), and `create(ctx, settings)` → a unit:
 *   { input, output, update(settings), dispose(), autoParam, autoMap(value) }
 * Units with a `mix` control cross-fade dry ↔ wet with ONE AudioParam (so one curve moves both).
 * To add an effect: add a definition here — the synth's Effects tab and automation pick it up.
 */
import { clamp } from '../core/music.js';
import { workletReady } from './worklets.js';

const lin = (a, b) => (t) => a + (b - a) * t;
const log = (a, b) => (t) => a * (b / a) ** t;
const fmtHz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`);
const pct = (v) => `${Math.round(v * 100)}%`;
const ms = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`);
const hzLabel = (v) => `${v.toFixed(v < 1 ? 2 : 1)} Hz`;
const MIX = { label: 'Mix', min: 0, max: 1, step: 0.01, def: 1, fmt: pct, help: 'Original ↔ effected sound' };

/** Dry/wet cross-fade driven by one ConstantSource: wet = mix, dry = 1 − mix. */
function wetDry(ctx, mix) {
  const input = ctx.createGain(), output = ctx.createGain(), wetIn = ctx.createGain();
  const wet = ctx.createGain(), dry = ctx.createGain(), inv = ctx.createGain();
  const src = ctx.createConstantSource();
  src.offset.value = mix;
  wet.gain.value = 0; dry.gain.value = 1; inv.gain.value = -1;
  src.connect(wet.gain); src.connect(inv); inv.connect(dry.gain);
  input.connect(dry); dry.connect(output); input.connect(wetIn); wet.connect(output);
  src.start();
  return { input, output, wetIn, wetOut: wet, mix: src.offset, sources: [src] };
}
function lfo(ctx, rate, amount) {
  const osc = ctx.createOscillator(), amp = ctx.createGain();
  osc.frequency.value = rate; amp.gain.value = amount;
  osc.connect(amp); osc.start();
  return { osc, amp };
}
const stopAll = (sources) => () => { for (const s of sources) { try { s.stop(); } catch { /* not started / already stopped */ } } };

export const FX = {
  echo: {
    label: 'Echo',
    params: {
      time: { label: 'Time', min: 0.05, max: 1.5, step: 0.01, def: 0.35, fmt: ms, help: 'Gap between repeats' },
      feedback: { label: 'Feedback', min: 0, max: 0.9, step: 0.01, def: 0.4, fmt: pct, help: 'How many repeats' },
      tone: { label: 'Tone', min: 0, max: 1, step: 0.01, def: 0.6, fmt: (v) => (v < 0.33 ? 'dark' : v > 0.66 ? 'bright' : 'warm'), help: 'Each repeat gets darker (low) or stays bright (high)' },
      mix: { ...MIX, def: 0.35 },
    },
    auto: 'mix', autoMap: (v) => v,
    create(ctx, s) {
      const w = wetDry(ctx, s.mix);
      const delay = ctx.createDelay(2), damp = ctx.createBiquadFilter(), fb = ctx.createGain();
      damp.type = 'lowpass';
      w.wetIn.connect(delay); delay.connect(damp); damp.connect(fb); fb.connect(delay); damp.connect(w.wetOut);
      const update = (p) => { delay.delayTime.value = p.time; fb.gain.value = p.feedback; damp.frequency.value = log(800, 14000)(p.tone); };
      update(s);
      return { input: w.input, output: w.output, update: (p) => { update(p); w.mix.value = p.mix; }, dispose: stopAll(w.sources), autoParam: w.mix, autoMap: (v) => v };
    },
    /** Seconds the repeats keep ringing (to −60 dB) after the input stops. */
    tail: (s) => (s.feedback > 0.01 ? Math.min(8, s.time * Math.log(0.001) / Math.log(s.feedback)) : s.time),
  },

  distortion: {
    label: 'Distortion',
    params: {
      drive: { label: 'Drive', min: 0, max: 1, step: 0.01, def: 0.5, fmt: pct, help: 'How hard the signal is pushed into clipping' },
      tone: { label: 'Tone', min: 0, max: 1, step: 0.01, def: 0.6, fmt: (v) => fmtHz(log(1000, 16000)(v)), help: 'Smooths harsh top end' },
      mix: MIX,
    },
    auto: 'drive', autoMap: (drive) => 1 + drive * 30,
    create(ctx, s) {
      const w = wetDry(ctx, s.mix);
      const pre = ctx.createGain(), shaper = ctx.createWaveShaper(), post = ctx.createGain(), tone = ctx.createBiquadFilter();
      const curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * 3) / Math.tanh(3); }
      shaper.curve = curve; shaper.oversample = '4x';
      tone.type = 'lowpass'; post.gain.value = 0.6;
      w.wetIn.connect(pre); pre.connect(shaper); shaper.connect(tone); tone.connect(post); post.connect(w.wetOut);
      const autoMap = FX.distortion.autoMap;
      const update = (p) => { pre.gain.value = autoMap(p.drive); tone.frequency.value = log(1000, 16000)(p.tone); w.mix.value = p.mix; };
      update(s);
      return { input: w.input, output: w.output, update, dispose: stopAll(w.sources), autoParam: pre.gain, autoMap };
    },
  },

  bitcrusher: {
    label: 'Bitcrusher',
    params: {
      bits: { label: 'Bits', min: 1, max: 16, step: 1, def: 6, fmt: (v) => `${Math.round(v)}-bit`, help: 'Fewer bits = grittier, noisier' },
      downsample: { label: 'Downsample', min: 1, max: 32, step: 1, def: 4, fmt: (v) => `÷${Math.round(v)}`, help: 'Lower sample rate = aliased, lo-fi' },
      mix: MIX,
    },
    auto: 'mix', autoMap: (v) => v,
    create(ctx, s) {
      const w = wetDry(ctx, s.mix);
      let crush, update;
      if (workletReady(ctx) && typeof AudioWorkletNode !== 'undefined') {
        crush = new AudioWorkletNode(ctx, 'od-crusher', { parameterData: { bits: s.bits, downsample: s.downsample } });
        update = (p) => { crush.parameters.get('bits').value = p.bits; crush.parameters.get('downsample').value = p.downsample; };
      } else { // fallback: bit reduction only (a staircase wave-shaper)
        crush = ctx.createWaveShaper();
        update = (p) => {
          const steps = 2 ** Math.round(p.bits), curve = new Float32Array(4096);
          for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.round(x * steps / 2) / (steps / 2); }
          crush.curve = curve;
        };
      }
      w.wetIn.connect(crush); crush.connect(w.wetOut);
      update(s);
      return { input: w.input, output: w.output, update: (p) => { update(p); w.mix.value = p.mix; }, dispose: stopAll(w.sources), autoParam: w.mix, autoMap: (v) => v, worklet: crush.constructor?.name === 'AudioWorkletNode' };
    },
  },

  wah: {
    label: 'Wah-wah',
    params: {
      position: { label: 'Position', min: 0, max: 1, step: 0.01, def: 0.4, fmt: (v) => fmtHz(log(350, 2500)(v)), help: 'Where the pedal sits (heel = dark, toe = bright)' },
      rate: { label: 'Rate', min: 0, max: 8, step: 0.05, def: 2, fmt: (v) => (v < 0.05 ? 'off' : hzLabel(v)), help: 'Automatic wah speed (0 = pedal only — draw it with automation)' },
      depth: { label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.7, fmt: pct, help: 'How far the automatic wah sweeps' },
      resonance: { label: 'Resonance', min: 1, max: 20, step: 0.5, def: 8, fmt: (v) => v.toFixed(1), help: 'How vocal and peaky it sounds' },
      mix: MIX,
    },
    auto: 'position', autoMap: log(350, 2500),
    autoDefaults: { rate: 0 }, // as automation: a pedal you draw (turn Rate up for auto-wah on top)
    create(ctx, s) {
      const w = wetDry(ctx, s.mix);
      const bp = ctx.createBiquadFilter(), makeup = ctx.createGain();
      bp.type = 'bandpass'; makeup.gain.value = 2.5;
      const l = lfo(ctx, s.rate, 0);
      l.amp.connect(bp.detune); // sweeps ± depth × 2 octaves around the position
      w.wetIn.connect(bp); bp.connect(makeup); makeup.connect(w.wetOut);
      const autoMap = FX.wah.autoMap;
      const update = (p) => {
        bp.frequency.value = autoMap(p.position); bp.Q.value = p.resonance;
        l.osc.frequency.value = Math.max(0.01, p.rate); l.amp.gain.value = p.rate < 0.05 ? 0 : p.depth * 2400;
        w.mix.value = p.mix;
      };
      update(s);
      return { input: w.input, output: w.output, update, dispose: stopAll([...w.sources, l.osc]), autoParam: bp.frequency, autoMap };
    },
  },

  chorus: {
    label: 'Chorus',
    params: {
      rate: { label: 'Rate', min: 0.1, max: 5, step: 0.05, def: 0.8, fmt: hzLabel, help: 'Speed of the shimmer' },
      depth: { label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.5, fmt: pct, help: 'How much the copies detune' },
      mix: { ...MIX, def: 0.5 },
    },
    auto: 'mix', autoMap: (v) => v,
    create(ctx, s) {
      const w = wetDry(ctx, s.mix);
      const l = lfo(ctx, s.rate, 0), inv = ctx.createGain();
      inv.gain.value = -1;
      l.amp.connect(inv);
      for (const [base, side, mod] of [[0.015, -0.7, l.amp], [0.021, 0.7, inv]]) { // two voices, opposite phase, spread L/R
        const d = ctx.createDelay(0.05), pan = ctx.createStereoPanner();
        d.delayTime.value = base; pan.pan.value = side;
        mod.connect(d.delayTime);
        w.wetIn.connect(d); d.connect(pan); pan.connect(w.wetOut);
      }
      const update = (p) => { l.osc.frequency.value = p.rate; l.amp.gain.value = p.depth * 0.004; w.mix.value = p.mix; };
      update(s);
      return { input: w.input, output: w.output, update, dispose: stopAll([...w.sources, l.osc]), autoParam: w.mix, autoMap: (v) => v };
    },
  },

  phaser: {
    label: 'Phaser',
    params: {
      rate: { label: 'Rate', min: 0.05, max: 5, step: 0.05, def: 0.5, fmt: hzLabel, help: 'Speed of the sweep' },
      depth: { label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.7, fmt: pct, help: 'Width of the sweep' },
      feedback: { label: 'Feedback', min: 0, max: 0.85, step: 0.01, def: 0.4, fmt: pct, help: 'Sharper, more resonant notches' },
      mix: { ...MIX, def: 0.5 },
    },
    auto: 'mix', autoMap: (v) => v,
    create(ctx, s) {
      const w = wetDry(ctx, s.mix);
      const l = lfo(ctx, s.rate, 0), fb = ctx.createGain();
      const stages = [300, 600, 1200, 2400].map((f) => { const a = ctx.createBiquadFilter(); a.type = 'allpass'; a.frequency.value = f; a.Q.value = 0.6; l.amp.connect(a.detune); return a; });
      w.wetIn.connect(stages[0]);
      stages.reduce((a, b) => { a.connect(b); return b; });
      stages[3].connect(fb); fb.connect(stages[0]); stages[3].connect(w.wetOut);
      const update = (p) => { l.osc.frequency.value = p.rate; l.amp.gain.value = p.depth * 1800; fb.gain.value = p.feedback; w.mix.value = p.mix; };
      update(s);
      return { input: w.input, output: w.output, update, dispose: stopAll([...w.sources, l.osc]), autoParam: w.mix, autoMap: (v) => v };
    },
  },

  tremolo: {
    label: 'Tremolo',
    params: {
      rate: { label: 'Rate', min: 0.5, max: 15, step: 0.1, def: 5, fmt: hzLabel, help: 'Pulses per second' },
      depth: { label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.5, fmt: pct, help: 'How deep the volume dips' },
    },
    auto: 'depth', autoMap: (depth) => -depth,
    create(ctx, s) {
      // out = in − depth · in · (½ − ½ sin)  → one AudioParam (−depth) controls the whole effect
      const input = ctx.createGain(), output = ctx.createGain(), mod = ctx.createGain(), amount = ctx.createGain();
      const l = lfo(ctx, s.rate, -0.5);
      mod.gain.value = 0.5;
      l.amp.connect(mod.gain);
      input.connect(output); input.connect(mod); mod.connect(amount); amount.connect(output);
      const autoMap = FX.tremolo.autoMap;
      const update = (p) => { l.osc.frequency.value = p.rate; amount.gain.value = autoMap(p.depth); };
      update(s);
      return { input, output, update, dispose: stopAll([l.osc]), autoParam: amount.gain, autoMap };
    },
  },
};
export const FX_TYPES = Object.keys(FX);

/** Settings with defaults filled in and every control clamped to its range. */
export function normalizeFxSettings(type, s = {}) {
  const out = {};
  for (const [k, d] of Object.entries(FX[type].params)) {
    const v = Number(s?.[k]);
    out[k] = clamp(Number.isFinite(v) ? v : d.def, d.min, d.max);
  }
  return out;
}
export const fxDefaults = (type) => normalizeFxSettings(type, {});
/** A unit with its settings normalised. */
export const createFx = (ctx, type, s) => FX[type].create(ctx, normalizeFxSettings(type, s));
