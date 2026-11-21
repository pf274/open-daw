/**
 * Keeps the sampled piano ready: downloads the recordings for every piano note the project
 * uses (plus the middle of the keyboard, for live playing), in the background.
 * The audio layer only ever uses samples that are already loaded (see audio/piano.js).
 */
import { reactive, watch } from 'vue';
import { loadSample, sampleNote } from '../audio/gmSamples.js';
import { PIANO_PROGRAM, setPianoSamples } from '../audio/piano.js';
import { project, soundPitch } from '../stores/project.js';

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
