/**
 * Slides (portamento) between notes.
 *
 * A note with `slideTo: <id>` glides into that note. A chain of connected notes is
 * played as ONE voice whose pitch moves from note to note. Slides are ignored by the
 * MIDI writer; they are audible in playback and audio export.
 *
 * A link is only honoured when the target exists and starts after the source,
 * so links can never form cycles and moved/deleted notes simply drop their slide.
 */

/** @returns {{ next: Map<id, note>, prev: Map<id, note> }} valid links within one track */
export function slideLinks(notes) {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const next = new Map(), prev = new Map();
  for (const n of notes) {
    if (n.slideTo == null) continue;
    const t = byId.get(n.slideTo);
    if (!t || t === n || t.start <= n.start + 1e-9) continue;
    next.set(n.id, t);
    prev.set(t.id, n);
  }
  return { next, prev };
}

/** Follow links from `head`: [head, n1, n2, …] */
export function buildChain(head, next) {
  const chain = [head];
  let cur = head;
  while (next.has(cur.id) && chain.length < 100000) {
    cur = next.get(cur.id);
    chain.push(cur);
  }
  return chain;
}

/**
 * The voices notes will actually play as: one span per note, except that a slide chain
 * is a single voice from its first note's start to its last note's end.
 * @returns [{ start, end }] in beats
 */
export function voiceSpans(notes) {
  const { next, prev } = slideLinks(notes);
  return notes
    .filter((n) => !prev.has(n.id))
    .map((n) => {
      const chain = buildChain(n, next), last = chain[chain.length - 1];
      return { start: n.start, end: last.start + last.dur };
    });
}

/** At least two notes, and no two of them overlap in time. */
export function canConnect(notes) {
  if (notes.length < 2) return false;
  const s = [...notes].sort((a, b) => a.start - b.start);
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i].start + s[i].dur > s[i + 1].start + 1e-6) return false;
  }
  return true;
}

/** Link each note to the next one in time (mutates). */
export function connectNotes(notes) {
  const s = [...notes].sort((a, b) => a.start - b.start);
  for (let i = 0; i < s.length - 1; i++) s[i].slideTo = s[i + 1].id;
}

/**
 * Pitch glides for a chain, in audio time.
 *  - Gap between notes: the glide fills the gap.
 *  - Back-to-back (gap < minGap): the glide is centred on the boundary, so both notes give
 *    up the same time — `glide / 2` each, capped at half of either note so consecutive
 *    glides in a chain never overlap.
 * @param at  beat → seconds
 * @returns [{ from, to, pitch }]
 */
export function glideSegments(chain, at, spb, { minGap = 0.03, glide = 0.08 } = {}) {
  const out = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i], b = chain[i + 1];
    let from = at(a.start + a.dur);
    let to = at(b.start);
    if (to - from < minGap) {
      const centre = (from + to) / 2;
      const half = Math.min(glide / 2, (a.dur * spb) / 2, (b.dur * spb) / 2);
      from = centre - half;
      to = centre + half;
    }
    out.push({ from, to, pitch: b.pitch });
  }
  return out;
}

/** Copy notes with fresh ids, remapping slides inside the copied set and dropping the rest. */
export function cloneNotes(notes, nid, shift = 0) {
  const ids = new Map(notes.map((n) => [n.id, nid()]));
  return notes.map((n) => {
    const c = { ...n, id: ids.get(n.id), start: n.start + shift };
    if (c.tremor) c.tremor = { ...c.tremor }; // don't share nested objects between copies
    if (c.slideTo != null) {
      if (ids.has(c.slideTo)) c.slideTo = ids.get(c.slideTo);
      else delete c.slideTo;
    }
    return c;
  });
}
