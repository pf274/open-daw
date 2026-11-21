/** Synthesized General MIDI drum kit (notes 35–81) + the computer-key pad banks. */
import { getCtx } from './context.js';

/** The full GM percussion map (channel 10): note → short name. */
const KIT = {
  35: 'Bass drum 2', 36: 'Kick', 37: 'Rim', 38: 'Snare', 39: 'Clap', 40: 'Snare 2',
  41: 'Floor tom low', 42: 'Hat', 43: 'Floor tom high', 44: 'Pedal hat', 45: 'Tom low', 46: 'Open hat',
  47: 'Tom low-mid', 48: 'Tom high-mid', 49: 'Crash', 50: 'Tom high', 51: 'Ride', 52: 'China',
  53: 'Ride bell', 54: 'Tambourine', 55: 'Splash', 56: 'Cowbell', 57: 'Crash 2', 58: 'Vibraslap',
  59: 'Ride 2', 60: 'Bongo high', 61: 'Bongo low', 62: 'Conga mute', 63: 'Conga high', 64: 'Conga low',
  65: 'Timbale high', 66: 'Timbale low', 67: 'Agogo high', 68: 'Agogo low', 69: 'Cabasa', 70: 'Maracas',
  71: 'Whistle short', 72: 'Whistle long', 73: 'Guiro short', 74: 'Guiro long', 75: 'Claves',
  76: 'Wood block high', 77: 'Wood block low', 78: 'Cuica mute', 79: 'Cuica open', 80: 'Triangle mute', 81: 'Triangle open',
};

/**
 * Pad keys, strictly left to right across the keyboard (home row and the row above,
 * interleaved — the same layout as the pick-mode piano).
 */
export const PAD_KEY_ORDER = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'];

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/**
 * 47 sounds don't fit on 18 keys, so they're split into banks (Z / X switch, like piano octaves).
 * Within a bank, keys run in note order, so the drum strip reads A W S E D … bottom to top.
 */
export const DRUM_BANKS = [
  { name: 'Kit', notes: range(36, 53) },              // kick on A, snare on S
  { name: 'Cymbals & Latin', notes: range(54, 71) },
  { name: 'Extras', notes: [35, ...range(72, 81)] },
];

/** GM note → { name, key (KeyboardEvent.code), bank }. */
export const DRUMS = {};
DRUM_BANKS.forEach((b, bank) => b.notes.forEach((p, i) => { DRUMS[p] = { name: KIT[p], key: PAD_KEY_ORDER[i], bank }; }));
const BANK_KEYS = DRUM_BANKS.map((b) => Object.fromEntries(b.notes.map((p) => [DRUMS[p].key, p])));

export const keyLabel = (code) => (code === 'Semicolon' ? ';' : code === 'Quote' ? "'" : code.replace(/^Key/, ''));

/** The drum a key plays in `bank` (Space is always the kick), or undefined. */
export const drumForKey = (code, bank = 0) => (code === 'Space' ? 36 : BANK_KEYS[bank]?.[code]);

/** A bank's pads in key order: [{ key: 'A', name: 'Kick', pitch: 36 }, …] — for help texts. */
export const padList = (bank = 0) => DRUM_BANKS[bank].notes.map((p) => ({ key: keyLabel(DRUMS[p].key), name: KIT[p], pitch: p }));

/** [lowest, highest] note in a bank (for scrolling the roll to it). */
export const bankRange = (bank = 0) => [Math.min(...DRUM_BANKS[bank].notes), Math.max(...DRUM_BANKS[bank].notes)];

