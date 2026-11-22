/**
 * Note-editing operations on the current layer. Each action is undoable.
 * Add new operations to ACTIONS; the context menu (menus/noteMenu.js) and keyboard call into it.
 */
import { clamp, transposeLabel } from '../core/music.js';
import { normalizeTimeSig, formatTimeSig, barBeats } from '../core/meter.js';
import { quantizeNotes } from '../core/quantize.js';
import { scaleNotes, snapToNotes } from '../core/scales.js';
import { canConnect, connectNotes, cloneNotes } from '../core/slides.js';
import { DEFAULT_TREMOR, hasTremor, normalizeTremor } from '../core/tremor.js';
import { project, curTrack, nid, isDrum } from '../stores/project.js';
import { ui, status, selNotes, grid } from '../stores/ui.js';
import { pushUndo } from '../stores/history.js';
import { audition } from './mix.js';
import { transport, stopTransport } from './transport.js';
import { pick, enterPick, exitPick } from './pick.js';

const sortNotes = (tr) => tr.notes.sort((a, b) => a.start - b.start);

/** Run fn(selectedNotes, track) as one undoable edit. */
export function edit(fn, msg) {
  const notes = selNotes();
  if (!notes.length) { status('Select some notes first (drag a box, Ctrl+A, or right-click → Select).', true); return false; }
  pushUndo();
  fn(notes, curTrack());
  sortNotes(curTrack());
  if (msg) status(msg);
  return true;
}

export function transposeSel(d) {
  if (edit((ns) => ns.forEach((n) => (n.pitch = clamp(n.pitch + d, 0, 127))))) {
    const n = selNotes()[0];
    if (n) audition(curTrack(), n.pitch, n.vel);
  }
}

function stretch(f) {
  edit((ns) => {
    const s = Math.min(...ns.map((n) => n.start));
    ns.forEach((n) => { n.start = s + (n.start - s) * f; n.dur *= f; });
  });
}

export function copySel() {
  const ns = selNotes();
  if (!ns.length) return;
  const s = Math.min(...ns.map((n) => n.start));
  ui.clipboard = ns.map((n) => ({ ...n, start: n.start - s }));
  status(`Copied ${ns.length} notes.`);
}

export function paste(at) {
  if (!ui.clipboard) { status('Clipboard is empty.', true); return; }
  const where = at == null ? ui.playhead : at;
  pushUndo();
  const tr = curTrack();
  const copies = cloneNotes(ui.clipboard, nid, where); // slides inside the clipboard survive
  tr.notes.push(...copies);
  sortNotes(tr);
  ui.sel = new Set(copies.map((c) => c.id));
  status(at == null ? 'Pasted at playhead.' : 'Pasted.');
}

/* ---------- quantize ---------- */
const qGrid = (s) => s.grid || grid();
const qStrength = (s) => clamp(+s.strength || 0, 0, 100) / 100;

/** Quantized copies of the selection (for preview) — nothing is changed. */
export function quantizedCopies(s = ui.quantizeModal) {
  const copies = selNotes().map((n) => ({ ...n }));
  quantizeNotes(copies, qGrid(s), qStrength(s), s.ends);
  return copies;
}

export function openQuantize() {
  if (!selNotes().length) { status('Select some notes first.', true); return; }
  Object.assign(ui.quantizeModal, { open: true, ...ui.quantize });
}

/** Apply and remember the settings (so Q repeats them). */
export function applyQuantize(s) {
  ui.quantize = { grid: +s.grid || 0, strength: clamp(+s.strength || 0, 0, 100), ends: !!s.ends };
  edit((ns) => quantizeNotes(ns, qGrid(ui.quantize), qStrength(ui.quantize), ui.quantize.ends), 'Quantized.');
}

/* ---------- velocity ---------- */
export const setVelocity = (v) => edit((ns) => ns.forEach((n) => (n.vel = clamp(Math.round(v), 1, 127))), `Velocity ${v}.`);
export const adjustVelocity = (d) => edit((ns) => ns.forEach((n) => (n.vel = clamp(n.vel + d, 1, 127))), d > 0 ? 'Louder.' : 'Softer.');

/* ---------- song transpose (playback & export only) ---------- */
export function setSongTranspose(t) {
  t = clamp(Math.round(t), -12, 12);
  if (t === project.transpose) return;
  pushUndo();
  project.transpose = t;
  status(t
    ? `Playback and export transposed ${transposeLabel(t, +project.settings.scaleRoot || 0)}. Notes stay as written; drums are unaffected.`
    : 'Song transpose off.');
}

/* ---------- time signature ---------- */
/** Change beats per bar / beat unit. Notes don't move: bars just regroup them (undoable). */
export function setTimeSig(ts) {
  const next = normalizeTimeSig(ts);
  if (next.num === project.timeSig.num && next.den === project.timeSig.den) return;
  pushUndo();
  project.timeSig = next;
  const bar = barBeats(next);
  status(`Time signature ${formatTimeSig(next)}: ${next.num} beat${next.num === 1 ? '' : 's'} per bar (${bar} quarter note${bar === 1 ? '' : 's'}).`);
}

/* ---------- tremor ---------- */
export const canTremorSel = () => !isDrum(curTrack()) && selNotes().length > 0;
export const hasTremorSel = () => selNotes().some(hasTremor);

