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

/** Snap a (fractional) midi value to the nearest in-scale integer note. */
export function snapToScale(m, root, scaleName) {
  const sc = SCALES[scaleName] || SCALES.chromatic;
  const base = Math.round(m);
  let best = base, bestD = Infinity;
  for (let n = base - 7; n <= base + 7; n++) {
    const pc = (((n - root) % 12) + 12) % 12;
    if (!sc.includes(pc)) continue;
    const d = Math.abs(n - m);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}
