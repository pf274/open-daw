/**
 * Song view actions: switching between the Song and Pattern views, managing patterns,
 * song tracks and clips. Every edit is undoable.
 */
import { cloneNotes } from '../core/slides.js';
import { snapFloor } from '../core/meter.js';
import {
  project, nid, curPattern, patternById, makePattern, setCurPattern, makeSongTrack, songTrackById,
  patternLength, isDrum, barLen, beatLen, rowKey, normalizeOrder, orderKeys, orderedTracks, clipLength, clipTarget, soundById,
  fullClipLength, clipTrim, MIN_CLIP, makeSection, sortedSections,
} from '../stores/project.js';
import { ui, status, saveView } from '../stores/ui.js';
import { pushUndo } from '../stores/history.js';
import { viewDrums } from '../stores/view.js';
import { transport, stopTransport } from './transport.js';
import { pick, exitPick } from './pick.js';

/** Drag-and-drop type for dragging a pattern from the list onto the song. */
export const PATTERN_MIME = 'application/x-whistle-pattern';

/* ---------------- views ---------------- */
export function setView(view) {
  if (ui.view === view) return;
  if (transport.playing) stopTransport();
  if (pick.active) exitPick();
  ui.ctxMenu.open = false;
  ui.view = view;
  saveView();
  if (view === 'pattern' && isDrum(project.tracks.find((t) => t.id === project.sel))) viewDrums();
}

/** Open a pattern in the pattern editor. */
export function editPattern(id) {
  if (!patternById(id)) return;
  setCurPattern(id);
  ui.sel.clear();
  setView('pattern');
  status(`Editing "${patternById(id).name}".`);
}

/** Switch which pattern the editor shows (staying in the pattern view). */
export function selectPattern(id) {
  if (transport.playing) stopTransport();
  if (pick.active) exitPick();
  setCurPattern(id);
  ui.sel.clear();
}

/* ---------------- patterns ---------------- */
/** A copy of a layer with fresh ids (slides between copied notes are kept). */
function copyLayer(l, { notes = true } = {}) {
  return { ...l, id: nid(), notes: notes ? cloneNotes(l.notes, nid) : [], take: null, ...(l.synth ? { synth: { ...l.synth, filters: l.synth.filters?.map((f) => ({ ...f, env: { ...f.env } })) } } : {}) };
}

/** New empty pattern with the same instruments as `fromId` (default: the current pattern). */
export function newPattern(fromId) {
  const src = patternById(fromId) || curPattern();
  pushUndo();
  const p = makePattern(null, src.layers.map((l) => copyLayer(l, { notes: false })));
  project.patterns.push(p);
  status(`Created "${p.name}" with the same instruments as "${src.name}" — click Edit to write notes.`);
  return project.patterns[project.patterns.length - 1];
}

export function duplicatePattern(id) {
  const src = patternById(id);
  if (!src) return null;
  pushUndo();
  const p = makePattern(`${src.name} copy`, src.layers.map((l) => copyLayer(l)));
  project.patterns.splice(project.patterns.indexOf(src) + 1, 0, p);
  status(`Duplicated "${src.name}".`);
  return p;
}

export function deletePattern(id) {
  const p = patternById(id);
  if (!p) return false;
  if (project.patterns.length === 1) { status('A project needs at least one pattern.', true); return false; }
  pushUndo();
  const n = project.song.clips.filter((c) => c.patternId === id).length;
  project.song.clips = project.song.clips.filter((c) => c.patternId !== id);
  project.patterns = project.patterns.filter((x) => x.id !== id);
  if (project.curPattern === id) { // the editor was showing it: open the first pattern instead
    const first = project.patterns[0];
    project.curPattern = first.id;
    project.sel = first.layers.some((l) => l.id === first.sel) ? first.sel : first.layers[0]?.id ?? null;
    ui.sel.clear();
  }
  status(`Deleted "${p.name}"${n ? ` and its ${n} clip${n === 1 ? '' : 's'} in the song` : ''}.`);
  return true;
}

export const clipCount = (patternId) => project.song.clips.filter((c) => c.patternId === patternId).length;

