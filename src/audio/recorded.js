/**
 * Recorded instruments: any General MIDI instrument, played from real recordings (the free
 * FluidR3 GM set, one ~25 KB file per note, fetched on demand like the recorded piano).
 *
 * A layer with inst 'recorded' has `program` (GM 1–128). Its voice spec is { sampled: program, … };
 * audio/synth.js plays the recording when that note's file is loaded, otherwise a synth stand-in
 * from the same family (and the file is fetched for next time; engine/samples.js preloads the notes
 * a project uses, and WAV export waits for them).
 *
 * Recordings are a few seconds long. Instruments that hold their sound (winds, strings, organs,
 * pads…) loop a steady stretch of the recording for longer notes; plucked and struck ones just ring out.
 */
import { getCtx } from './context.js';
import { peekSample, loadSample, sampleNote, normalizeGain } from './gmSamples.js';
import { makeTremor } from './modulation.js';
import { midiToFreq } from '../core/pitch.js';
import { GM_PROGRAMS } from '../core/gm.js';

export const DEFAULT_PROGRAM = 66; // Alto Sax
const LEVEL = 0.32;    // velocity 127 ≈ this peak: level with the synth voices
const RELEASE = 0.12;  // seconds to fade after note-off

const family = (program) => (program - 1) >> 3;
/** Families whose sound holds while the key is down (so long notes loop the recording). */
const SUSTAINED = new Set([2, 5, 6, 7, 8, 9, 10, 11]); // organ, strings, ensemble, brass, reed, pipe, synth lead, synth pad
export const isSustained = (program) => SUSTAINED.has(family(program));

export const programName = (program) => GM_PROGRAMS[program - 1] || `Program ${program}`;
export const clampProgram = (p) => Math.max(1, Math.min(128, Math.round(+p) || DEFAULT_PROGRAM));

const specs = new Map();
/**
 * The voice spec for a GM program. `fallback(program)` gives the synth stand-in (passed in by
 * instruments.js, which owns the synth catalogue).
 */
export function recordedSpec(program, fallback) {
  program = clampProgram(program);
  if (!specs.has(program)) {
    specs.set(program, { name: programName(program), gm: program - 1, sampled: program, sustained: isSustained(program), fallback: fallback(program) });
  }
  return specs.get(program);
}

/** Leading silence in a recording (MP3 padding), so notes start on time. */
const onsets = new WeakMap();
function onsetOf(buffer) {
  if (onsets.has(buffer)) return onsets.get(buffer);
  const d = buffer.getChannelData(0);
  let i = 0;
  while (i < d.length && Math.abs(d[i]) < 0.002) i++;
  const t = i < d.length ? Math.max(0, i - 32) / buffer.sampleRate : 0;
  onsets.set(buffer, t);
  return t;
}

/**
 * Loop points for holding a sustained note past the end of its recording: a stretch from the
 * steady middle, a whole number of the note's periods long so the seam doesn't click. Null when the
 * recording is too short to have a steady part.
 */
export function loopPoints(buffer, recordedMidi, onset = 0) {
  const len = buffer.duration - onset;
  if (len < 0.6) return null;
  const period = 1 / midiToFreq(recordedMidi);
  const start = onset + len * 0.35;
  const span = Math.max(period, Math.round((len * 0.35) / period) * period); // about a third of the sound
  const end = Math.min(buffer.duration - 0.05, start + span);
  return end - start >= period ? { start, end } : null;
}

/**
 * Play a note from its recording if it's loaded; returns false (after asking for the file) when it
 * isn't, so the caller plays the stand-in this time.
 */
export function playRecorded(dest, spec, midi, when, dur, vel, { glides = null, tremor = null } = {}) {
  const buffer = peekSample(spec.sampled, midi);
  if (!buffer) { loadSample(spec.sampled, midi).catch(() => {}); return false; }
  const actx = getCtx();
  const v = vel / 127, recorded = sampleNote(midi), onset = onsetOf(buffer);
  const rate = (m) => 2 ** ((m - recorded) / 12);
  const off = when + Math.max(dur, 0.03);
  const stop = off + RELEASE * 5;

  const src = actx.createBufferSource();
  src.buffer = buffer;
  if (spec.sustained && dur * rate(midi) > buffer.duration - onset - 0.2) { // longer than the recording: hold it
    const loop = loopPoints(buffer, recorded, onset);
    if (loop) { src.loop = true; src.loopStart = loop.start; src.loopEnd = loop.end; }
  }
  src.playbackRate.setValueAtTime(rate(midi), when);
  if (glides?.length) { // slides bend the recording
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
  tone.frequency.value = 2000 + 16000 * v * v;
  tone.Q.value = 0.5;
  const amp = actx.createGain();
  const peak = LEVEL * v ** 1.3 * normalizeGain(buffer);
  amp.gain.setValueAtTime(peak, when);
  amp.gain.setValueAtTime(peak, off);
  amp.gain.setTargetAtTime(0, off, RELEASE / 3);

  src.connect(tone);
  tone.connect(amp);
  amp.connect(dest);
  src.start(when, onset);
  src.stop(stop);
  return true;
}
