/** Snapshot-based undo/redo. Call pushUndo() *before* a mutation you want undoable. */
import { reactive, toRaw } from 'vue';
import { project } from './project.js';
import { ui, status } from './ui.js';

const undoStack = [];
const redoStack = [];
export const history = reactive({ canUndo: false, canRedo: false });

// takes and synth patches are only ever replaced, never mutated: share them by reference
const copyLayer = (t) => ({ ...t, notes: t.notes.map((n) => ({ ...n })) });
const copyPatterns = (pats) => pats.map((p) => ({ ...p, layers: p.layers.map(copyLayer) }));
const copySong = (s) => ({
  tracks: s.tracks.map((t) => ({ ...t })),
  clips: s.clips.map((c) => ({ ...c })),
  automation: (s.automation || []).map((a) => ({ ...a, targets: [...a.targets], points: a.points.map((p) => ({ ...p })), options: a.options ? { ...a.options } : null })),
  order: [...(s.order || [])],
  sections: (s.sections || []).map((x) => ({ ...x })),
});

/** Everything undoable: all patterns (and their layers/notes), the song, tempo, transpose. */
function snapshot() {
  const p = toRaw(project);
  return {
    bpm: p.bpm, transpose: p.transpose, timeSig: { ...p.timeSig }, sel: p.sel, curPattern: p.curPattern,
    patterns: copyPatterns(p.patterns),
    song: copySong(p.song),
    sounds: (p.sounds || []).map((s) => ({ ...s })),
  };
}
function restore(s) {
  project.bpm = s.bpm;
  project.transpose = s.transpose || 0;
  project.timeSig = { ...s.timeSig };
  project.patterns = copyPatterns(s.patterns);
  project.song = copySong(s.song);
  project.sounds = (s.sounds || []).map((x) => ({ ...x }));
  project.curPattern = s.patterns.some((p) => p.id === s.curPattern) ? s.curPattern : s.patterns[0]?.id;
  project.sel = s.sel;
  ui.sel.clear();
  ui.songSel.clear();
  ui.autoSel = null;
}
function sync() {
  history.canUndo = undoStack.length > 0;
  history.canRedo = redoStack.length > 0;
}

export function pushUndo() {
  commitUndo(snapshot());
}

/**
 * Two-step undo for gestures that may turn out to change nothing (e.g. a click that
 * never becomes a drag): take the snapshot up front, commit it only once something
 * actually changes. Until then undo/redo history is untouched — in particular the
 * redo stack survives a plain click.
 */
export const takeSnapshot = snapshot;
export function commitUndo(snap) {
  undoStack.push(snap);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  sync();
}
export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  sync();
  status('Undo');
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  sync();
  status('Redo');
}
export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  sync();
}

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
