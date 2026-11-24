/**
 * Keeps recordings ready: downloads, in the background, the files for every note the project's
 * piano layers and recorded-instrument layers use (plus the middle of the keyboard, for live playing).
 * The audio layer only ever uses samples that are already loaded (see audio/piano.js, audio/recorded.js).
 */
import { reactive, watch } from 'vue';
import { loadSample, sampleNote } from '../audio/gmSamples.js';
import { PIANO_PROGRAM, setPianoSamples } from '../audio/piano.js';
import { project, soundPitch } from '../stores/project.js';
import { clampProgram } from '../audio/recorded.js';

export const pianoSamples = reactive({ loading: 0, loaded: 0, failed: false });

const CORE_RANGE = [48, 84]; // C3–C6: preloaded as soon as a piano layer exists
const isPiano = (layer) => layer.inst === 'piano';

/** Every (transposed) piano note the project plays. */
export function wantedPianoNotes() {
  const notes = new Set();
  for (const p of project.patterns) {
    for (const l of p.layers) if (isPiano(l)) for (const n of l.notes) notes.add(sampleNote(soundPitch(l, n.pitch)));
  }
  return notes;
}
const hasPiano = () => project.patterns.some((p) => p.layers.some(isPiano));

/** Load these notes' samples; resolves when all have finished (failures are counted, not thrown). */
export async function ensurePianoSamples(notes) {
  const list = [...notes];
  pianoSamples.loading += list.length;
  const results = await Promise.allSettled(list.map((m) => loadSample(PIANO_PROGRAM, m)));
  pianoSamples.loading -= list.length;
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  pianoSamples.loaded += ok;
  pianoSamples.failed = ok < list.length;
  return { ok, failed: list.length - ok };
}

/** The notes `layers` (from files.playedLayers) need, e.g. before rendering a WAV. */
export function pianoNotesFor(played) {
  const notes = new Set();
  for (const { layer } of played) if (isPiano(layer)) for (const n of layer.notes) notes.add(sampleNote(soundPitch(layer, n.pitch)));
  return notes;
}

/** Follow the setting and the project: preload what piano layers will need. */
export function installPianoPreload() {
  watch(
    () => [project.settings.sampledPiano !== false, hasPiano(), [...wantedPianoNotes()].sort((a, b) => a - b).join(',')],
    ([on, piano]) => {
      setPianoSamples(on);
      if (!on || !piano) return;
      const notes = wantedPianoNotes();
      for (let m = CORE_RANGE[0]; m <= CORE_RANGE[1]; m++) notes.add(m);
      ensurePianoSamples(notes);
    },
    { immediate: true },
  );
}

/* ---------------- recorded instruments (any GM program) ---------------- */
export const recordedSamples = reactive({ loading: 0, failed: false });
const RECORDED_CORE = [60, 72]; // C4–C5: preloaded per recorded instrument, for clicking the keyboard strip
const isRecorded = (layer) => layer.inst === 'recorded';

/** Add a layer's (transposed) notes to a Map program → Set of notes. */
function addNotes(map, layer) {
  const program = clampProgram(layer.program);
  if (!map.has(program)) map.set(program, new Set());
  const set = map.get(program);
  for (const n of layer.notes) set.add(sampleNote(soundPitch(layer, n.pitch)));
  return set;
}
/** Every note each recorded instrument in the project plays: Map program → Set of notes. */
export function wantedRecordedNotes() {
  const map = new Map();
  for (const p of project.patterns) for (const l of p.layers) if (isRecorded(l)) addNotes(map, l);
  return map;
}
/** The notes `played` (from files.playedLayers) need, e.g. before rendering a WAV. */
export function recordedNotesFor(played) {
  const map = new Map();
  for (const { layer } of played) if (isRecorded(layer)) addNotes(map, layer);
  return map;
}

/** Load the files for Map program → notes; resolves when all have finished (failures are counted). */
export async function ensureRecordedSamples(map) {
  const jobs = [];
  for (const [program, notes] of map) for (const m of notes) jobs.push(loadSample(program, m));
  if (!jobs.length) return { ok: 0, failed: 0 };
  recordedSamples.loading += jobs.length;
  const results = await Promise.allSettled(jobs);
  recordedSamples.loading -= jobs.length;
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  recordedSamples.failed = ok < jobs.length;
  return { ok, failed: jobs.length - ok };
}

/** Follow the project: preload what recorded-instrument layers will need. */
export function installRecordedPreload() {
  watch(
    () => [...wantedRecordedNotes()].map(([p, notes]) => `${p}:${[...notes].sort((a, b) => a - b).join(',')}`).join(' '),
    () => {
      const map = wantedRecordedNotes();
      for (const notes of map.values()) for (let m = RECORDED_CORE[0]; m <= RECORDED_CORE[1]; m++) notes.add(m);
      ensureRecordedSamples(map);
    },
    { immediate: true },
  );
}
