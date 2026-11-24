import { patchToSpec, normalizePatch, PRESETS } from './customSynth.js';
import { recordedSpec, clampProgram } from './recorded.js';

/**
 * Instrument catalogue (pure data). To add an instrument, add an entry here.
 *  gm:       General MIDI program used on export
 *  partials: [oscillator type, freq ratio, gain, detune cents]
 *  a / s / dt / r: attack, sustain level, decay time-constant, release
 *  lp:       low-pass cutoff as a multiple of the note frequency
 *  vib:      vibrato depth in cents
 *  drums:    rendered by audio/drums.js and exported on channel 10
 *  piano:    rendered by audio/piano.js (sampled grand, synthesized fallback)
 *  recorded: any GM instrument from real recordings (audio/recorded.js); the layer's `program` picks it
 */
export const INSTRUMENTS = {
  piano:    { name: 'Piano', gm: 0, piano: true }, // audio/piano.js: recorded grand (or a modelled one offline)
  musicbox: { name: 'Music box', gm: 10, partials: [['sine', 1, 1], ['sine', 4, 0.3], ['sine', 7.1, 0.08]], a: 0.002, s: 0, dt: 0.45, r: 0.15 },
  marimba:  { name: 'Marimba', gm: 12, partials: [['sine', 1, 1], ['sine', 4, 0.2]], a: 0.002, s: 0, dt: 0.22, r: 0.08 },
  organ:    { name: 'Organ', gm: 16, partials: [['sine', 1, 1], ['sine', 2, 0.5], ['sine', 3, 0.3], ['sine', 4, 0.15]], a: 0.01, s: 1, dt: 0.02, r: 0.05 },
  guitar:   { name: 'Guitar', gm: 24, partials: [['sawtooth', 1, 1]], a: 0.003, s: 0, dt: 0.55, r: 0.1, lp: 4 },
  bass:     { name: 'Bass', gm: 33, partials: [['sawtooth', 1, 0.7], ['sine', 0.5, 0.5]], a: 0.005, s: 0.5, dt: 0.25, r: 0.07, lp: 3 },
  strings:  { name: 'Strings', gm: 48, partials: [['sawtooth', 1, 0.6, -7], ['sawtooth', 1, 0.6, 7]], a: 0.15, s: 1, dt: 0.1, r: 0.3, lp: 5 },
  brass:    { name: 'Brass', gm: 61, partials: [['sawtooth', 1, 1]], a: 0.05, s: 0.8, dt: 0.12, r: 0.08, lp: 4 },
  flute:    { name: 'Flute', gm: 73, partials: [['sine', 1, 1], ['sine', 2, 0.12]], a: 0.06, s: 1, dt: 0.05, r: 0.1, vib: 6 },
  whistle:  { name: 'Whistle', gm: 78, partials: [['sine', 1, 1]], a: 0.03, s: 1, dt: 0.05, r: 0.08, vib: 10 },
  square:   { name: 'Square lead', gm: 80, partials: [['square', 1, 0.6]], a: 0.008, s: 1, dt: 0.05, r: 0.06, lp: 6 },
  saw:      { name: 'Saw lead', gm: 81, partials: [['sawtooth', 1, 0.6]], a: 0.008, s: 1, dt: 0.05, r: 0.06, lp: 7 },
  drums:    { name: 'Drum kit', gm: 0, drums: true },
  recorded: { name: 'Recorded instrument', gm: 65, recorded: true }, // real samples of a GM instrument (layer.program)
  custom:   { name: 'Custom synth', gm: 81, custom: true }, // sound comes from the layer's `synth` patch
};

export const isDrumInst = (key) => !!(INSTRUMENTS[key] && INSTRUMENTS[key].drums);

/** The voice spec a layer plays with: its custom patch, or the built-in instrument. */
export const specFor = (tr) => (tr.inst === 'custom' ? patchToSpec(tr.synth)
  : tr.inst === 'recorded' ? recordedSpec(tr.program, standIn)
  : INSTRUMENTS[tr.inst] || INSTRUMENTS.piano);

/**
 * What a recorded instrument plays while its recordings load (or offline): the closest synth
 * from the same GM family.
 */
const FAMILY_STAND_INS = ['piano', 'marimba', 'organ', 'guitar', 'bass', 'strings', 'strings', 'brass',
  'sax', 'flute', 'saw', 'strings', 'saw', 'guitar', 'marimba', 'saw'];
const saxSpec = patchToSpec(PRESETS.Sax);
function standIn(program) {
  const key = FAMILY_STAND_INS[(program - 1) >> 3] || 'saw';
  return key === 'sax' ? saxSpec : INSTRUMENTS[key];
}

/** The layer's reverb settings when it has one switched on (custom synth layers), else null. */
export function reverbFor(tr) {
  if (tr.inst !== 'custom') return null;
  const r = normalizePatch(tr.synth).reverb;
  return r.amount > 0 ? r : null;
}

/** The layer's effect chain { effects, reverb } (custom synth layers), or null when it has none. */
export function fxFor(tr) {
  if (tr.inst !== 'custom') return null;
  const p = normalizePatch(tr.synth);
  const effects = p.effects.filter((e) => e.enabled);
  const reverb = p.reverb.amount > 0 ? p.reverb : null;
  return effects.length || reverb ? { effects, reverb } : null;
}

/** GM program (0-based) used when exporting the layer to MIDI. */
export const gmProgramFor = (tr) => (tr.inst === 'custom' ? normalizePatch(tr.synth).gm - 1
  : tr.inst === 'recorded' ? clampProgram(tr.program) - 1
  : (INSTRUMENTS[tr.inst] || INSTRUMENTS.piano).gm);
