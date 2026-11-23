/**
 * Turning a recorded take into notes.
 *
 * take: { bpm, startBeat, endT, frames:[{t,midi,c}], taps:[{down,up}], mode? ('whistle' | 'hum') }
 *   times are seconds where 0 = startBeat; frames.midi is 0 when unvoiced.
 * settings: the project's alignment settings (see stores/project.js DEFAULT_SETTINGS)
 */
import { scaleNotes, snapToNotes } from './scales.js';
import { pitchShift } from './voice.js';

/**
 * Average that ignores the outliers: the mean of the middle 60 % of the values (the lowest and
 * highest fifth dropped), so a scoop into a note, a breath or an octave slip barely moves it.
 */
export function trimmedMean(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const cut = a.length >= 5 ? Math.floor(a.length * 0.2) : 0;
  const mid = a.slice(cut, a.length - cut);
  return mid.reduce((sum, x) => sum + x, 0) / mid.length;
}

export function median(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/** Note slots from taps: [{t, end, prevT, nextT}] in seconds. Shared by whistle + rhythm modes. */
export function tapSlots(take, s) {
  const taps = take.taps.slice().sort((a, b) => a.down - b.down);
  const shift = (s.tapShift || 0) / 1000;
  const downs = taps.map((t) => t.down + shift);
  const spb = 60 / take.bpm;
  return taps.map((tap, i) => {
    const t = downs[i];
    const nextT = i + 1 < taps.length ? downs[i + 1] : Infinity;
    const prevT = i > 0 ? downs[i - 1] : -Infinity;
    const up = tap.up != null ? tap.up + shift : null;
    let end;
    if (s.durMode === 'fixed') end = t + s.fixedBeats * spb;
    else if (s.durMode === 'hold') end = up != null ? up : Math.min(nextT, take.endT);
    else end = nextT < Infinity ? nextT - (s.gapMs || 0) / 1000 : (up != null ? up : take.endT);
    end = Math.max(end, t + 0.05);
    if (s.durMode === 'hold' && nextT < Infinity) end = Math.min(end, nextT);
    return { t, end, prevT, nextT };
  });
}

/** Rhythm only: [{start, dur}] in beats. */
export function rhythmFromTaps(take, s) {
  const spb = 60 / take.bpm;
  return tapSlots(take, s).map(({ t, end }) => ({
    start: take.startBeat + t / spb,
    dur: Math.max(0.0625, (end - t) / spb),
  }));
}

/**
 * Whistle + taps → { notes:[{start,dur,pitch,vel}], skipped } (beats).
 * Each note's pitch: s.pitchFrom 'note' (default) averages the pitch over the whole note;
 * 'window' takes the median in a short window around its tap (s.winStart / s.winLen).
 */
export function alignTake(take, s) {
  const notes = [];
  let skipped = 0;
  const spb = 60 / take.bpm;
  const voiced = take.frames.filter((f) => f.midi > 0 && f.c >= s.minClarity);

  const wholeNote = s.pitchFrom !== 'window';
  for (const { t, end, prevT, nextT } of tapSlots(take, s)) {
    let wStart, wEnd;
    if (wholeNote) { // the whole note: from its tap to its end (never into the next note)
      wStart = t;
      wEnd = Math.min(end, nextT);
    } else { // a window around the tap, never reaching into neighbouring notes
      wStart = Math.max(t + s.winStart / 1000, prevT === -Infinity ? -Infinity : (prevT + t) / 2);
      wEnd = Math.min(t + s.winLen / 1000, nextT);
    }
    let sel = voiced.filter((f) => f.t >= wStart && f.t <= wEnd);
    if (!sel.length) {
      // fall back to the nearest voiced frame within 400 ms
      let best = null, bd = 0.4;
      for (const f of voiced) {
        const d = Math.abs(f.t - t);
        if (d < bd) { bd = d; best = f; }
      }
      if (best) sel = [best];
    }
    if (!sel.length) { skipped++; continue; }
    // average pitch over the note (in semitones, i.e. the average on a musical scale), or the window's median
    let m = (wholeNote ? trimmedMean : median)(sel.map((f) => f.midi)) + pitchShift(s, take);
    m = snapToNotes(m, scaleNotes(s));
    m = Math.max(0, Math.min(127, m));
    notes.push({
      start: take.startBeat + t / spb,
      dur: Math.max(0.0625, (end - t) / spb),
      pitch: m,
      vel: s.vel || 96,
    });
  }
  return { notes, skipped };
}
