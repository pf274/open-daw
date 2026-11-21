/**
 * Real General MIDI samples: previews of MIDI export instruments, and the sampled piano.
 * Uses the free FluidR3 GM set from midi-js-soundfonts (one ~25 KB mp3 per note),
 * fetched on demand and cached per (program, note). Needs a network connection;
 * nothing is sent except the file request itself.
 */
import { getCtx } from './context.js';
import { GM_SAMPLE_NAMES } from '../core/gm.js';

export const GM_SAMPLE_BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM';
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const SAMPLE_RANGE = [21, 108]; // A0–C8: the notes the set provides

/** URL of one note of one GM program (program is 1-based, like the UI). */
export function sampleUrl(program, midi) {
  const m = Math.max(SAMPLE_RANGE[0], Math.min(SAMPLE_RANGE[1], Math.round(midi)));
  const name = GM_SAMPLE_NAMES[program - 1];
  if (!name) throw new Error(`No GM program ${program}`);
  return `${GM_SAMPLE_BASE}/${name}-mp3/${FLATS[m % 12]}${Math.floor(m / 12) - 1}.mp3`;
}

const cache = new Map();   // url → Promise<AudioBuffer>
const decoded = new Map(); // url → AudioBuffer, once ready (for synchronous use while scheduling)

let decoder = null;
/** Decoding needs a context; before the app's audio starts, use a silent offline one. */
function decodeWith() {
  const live = getCtx();
  if (live) return live;
  if (!decoder && typeof OfflineAudioContext !== 'undefined') decoder = new OfflineAudioContext(2, 1, 44100);
  return decoder;
}

/** Fetch + decode (cached). Failed loads are not cached, so a retry can succeed. */
export function loadSample(program, midi, fetchImpl = fetch) {
  const url = sampleUrl(program, midi);
  if (!cache.has(url)) {
    const actx = decodeWith(); // capture now; the callback runs later
    const p = fetchImpl(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((buf) => actx.decodeAudioData(buf))
      .then((buffer) => { decoded.set(url, buffer); return buffer; });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url);
}

const gains = new WeakMap();
/**
 * Gain that brings a recording to a standard peak level. The FluidR3 files aren't normalised
 * (a middle-C piano note peaks around −21 dBFS), so without this they'd play far too quietly.
 */
export const SAMPLE_PEAK = 0.9;
export function normalizeGain(buffer) {
  if (gains.has(buffer)) return gains.get(buffer);
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  const g = peak > 1e-4 ? SAMPLE_PEAK / peak : 1;
  gains.set(buffer, g);
  return g;
}

/** The decoded sample if it's already loaded, else null (never waits — safe while scheduling). */
export const peekSample = (program, midi) => decoded.get(sampleUrl(program, midi)) || null;
/** The note a sample file was recorded at (requests outside A0–C8 use the nearest one). */
export const sampleNote = (midi) => Math.max(SAMPLE_RANGE[0], Math.min(SAMPLE_RANGE[1], Math.round(midi)));

/** Play a decoded sample for `dur` seconds with a short release. */
export function playSample(dest, buffer, when, dur, vel) {
  const actx = getCtx();
  const src = actx.createBufferSource();
  const g = actx.createGain();
  src.buffer = buffer;
  const peak = (vel / 127) * 0.35 * normalizeGain(buffer); // matched to the synth voices' level
  g.gain.setValueAtTime(peak, when);
  g.gain.setTargetAtTime(0, when + dur, 0.06);
  src.connect(g);
  g.connect(dest);
  src.start(when);
  src.stop(when + Math.min(buffer.duration, dur + 0.4));
}