/* ---------------- synthesis ---------------- */
let noiseBuf = null;
function noise(actx, when, dur) {
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = actx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.start(when, Math.random() * 0.5);
  s.stop(when + dur);
  return s;
}
function filt(actx, type, freq, q) {
  const f = actx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7;
  return f;
}
function envGain(actx, when, peak, decay, dest) {
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  g.connect(dest);
  return g;
}
function noiseHit(actx, dest, when, v, type, freq, q, decay) {
  const n = noise(actx, when, decay + 0.05), f = filt(actx, type, freq, q);
  n.connect(f);
  f.connect(envGain(actx, when, v, decay, dest));
}
/** One oscillator with an exponential pitch move f0 → f1 (falling or rising). */
function toneHit(actx, dest, when, v, type, f0, f1, decay) {
  const o = actx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, when);
  o.frequency.exponentialRampToValueAtTime(f1, when + decay * 0.6);
  o.connect(envGain(actx, when, v, decay, dest));
  o.start(when);
  o.stop(when + decay + 0.05);
}
/** Several fixed sine partials through one envelope (bells, blocks, triangles). */
function partials(actx, dest, when, v, freqs, decay, type = 'sine') {
  const g = envGain(actx, when, v / Math.sqrt(freqs.length), decay, dest);
  for (const f of freqs) {
    const o = actx.createOscillator();
    o.type = type; o.frequency.value = f;
    o.connect(g); o.start(when); o.stop(when + decay + 0.05);
  }
}
/** A train of short noise bursts (rattles and scrapes: vibraslap, guiro). */
function burstTrain(actx, dest, when, v, count, interval, freq, q, fade = 1) {
  for (let i = 0; i < count; i++) {
    noiseHit(actx, dest, when + i * interval, v * (fade ** i), 'bandpass', freq, q, interval * 0.9);
  }
}

/**
 * Cymbal shimmer, TR-808 style: six square waves at inharmonic ratios, high-passed so only
 * their clashing upper partials remain. Because the frequencies share no common pitch,
 * the result rings metallically without a note you can hear.
 */
export const METAL_HZ = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metallicHit(actx, dest, when, v, decay, hpHz = 7000) {
  const hp = filt(actx, 'highpass', hpHz, 0.7);
  hp.connect(envGain(actx, when, v, decay, dest));
  for (const f of METAL_HZ) {
    const o = actx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(hp);
    o.start(when);
    o.stop(when + decay + 0.05);
  }
}

const TOM_HZ = { 41: 75, 43: 90, 45: 110, 47: 135, 48: 160, 50: 190 };

