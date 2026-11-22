export const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

/** The scale choice that lets you pick the notes yourself (settings.customNotes). */
export const CUSTOM_SCALE = 'custom';

/**
 * The pitch classes (0 = C … 11 = B) notes may snap to, from the project settings:
 * the chosen scale in the chosen key, or the notes picked for the custom scale.
 * An empty custom set means every note (no snapping).
 */
export function scaleNotes(s) {
  if (s.scale === CUSTOM_SCALE) return s.customNotes?.length ? [...s.customNotes].sort((a, b) => a - b) : SCALES.chromatic;
  const root = +s.scaleRoot || 0;
  return (SCALES[s.scale] || SCALES.chromatic).map((pc) => (pc + root) % 12).sort((a, b) => a - b);
}

/** Snap a (fractional) midi value to the nearest integer note whose pitch class is in `notes`. */
export function snapToNotes(m, notes) {
  const base = Math.round(m);
  if (!notes?.length) return base;
  let best = base, bestD = Infinity;
  for (let n = base - 12; n <= base + 12; n++) {
    if (!notes.includes(((n % 12) + 12) % 12)) continue;
    const d = Math.abs(n - m);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/** Snap a (fractional) midi value to the nearest in-scale integer note. */
export const snapToScale = (m, root, scaleName) => snapToNotes(m, scaleNotes({ scaleRoot: root, scale: scaleName }));