/** Open the tremor dialog, seeded from the first selected note that already has tremor. */
export function openTremor() {
  if (!canTremorSel()) {
    status(isDrum(curTrack()) ? 'Tremor is not available on drum layers.' : 'Select some notes first.', true);
    return;
  }
  const seed = selNotes().find(hasTremor)?.tremor || DEFAULT_TREMOR;
  Object.assign(ui.tremorModal, { open: true, depth: seed.depth, rate: seed.rate });
}

export function applyTremor({ depth, rate }) {
  const t = normalizeTremor({ depth, rate });
  edit((ns) => ns.forEach((n) => { n.tremor = { ...t }; }), `Tremor ±${t.depth}¢ at ${t.rate} Hz on ${selNotes().length} notes (audible in playback/WAV; ignored in MIDI).`);
}

export const removeTremor = () => edit((ns) => ns.forEach((n) => { delete n.tremor; }), 'Tremor removed.');

/* ---------- slides ---------- */
/** "Connect" is offered for 2+ selected, non-overlapping notes on a melodic layer. */
export const canConnectSel = () => !isDrum(curTrack()) && canConnect(selNotes());
export const hasSlidesSel = () => selNotes().some((n) => n.slideTo != null);
export function connectReason() {
  if (isDrum(curTrack())) return 'Slides are not available on drum layers';
  if (selNotes().length < 2) return 'Select two or more notes';
  if (!canConnect(selNotes())) return 'Selected notes overlap';
  return 'Slide from each selected note into the next (audible in playback and WAV export; ignored in MIDI)';
}

export function moveSelTo(destId) {
  const dest = project.tracks.find((t) => t.id === destId);
  if (!dest) return;
  edit((ns, tr) => {
    tr.notes = tr.notes.filter((n) => !ui.sel.has(n.id));
    dest.notes.push(...ns.map((n) => ({ ...n })));
    dest.notes.sort((a, b) => a.start - b.start);
    ui.sel.clear();
  }, `Moved to "${dest.name}".`);
}

export const ACTIONS = {
  selAll: () => { ui.sel = new Set(curTrack().notes.map((n) => n.id)); },
  selNone: () => { ui.sel.clear(); },
  selLoop: () => { ui.sel = new Set(curTrack().notes.filter((n) => n.start >= ui.loopStart && n.start < ui.loopEnd).map((n) => n.id)); },
  selAfter: () => { ui.sel = new Set(curTrack().notes.filter((n) => n.start >= ui.playhead - 1e-6).map((n) => n.id)); },

  transposeDown12: () => transposeSel(-12),
  transposeDown1: () => transposeSel(-1),
  transposeUp1: () => transposeSel(1),
  transposeUp12: () => transposeSel(12),
  nudgeLeft: () => edit((ns) => { const d = Math.min(grid(), ...ns.map((n) => n.start)); ns.forEach((n) => (n.start -= d)); }),
  nudgeRight: () => edit((ns) => ns.forEach((n) => (n.start += grid()))),

  /** Q: repeat the last quantize settings. The dialog is openQuantize(). */
  quantize: () => applyQuantize(ui.quantize),
  quantizeDialog: () => openQuantize(),
  lenGrid: () => edit((ns) => ns.forEach((n) => (n.dur = grid()))),
  legato: () => edit((ns, tr) => {
    for (const n of ns) {
      const next = tr.notes.filter((m) => m.start > n.start + 1e-6).reduce((b, m) => Math.min(b, m.start), Infinity);
      if (next < Infinity) n.dur = next - n.start;
    }
  }),
  half: () => stretch(0.5),
  double: () => stretch(2),
  scaleSnap: () => { const notes = scaleNotes(project.settings); return edit((ns) => ns.forEach((n) => (n.pitch = snapToNotes(n.pitch, notes))), 'Snapped to scale.'); },

  duplicate: () => edit((ns, tr) => {
    const s = Math.min(...ns.map((n) => n.start)), e = Math.max(...ns.map((n) => n.start + n.dur));
    const len = ui.snap ? Math.ceil((e - s) / ui.snap - 1e-6) * ui.snap : e - s;
    const copies = cloneNotes(ns, nid, len);
    tr.notes.push(...copies);
    ui.sel = new Set(copies.map((c) => c.id));
  }, 'Duplicated.'),
  delete: () => edit((ns, tr) => { tr.notes = tr.notes.filter((n) => !ui.sel.has(n.id)); ui.sel.clear(); }),
  connect: () => {
    if (!canConnectSel()) { status(connectReason() + '.', true); return; }
    edit((ns) => connectNotes(ns), `Connected ${selNotes().length} notes with slides (ignored in MIDI export; audible in WAV).`);
  },
  tremor: () => openTremor(),
  disconnect: () => edit((ns) => ns.forEach((n) => { delete n.slideTo; }), 'Slides removed.'),
  copy: () => copySel(),
  cut: () => { copySel(); ACTIONS.delete(); },
  paste: () => paste(),

  /** "Change notes": keep the rhythm, pick new pitches on the keyboard. */
  pick: () => {
    if (pick.active) { exitPick(); return; }
    if (transport.playing) stopTransport();
    let ns = selNotes();
    if (!ns.length) ns = curTrack().notes.filter((n) => n.start >= ui.playhead - 1e-6);
    enterPick(ns.map((n) => n.id), ns.length ? ns[0].pitch : 60, true);
  },
};
