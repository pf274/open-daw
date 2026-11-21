/** Quantize note starts (and optionally ends) toward a grid, in place. strength 0..1 */
export function quantizeNotes(notes, grid, strength, lengths) {
  if (!grid) return;
  for (const n of notes) {
    const end = n.start + n.dur;
    const qs = Math.round(n.start / grid) * grid;
    n.start = n.start + (qs - n.start) * strength;
    if (lengths) {
      const qe = Math.round(end / grid) * grid;
      const ne = end + (qe - end) * strength;
      n.dur = Math.max(grid, ne - n.start);
    }
  }
}