export function playDrum(dest, pitch, when, vel) {
  const actx = getCtx();
  const v = (vel / 127) * 0.9;
  const N = (...a) => noiseHit(actx, dest, when, ...a);
  const T = (...a) => toneHit(actx, dest, when, ...a);
  const P = (...a) => partials(actx, dest, when, ...a);
  switch (pitch) {
    /* ---- kicks & snares ---- */
    case 35: T(v, 'sine', 120, 36, 0.55); T(v * 0.25, 'triangle', 450, 90, 0.03); break; // deeper, longer kick
    case 36: T(v, 'sine', 160, 42, 0.4); T(v * 0.3, 'triangle', 600, 100, 0.03); break;
    case 37: T(v * 0.6, 'square', 900, 800, 0.03); N(v * 0.3, 'bandpass', 3000, 2, 0.03); break;
    case 38: N(v * 0.7, 'highpass', 1200, 0.7, 0.2); T(v * 0.5, 'triangle', 220, 160, 0.1); break;
    case 40: N(v * 0.75, 'highpass', 2200, 0.7, 0.14); T(v * 0.55, 'triangle', 260, 190, 0.06); break; // tighter, brighter
    case 39: // clap: three quick bursts and a tail
      for (const dt of [0, 0.012, 0.024]) noiseHit(actx, dest, when + dt, v * 0.6, 'bandpass', 1300, 1.5, 0.03);
      noiseHit(actx, dest, when + 0.03, v * 0.5, 'bandpass', 1300, 1.2, 0.18);
      break;

    /* ---- hi-hats & cymbals ---- */
    case 42: case 44: N(v * 0.45, 'highpass', 7500, 0.7, pitch === 44 ? 0.07 : 0.05); break;
    case 46: N(v * 0.4, 'highpass', 7000, 0.7, 0.35); break;
    case 49: N(v * 0.45, 'highpass', 4500, 0.5, 1.4); break;
    case 57: N(v * 0.45, 'highpass', 3800, 0.5, 1.7); metallicHit(actx, dest, when, v * 0.06, 1.2, 6000); break;
    case 51: case 59: // ride: noise wash + unpitched metallic shimmer (no audible note)
      N(v * 0.25, 'bandpass', 7000, 1, 0.6);
      metallicHit(actx, dest, when, v * 0.12, 0.7);
      break;
    case 52: N(v * 0.45, 'bandpass', 3500, 0.8, 1.1); metallicHit(actx, dest, when, v * 0.18, 0.9, 3000); break; // trashy china
    case 53: { // ride bell: the metallic cluster focused into a clang
      const bp = filt(actx, 'bandpass', 3200, 3);
      bp.connect(envGain(actx, when, v * 0.5, 1.1, dest));
      for (const f of METAL_HZ) { const o = actx.createOscillator(); o.type = 'square'; o.frequency.value = f * 2; o.connect(bp); o.start(when); o.stop(when + 1.15); }
      break;
    }
    case 55: N(v * 0.45, 'highpass', 6000, 0.6, 0.55); metallicHit(actx, dest, when, v * 0.08, 0.4); break; // splash

    /* ---- toms ---- */
    case 41: case 43: case 45: case 47: case 48: case 50: T(v, 'sine', TOM_HZ[pitch] * 1.6, TOM_HZ[pitch], 0.35); break;

    /* ---- hand percussion ---- */
    case 54: N(v * 0.4, 'bandpass', 9000, 1.5, 0.18); break;
    case 56: {
      const bp = filt(actx, 'bandpass', 800, 2);
      bp.connect(envGain(actx, when, v * 0.5, 0.3, dest));
      for (const f of [540, 800]) {
        const o = actx.createOscillator();
        o.type = 'square'; o.frequency.value = f;
        o.connect(bp); o.start(when); o.stop(when + 0.35);
      }
      break;
    }
    case 58: burstTrain(actx, dest, when, v * 0.5, 18, 0.032, 3000, 4, 0.88); break; // vibraslap rattle
    case 60: T(v * 0.8, 'sine', 420, 360, 0.15); N(v * 0.15, 'bandpass', 4000, 2, 0.01); break;
    case 61: T(v * 0.8, 'sine', 300, 255, 0.18); N(v * 0.15, 'bandpass', 3500, 2, 0.01); break;
    case 62: T(v * 0.8, 'sine', 340, 300, 0.07); N(v * 0.25, 'bandpass', 2500, 2, 0.015); break; // muted slap
    case 63: T(v * 0.8, 'sine', 340, 315, 0.28); break;
    case 64: T(v * 0.8, 'sine', 230, 205, 0.32); break;
    case 65: P(v * 0.5, [520, 1180], 0.3, 'triangle'); N(v * 0.2, 'bandpass', 4500, 2, 0.04); break;
    case 66: P(v * 0.5, [380, 870], 0.35, 'triangle'); N(v * 0.2, 'bandpass', 4000, 2, 0.04); break;
    case 67: P(v * 0.5, [900, 1440, 2610], 0.3); break;
    case 68: P(v * 0.5, [640, 1024, 1856], 0.32); break;
    case 69: N(v * 0.35, 'highpass', 6500, 0.7, 0.09); break;   // cabasa
    case 70: N(v * 0.3, 'highpass', 9000, 0.7, 0.05); break;    // maracas
    case 71: case 72: { // whistles (GM whistles are pitched)
      const dur = pitch === 71 ? 0.12 : 0.45;
      const o = actx.createOscillator(), lfo = actx.createOscillator(), depth = actx.createGain();
      o.type = 'sine'; o.frequency.value = 2600;
      lfo.frequency.value = 24; depth.gain.value = 60;
      lfo.connect(depth); depth.connect(o.frequency);
      o.connect(envGain(actx, when, v * 0.3, dur, dest));
      o.start(when); o.stop(when + dur + 0.05); lfo.start(when); lfo.stop(when + dur + 0.05);
      break;
    }
    case 73: burstTrain(actx, dest, when, v * 0.45, 6, 0.022, 2600, 3); break;  // short guiro scrape
    case 74: burstTrain(actx, dest, when, v * 0.45, 16, 0.024, 2600, 3); break; // long guiro scrape
    case 75: P(v * 0.7, [2500], 0.06); break;                     // claves
    case 76: P(v * 0.6, [1100, 2650], 0.07); N(v * 0.15, 'bandpass', 5000, 2, 0.01); break;
    case 77: P(v * 0.6, [800, 1930], 0.08); N(v * 0.15, 'bandpass', 4500, 2, 0.01); break;
    case 78: T(v * 0.55, 'sine', 620, 500, 0.11); break;          // cuica mute
    case 79: T(v * 0.55, 'sine', 380, 680, 0.32); break;          // cuica open: rising "whoop"
    case 80: P(v * 0.35, [4800, 7400, 9600], 0.1); break;         // triangle mute
    case 81: P(v * 0.35, [4800, 7400, 9600], 1.4); break;         // triangle open

    default: N(v * 0.4, 'bandpass', 2000 + (pitch % 12) * 400, 2, 0.08); // outside the GM map: short click
  }
}
