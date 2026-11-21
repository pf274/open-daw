/**
 * Piano voice.
 *  - Sampled: the FluidR3 acoustic grand (one recording per key), when that key's sample is
 *    loaded and samples are enabled. Velocity sets loudness and brightness; releasing the key
 *    drops the damper. Slides bend playback rate; tremor wobbles detune.
 *  - Synthesized fallback (offline, still loading, or samples turned off): additive model with
 *    slightly stretched (inharmonic) partials, higher partials decaying faster, a two-stage
 *    decay, gently beating unison strings, a hammer "thunk", and longer decays for low notes.
 * Scheduling is synchronous, so a missing sample is requested in the background and the
 * synth plays this time.
 */
import { getCtx } from './context.js';
import { peekSample, loadSample, sampleNote, normalizeGain } from './gmSamples.js';
import { automateGlides, makeTremor } from './modulation.js';
import { midiToFreq } from '../core/pitch.js';
import { clamp } from '../core/music.js';

export const PIANO_PROGRAM = 1; // GM 1: Acoustic Grand Piano
const DAMPER_S = 0.12;          // release time when the key comes up
const SAMPLE_LEVEL = 0.7;       // recorded notes: velocity 100 ≈ 0.3 peak, level with the other instruments
const SYNTH_LEVEL = 0.6;        // same for the modelled piano

let useSamples = false; // turned on by the app (engine/samples.js) from the user's setting
export const setPianoSamples = (on) => { useSamples = !!on; };
export const pianoSamplesEnabled = () => useSamples;

export function playPiano(dest, midi, when, dur, vel, opts = {}) {
  const buffer = useSamples ? peekSample(PIANO_PROGRAM, midi) : null;
  if (buffer) return sampleVoice(dest, buffer, midi, when, dur, vel, opts);
  if (useSamples) loadSample(PIANO_PROGRAM, midi).catch(() => {}); // ready next time
  return synthVoice(dest, midi, when, dur, vel, opts);
}

/* ---------------- sampled ---------------- */
const onsets = new WeakMap();
/** Seconds of leading silence (MP3 encoder padding) to skip so notes start on time. */
export function onsetOf(buffer) {
  if (onsets.has(buffer)) return onsets.get(buffer);
  const d = buffer.getChannelData(0);
  let i = 0;
  while (i < d.length && Math.abs(d[i]) < 0.002) i++;
  const t = i < d.length ? Math.max(0, i - 32) / buffer.sampleRate : 0;
  onsets.set(buffer, t);
  return t;
}

function sampleVoice(dest, buffer, midi, when, dur, vel, { glides = null, tremor = null }) {
  const actx = getCtx();
  const v = vel / 127, recorded = sampleNote(midi);
  const rate = (m) => 2 ** ((m - recorded) / 12);
  const off = when + Math.max(dur, 0.03);
  const stop = off + DAMPER_S * 4;

  const src = actx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.setValueAtTime(rate(midi), when);
  if (glides?.length) {
    let prev = midi;
    for (const g of glides) {
      src.playbackRate.setValueAtTime(rate(prev), g.from);
      src.playbackRate.exponentialRampToValueAtTime(rate(g.midi), g.to);
      prev = g.midi;
    }
  }
  if (tremor?.length) makeTremor(actx, tremor, when, stop).connect(src.detune);

  const tone = actx.createBiquadFilter(); // softer playing = darker tone
  tone.type = 'lowpass';
  tone.frequency.value = 1500 + 16500 * v * v;
  tone.Q.value = 0.5;
  const amp = actx.createGain();
  const peak = SAMPLE_LEVEL * v ** 1.5 * normalizeGain(buffer); // recordings are normalised first
  amp.gain.setValueAtTime(peak, when);
  amp.gain.setValueAtTime(peak, off);
  amp.gain.setTargetAtTime(0, off, DAMPER_S / 3);

  src.connect(tone);
  tone.connect(amp);
  amp.connect(dest);
  src.start(when, onsetOf(buffer));
  src.stop(stop);
  return 'sample';
}

/* ---------------- synthesized ---------------- */
let noiseBuf = null;
function hammer(actx, dest, when, v) {
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, Math.ceil(actx.sampleRate * 0.05), actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const n = actx.createBufferSource(), bp = actx.createBiquadFilter(), g = actx.createGain();
  n.buffer = noiseBuf;
  bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 0.8;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.06 * v + 0.0002, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
  n.connect(bp); bp.connect(g); g.connect(dest);
  n.start(when); n.stop(when + 0.05);
}

/** Partial frequency ratios and levels for a note (exported for tests). */
export function pianoPartials(midi, vel) {
  const v = vel / 127, f0 = midiToFreq(midi);
  const B = 0.0004; // string stiffness → each partial slightly sharp: n·√(1 + B·n²)
  const out = [];
  for (let n = 1; n <= 10; n++) {
    const ratio = n * Math.sqrt(1 + B * n * n);
    if (f0 * ratio > 14000) break;
    const level = (1 / n ** 1.1) * (0.3 + 0.7 * v) ** (n - 1); // harder hits are brighter
    out.push({ n, ratio, level });
  }
  return out;
}
/** Seconds for the fundamental to die away: long in the bass, short in the treble. */
export const pianoDecay = (midi) => clamp(4 * 2 ** (-(midi - 48) / 18), 0.6, 8);

function synthVoice(dest, midi, when, dur, vel, { glides = null, tremor = null }) {
  const actx = getCtx();
  const v = vel / 127, f0 = midiToFreq(midi), T = pianoDecay(midi);
  const off = when + Math.max(dur, 0.03);
  const stop = Math.min(off + DAMPER_S * 4, when + T * 6);
  const partials = pianoPartials(midi, vel);
  const norm = (SYNTH_LEVEL * v) / partials.reduce((s, p) => s + p.level * (p.n <= 3 ? 2 : 1), 0);

  const out = actx.createGain(); // the damper
  out.gain.setValueAtTime(1, when);
  out.gain.setValueAtTime(1, off);
  out.gain.setTargetAtTime(0, off, DAMPER_S / 3);
  out.connect(dest);
  const wobble = tremor?.length ? makeTremor(actx, tremor, when, stop) : null;

  for (const { n, ratio, level } of partials) {
    const tau = T / (1 + 0.6 * (n - 1)); // higher partials die faster
    for (const cents of n <= 3 ? [-1.2, 1.2] : [0]) { // unison strings beat gently
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine';
      o.frequency.value = f0 * ratio;
      o.detune.value = cents;
      if (glides?.length) { o.frequency.setValueAtTime(f0 * ratio, when); automateGlides(o.frequency, f0, glides, (hz) => hz * ratio); }
      if (wobble) wobble.connect(o.detune);
      const peak = level * norm;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(peak, when + 0.003);
      g.gain.setTargetAtTime(peak * 0.4, when + 0.003, 0.09);         // prompt sound…
      g.gain.setTargetAtTime(0, when + 0.25, tau / 3);                // …then the long aftersound
      o.connect(g); g.connect(out);
      o.start(when); o.stop(stop);
    }
  }
  hammer(actx, out, when, v);
  return 'synth';
}