/* ---------------- song tracks ---------------- */
export function addSongTrack() {
  pushUndo();
  const t = makeSongTrack();
  project.song.tracks.push(t);
  normalizeOrder(project.song); // appended at the bottom
  return t;
}

export function removeSongTrack(id) {
  if (project.song.tracks.length === 1) { status('The song needs at least one track.', true); return false; }
  pushUndo();
  project.song.clips = project.song.clips.filter((c) => c.trackId !== id);
  project.song.tracks = project.song.tracks.filter((t) => t.id !== id);
  for (const a of project.song.automation) a.targets = a.targets.filter((t) => t !== id); // no dangling targets
  normalizeOrder(project.song);
  return true;
}

/* ---------------- clips ---------------- */
/** Song-view grid, in quarter-note beats (0 = off). */
/** Song snap: a whole bar, or a number of counted beats of the time signature (eighths in 6/8). */
export const SONG_SNAPS = [{ value: 'bar', label: '1 bar' }, { value: 1, label: '1 beat' }, { value: 0.5, label: '½ beat' }, { value: 0.25, label: '¼ beat' }, { value: 0, label: 'off' }];
export const songGrid = () => (ui.songSnap === 'bar' ? barLen() : ui.songSnap > 0 ? beatLen() * ui.songSnap : 0);
/** Fine adjustment step (Ctrl/⌘ held): 1/64 of a beat, whatever the song snap. */
export const FINE_GRID = 1 / 64;
/** Is the fine-adjustment modifier (Ctrl, or ⌘ on a Mac) held for this event? */
export const isFine = (e) => !!(e && (e.ctrlKey || e.metaKey));
/** The step positions snap to: the song grid, or the fine step when `fine` (with snap off, 1/32 of a beat to keep numbers tidy). */
export const placeGrid = (fine = false) => (fine ? FINE_GRID : songGrid() || 1 / 32);
/** Snap a song position down to the grid (or to the fine step when `fine`). */
export const snapSong = (beat, fine = false) => Math.max(0, snapFloor(beat, placeGrid(fine)));

/** Place a pattern on a song track at `start` (beats, snapped down to the song grid). */
export function addClip(trackId, patternId, start, { fine = false } = {}) {
  if (!songTrackById(trackId) || !patternById(patternId)) return null;
  pushUndo();
  const c = { id: nid(), trackId, patternId, start: snapSong(start, fine) };
  project.song.clips.push(c);
  ui.songSel = new Set([c.id]);
  return c;
}

const selectedClips = () => project.song.clips.filter((c) => ui.songSel.has(c.id));

/** Place an imported sound on a song track at `start` (snapped down to the song grid). */
export function addSoundClip(trackId, soundId, start, { fine = false } = {}) {
  if (!songTrackById(trackId) || !soundById(soundId)) return null;
  pushUndo();
  const c = { id: nid(), trackId, soundId, start: snapSong(start, fine) };
  project.song.clips.push(c);
  ui.songSel = new Set([c.id]);
  return c;
}
/** Drag-and-drop type for dragging a sound from the list onto the song. */
export const SOUND_MIME = 'application/x-whistle-sound';

/**
 * ←/→: move the selected clips one song-grid step (a beat with snap off); `fine` (Ctrl/⌘) moves
 * them 1/64 beat. The block stops at the start of the song.
 */
export function nudgeSelectedClips(dir, fine = false) {
  const sel = selectedClips();
  if (!sel.length) return;
  const step = fine ? FINE_GRID : songGrid() || beatLen();
  const d = Math.max(-Math.min(...sel.map((c) => c.start)), dir * step);
  if (Math.abs(d) < 1e-9) return;
  pushUndo();
  for (const c of sel) c.start = Math.round((c.start + d) / FINE_GRID) * FINE_GRID; // keep positions on the fine grid
}

export function deleteSelectedClips() {
  const n = ui.songSel.size;
  if (!n) return;
  pushUndo();
  project.song.clips = project.song.clips.filter((c) => !ui.songSel.has(c.id));
  ui.songSel.clear();
  status(`Removed ${n} clip${n === 1 ? '' : 's'}.`);
}

