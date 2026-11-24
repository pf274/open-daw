/** Note voices and the metronome click. */
import { getCtx, getMaster } from './context.js';
import { INSTRUMENTS } from './instruments.js';
import { playDrum } from './drums.js';
import { midiToFreq } from '../core/pitch.js';
import { automateGlides, makeTremor } from './modulation.js';
import { playPiano } from './piano.js';
import { playRecorded } from './recorded.js';

const FREQ_MIN = 20, FREQ_MAX = 20000;
const clampHz = (hz) => Math.max(FREQ_MIN, Math.min(FREQ_MAX, hz));

/**
 * Per-voice filter envelope (attack → decay to sustain → release at note-off).
 *  mode 'freq': sweeps the frequency up/down by env.amount octaves at the peak
 *  mode 'gain': the boost (dB) rises from 0 to the filter's gain, then settles and fades
 */
function applyFilterEnvelope(f, fs, when, off) {
  const { mode, amount, attack, decay, sustain, release } = fs.env;
  const peakAt = when + attack;
  const relAt = Math.max(off, peakAt + 0.01); // never release before the attack has finished
  if (mode === 'freq') {
    const p = f.frequency, base = clampHz(fs.freq);
    p.setValueAtTime(base, when);
    p.exponentialRampToValueAtTime(clampHz(base * 2 ** amount), peakAt);
    p.setTargetAtTime(clampHz(base * 2 ** (amount * sustain)), peakAt, Math.max(0.003, decay / 3));
    p.setTargetAtTime(base, relAt, Math.max(0.003, release / 3));
  } else if (mode === 'gain') {
    const p = f.gain;
    p.setValueAtTime(0, when);
    p.linearRampToValueAtTime(fs.gain, peakAt);
    p.setTargetAtTime(fs.gain * sustain, peakAt, Math.max(0.003, decay / 3));
    p.setTargetAtTime(0, relAt, Math.max(0.003, release / 3));
  }
}

/**
 * @param inst  instrument key (see instruments.js) or a voice spec object (e.g. from patchToSpec)
 * @param opts.glides  [{ from, to, midi }] — slide the voice's pitch (portamento)
 * @param opts.tremor  [{ from, depth, rate }] — pitch wobble per note segment
 */
export function playVoice(dest, inst, midi, when, dur, vel, { glides = null, tremor = null } = {}) {
  const actx = getCtx();
  let spec = typeof inst === 'object' && inst ? inst : INSTRUMENTS[inst] || INSTRUMENTS.piano;
  if (spec.sampled) { // a recorded instrument: its recording, or (still loading / offline) the stand-in synth
    if (playRecorded(dest, spec, midi, when, dur, vel, { glides, tremor })) return;
    spec = spec.fallback;
  }
  if (spec.drums) { playDrum(dest, midi, when, vel); return; }
  if (spec.piano) { playPiano(dest, midi, when, dur, vel, { glides, tremor }); return; }
  const freq = midiToFreq(midi);
  const env = actx.createGain();
  const off = when + Math.max(dur, spec.a + 0.01); // note-off: releases start here
  let out = env;
  if (spec.filters?.length) { // filter chain (custom patches), each with an optional envelope
    for (const fs of spec.filters) {
      const f = actx.createBiquadFilter();
      f.type = fs.type;
      f.frequency.value = fs.freq;
      f.Q.value = fs.q;
      f.gain.value = fs.gain;
      if (fs.env) applyFilterEnvelope(f, fs, when, off);
      out.connect(f);
      out = f;
    }
  } else if (spec.lp) {
    const f = actx.createBiquadFilter();
    const cutoff = (hz) => Math.min(18000, hz * spec.lp + 300);
    f.type = 'lowpass';
    f.frequency.value = cutoff(freq);
    f.Q.value = 0.7;
    if (glides?.length) { f.frequency.setValueAtTime(cutoff(freq), when); automateGlides(f.frequency, freq, glides, cutoff); }
    env.connect(f);
    out = f;
  }
  out.connect(dest);

  const total = spec.partials.reduce((s, p) => s + p[2], 0);
  const peak = (((vel / 127) * 0.35) / Math.max(1, total * 0.8)) * (spec.gain ?? 1);
  const g = env.gain;
  g.setValueAtTime(0, when);
  g.linearRampToValueAtTime(peak, when + spec.a);
  g.setTargetAtTime(peak * spec.s, when + spec.a, spec.dt);
  g.setTargetAtTime(0, off, spec.r / 3);
  const stop = off + spec.r * 2 + 0.05;

  let vibGain = null;
  if (spec.vib) {
    const lfo = actx.createOscillator();
    vibGain = actx.createGain();
    lfo.frequency.value = spec.vibRate || 5.2;
    vibGain.gain.value = spec.vib;
    lfo.connect(vibGain);
    lfo.start(when);
    lfo.stop(stop);
  }
  const tremorGain = tremor?.length ? makeTremor(actx, tremor, when, stop) : null;
  for (const [type, ratio, gain, det] of spec.partials) {
    const o = actx.createOscillator();
    const og = actx.createGain();
    o.type = type;
    o.frequency.value = freq * ratio;
    if (glides?.length) {
      o.frequency.setValueAtTime(freq * ratio, when);
      automateGlides(o.frequency, freq, glides, (hz) => hz * ratio);
    }
    if (det) o.detune.value = det;
    if (vibGain) vibGain.connect(o.detune);
    if (tremorGain) tremorGain.connect(o.detune);
    og.gain.value = gain;
    o.connect(og);
    og.connect(env);
    o.start(when);
    o.stop(stop);
  }
}

export function click(when, accent) {
  const actx = getCtx();
  const o = actx.createOscillator(), g = actx.createGain();
  o.frequency.value = accent ? 1760 : 1100;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g);
  g.connect(getMaster());
  o.start(when);
  o.stop(when + 0.06);
}
