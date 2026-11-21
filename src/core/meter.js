/**
 * Time signatures. Note positions are always in quarter-note beats ("beats" in the code,
 * like MIDI ticks and BPM); a time signature only decides how they group into bars.
 *   4/4 → bar = 4 beats · 3/4 → 3 · 6/8 → 3 · 7/8 → 3.5 · 2/2 → 4
 */
import { clamp } from './music.js';

export const DENOMINATORS = [2, 4, 8, 16];
export const TIME_SIG_PRESETS = ['4/4', '3/4', '2/4', '5/4', '6/8', '7/8', '9/8', '12/8', '2/2'];
export const DEFAULT_TIME_SIG = { num: 4, den: 4 };

export function normalizeTimeSig(ts) {
  const n = Number(ts?.num);
  const num = Number.isFinite(n) && ts?.num !== '' && ts?.num != null ? clamp(Math.round(n), 1, 16) : 4; // typed 0 → 1, missing → 4
  const den = DENOMINATORS.includes(+ts?.den) ? +ts.den : 4;
  return { num, den };
}
export const parseTimeSig = (s) => { const [num, den] = String(s).split('/').map(Number); return normalizeTimeSig({ num, den }); };
export const formatTimeSig = (ts) => `${ts.num}/${ts.den}`;

/** Quarter-note beats in one bar. */
export const barBeats = (ts) => (ts.num * 4) / ts.den;
/** Quarter-note beats in one counted beat (the denominator's note value). */
export const countBeats = (ts) => 4 / ts.den;

/** Bar / beat / hundredths (all 1-based except hundredths) of a position. */
export function position(beat, ts) {
  const bar = barBeats(ts), unit = countBeats(ts);
  const b = Math.max(0, beat);
  const barIdx = Math.floor(b / bar + 1e-9);
  const inBar = b - barIdx * bar;
  const beatIdx = Math.floor(inBar / unit + 1e-9);
  return { bar: barIdx + 1, beat: beatIdx + 1, hundredths: Math.floor(((inBar - beatIdx * unit) / unit) * 100) };
}
export const formatPosition = (beat, ts) => {
  const p = position(beat, ts);
  return `${p.bar}.${p.beat}.${String(p.hundredths).padStart(2, '0')}`;
};

/** Is `beat` (within float error) on a bar line? */
export const onBarLine = (beat, ts) => Math.abs(beat / barBeats(ts) - Math.round(beat / barBeats(ts))) < 1e-6;

/** Round / floor a position to a grid (grid ≤ 0 → no snapping). */
export const snapRound = (beat, grid) => (grid > 0 ? Math.round(beat / grid) * grid : beat);
export const snapFloor = (beat, grid) => (grid > 0 ? Math.floor(beat / grid + 1e-9) * grid : beat);