/** Copies of the selection placed right after it (by whole bars). */
export function duplicateSelectedClips() {
  const sel = selectedClips();
  if (!sel.length) return;
  pushUndo();
  const start = Math.min(...sel.map((c) => c.start));
  const end = Math.max(...sel.map((c) => c.start + clipLength(c)));
  const shift = Math.ceil((end - start) / barLen() - 1e-9) * barLen(); // keeps copies on the same beat of the bar
  const copies = sel.map((c) => ({ ...c, id: nid(), start: c.start + shift }));
  project.song.clips.push(...copies);
  ui.songSel = new Set(copies.map((c) => c.id));
}

export const selectAllClips = () => { ui.songSel = new Set(project.song.clips.map((c) => c.id)); };

/* ---------------- clip clipboard ---------------- */
// Clips are remembered relative to the earliest start and the topmost track (in display order),
// so a paste keeps their arrangement wherever it lands.
export function copySelectedClips() {
  const sel = selectedClips();
  if (!sel.length) return false;
  const tracks = orderedTracks();
  const lane = (c) => tracks.findIndex((t) => t.id === c.trackId);
  const start = Math.min(...sel.map((c) => c.start)), top = Math.min(...sel.map(lane));
  const end = Math.max(...sel.map((c) => c.start + clipLength(c)));
  ui.clipClipboard = {
    clips: sel.map((c) => ({ ...(c.soundId != null ? { soundId: c.soundId } : { patternId: c.patternId }), ...trimOf(c), offset: c.start - start, lane: lane(c) - top })),
    length: end - start, // how far the playhead moves after a paste
    top,                 // where they came from: a plain paste goes back onto the same tracks
  };
  status(`Copied ${sel.length} clip${sel.length === 1 ? '' : 's'}.`);
  return true;
}
export function cutSelectedClips() {
  if (copySelectedClips()) deleteSelectedClips();
}
/**
 * Paste the clipboard with its first clip at `at` (default: the song playhead) and its top clip on
 * track `lane` (default: the track it was copied from). Then the playhead moves to the end of the
 * pasted block, so pasting again lays the next copy right after it.
 */
export function pasteClips({ at = ui.songPlayhead, lane = ui.clipClipboard?.top ?? 0 } = {}) {
  const cb = ui.clipClipboard;
  if (!cb?.clips.length) { status('Nothing to paste: copy some clips first (Ctrl+C).', true); return []; }
  const tracks = orderedTracks();
  const live = cb.clips.filter((c) => clipTarget(c)); // skip patterns/sounds deleted since copying
  if (!live.length || !tracks.length) { status('The copied patterns or sounds no longer exist.', true); return []; }
  const span = Math.max(...live.map((c) => c.lane));
  const top = Math.max(0, Math.min(lane, tracks.length - 1 - span)); // keep the block on existing tracks
  pushUndo();
  const start = Math.max(0, at);
  const made = live.map((c) => ({ id: nid(), trackId: tracks[Math.min(tracks.length - 1, top + c.lane)].id, ...(c.soundId != null ? { soundId: c.soundId } : { patternId: c.patternId }), ...trimOf(c), start: start + c.offset }));
  project.song.clips.push(...made);
  ui.songSel = new Set(made.map((c) => c.id));
  ui.songPlayhead = start + cb.length;
  status(`Pasted ${made.length} clip${made.length === 1 ? '' : 's'}. Paste again to add another copy after them.`);
  return made;
}

/** Select a pattern (for placing with double-click) without leaving the Song view. `quiet`: no status message (e.g. selecting one of its clips). */
export function choosePattern(id, { quiet = false } = {}) {
  if (!patternById(id)) return;
  ui.placeSound = null; // the pattern is what gets placed now
  if (project.curPattern === id) return;
  setCurPattern(id);
  ui.sel.clear();
  if (!quiet) status(`Selected "${patternById(id).name}": drag it onto a track, or double-click an empty spot to place it.`);
}

/** Select a sound to place with double-click / double-tap (a touch screen can't drag it from the list). */
export function chooseSound(id, { quiet = false } = {}) {
  const s = soundById(id);
  if (!s) return;
  ui.placeSound = id;
  if (!quiet) status(`Selected "${s.name}": double-click (or double-tap) an empty spot on a track to place it.`);
}

