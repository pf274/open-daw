/**
 * Tremor: a periodic pitch wobble stored per note as `tremor: { depth, rate }`.
 *   depth — cents either side of the pitch (100 = ±1 semitone)
 *   rate  — wobbles per second (Hz)
 * Audible in playback and audio export; ignored by the MIDI writer.
 */
import { clamp } from './music.js';

export const TREMOR_LIMITS = { depth: [1, 100], rate: [1, 12] };
export const DEFAULT_TREMOR = { depth: 30, rate: 5.5 };

export const hasTremor = (n) => !!(n.tremor && n.tremor.depth > 0);

export function normalizeTremor({ depth, rate }) {
  return {
    depth: Math.round(clamp(+depth || 0, ...TREMOR_LIMITS.depth)),
    rate: Math.round(clamp(+rate || DEFAULT_TREMOR.rate, ...TREMOR_LIMITS.rate) * 10) / 10,
  };
}

/**
 * Tremor automation for a voice covering `notes` (one note, or a slide chain).
 * @param at beat → seconds
 * @returns [{ from, depth, rate }] or null when no note has tremor
 */
export function tremorSegments(notes, at) {
  if (!notes.some(hasTremor)) return null;
  return notes.map((n) => ({
    from: at(n.start),
    depth: hasTremor(n) ? n.tremor.depth : 0,
    rate: hasTremor(n) ? n.tremor.rate : DEFAULT_TREMOR.rate,
  }));
}