/* ---------------- truncating clips ---------------- */
/** A clip's truncation, as stored (only what differs from playing the whole pattern/sound). */
const trimOf = (c) => ({ ...(c.trim > 0 ? { trim: c.trim } : {}), ...(c.len > 0 ? { len: c.len } : {}) });

/**
 * Set where a clip's visible part begins and ends on the timeline (song beats), cutting its pattern
 * or sound short at either end. The content stays where it was: moving the left edge right hides
 * the beginning rather than sliding the notes. Clamped to the pattern/sound itself (can't grow
 * past it) and to at least MIN_CLIP. No undo step (callers take one).
 */
export function setClipEdges(clip, from, to) {
  const full = fullClipLength(clip);
  if (!full) return;
  const origin = clip.start - clipTrim(clip); // where the pattern's beat 0 sits
  const lo = Math.max(0, origin), hi = origin + full;
  from = Math.min(Math.max(from, lo), hi - MIN_CLIP);
  to = Math.min(Math.max(to, from + MIN_CLIP), hi);
  const trim = from - origin, len = to - from;
  clip.start = from;
  if (trim > 1e-9) clip.trim = trim; else delete clip.trim;
  if (full - trim - len > 1e-9) clip.len = len; else delete clip.len; // reaches the end: follow the pattern if it grows
}

/** Undo truncation of the selected clips: play their whole pattern/sound again (from where it started). */
export function untrimSelectedClips() {
  const sel = selectedClips().filter((c) => c.trim > 0 || c.len > 0);
  if (!sel.length) return;
  pushUndo();
  for (const c of sel) {
    c.start = Math.max(0, c.start - clipTrim(c));
    delete c.trim;
    delete c.len;
  }
  status(`Restored the full length of ${sel.length} clip${sel.length === 1 ? '' : 's'}.`);
}
export const isTrimmed = (c) => c.trim > 0 || c.len > 0;

/* ---------------- song sections ---------------- */
/** The free span around `beat` between neighbouring sections (ignoring section `exceptId`): [lo, hi). */
export function sectionGap(beat, exceptId = null) {
  let lo = 0, hi = Infinity;
  for (const x of sortedSections()) {
    if (x.id === exceptId) continue;
    if (x.end <= beat + 1e-9) lo = Math.max(lo, x.end);
    else if (x.start >= beat - 1e-9) hi = Math.min(hi, x.start);
    else return null; // inside another section
  }
  return [lo, hi];
}
/** Add a labelled section over [start, end) beats (fitted into the free space there). */
export function addSection(start, end, name) {
  const gap = sectionGap(start);
  if (!gap) return null;
  start = Math.max(gap[0], start);
  end = Math.min(gap[1], end);
  if (end - start < MIN_CLIP) return null;
  pushUndo();
  const x = makeSection(start, end, name);
  project.song.sections.push(x);
  return project.song.sections.at(-1);
}
export function removeSection(id) {
  if (!project.song.sections.some((x) => x.id === id)) return false;
  pushUndo();
  project.song.sections = project.song.sections.filter((x) => x.id !== id);
  return true;
}

/* ---------------- row order ---------------- */
/** Move a row (pattern track or automation track, by its row key) to position `to` in the display order. */
export function moveRow(key, to) {
  const order = orderKeys(project.song);
  const from = order.indexOf(key);
  to = Math.max(0, Math.min(order.length - 1, to));
  if (from < 0 || from === to) return false;
  pushUndo();
  order.splice(to, 0, ...order.splice(from, 1));
  project.song.order = order;
  return true;
}
/** Move a row up (−1) or down (+1). */
export const moveRowBy = (key, d) => moveRow(key, orderKeys(project.song).indexOf(key) + d);
export { rowKey };

/** Give one clip its own copy of its pattern (to make a variation without changing the others). */
export function makeClipUnique(clipId) {
  const clip = project.song.clips.find((c) => c.id === clipId);
  const src = clip && patternById(clip.patternId);
  if (!src) return null;
  pushUndo();
  const p = makePattern(`${src.name} (variation)`, src.layers.map((l) => copyLayer(l)));
  project.patterns.splice(project.patterns.indexOf(src) + 1, 0, p);
  clip.patternId = p.id;
  status(`This clip now plays "${p.name}". Edit it without changing the other "${src.name}" clips.`);
  return p;
}
