/**
 * Custom-synth editing: switching a layer to the custom synth and the editor dialog's
 * open / preset / preview / apply actions. The dialog edits a working copy
 * (ui.synthModal.patch); Apply commits it as one undoable step.
 */
import { normalizePatch, presetPatch, makeFilter, MAX_FILTERS, makeEffect, MAX_EFFECTS } from '../audio/customSynth.js';
import { project, curTrack } from '../stores/project.js';
import { ui, status, selNotes } from '../stores/ui.js';
import { pushUndo } from '../stores/history.js';
import { gmProgramFor } from '../audio/instruments.js';
import { DEFAULT_PROGRAM } from '../audio/recorded.js';

const trackById = (id) => project.tracks.find((t) => t.id === id);
export const editingTrack = () => trackById(ui.synthModal.trackId);

/** Change a layer's instrument; switching to 'custom' gives it a patch if it has none. */
export function setInstrument(tr, inst) {
  // switching to a recorded instrument: start from the same kind of instrument (marimba → recorded marimba)
  if (inst === 'recorded' && !tr.program) tr.program = tr.inst === 'drums' ? DEFAULT_PROGRAM : gmProgramFor(tr) + 1;
  tr.inst = inst;
  if (inst === 'custom' && !tr.synth) tr.synth = normalizePatch(); // fresh copy (own filters array)
}

export function openSynthEditor(trackId) {
  const tr = trackById(trackId);
  if (!tr) return;
  if (!tr.synth) tr.synth = normalizePatch();
  Object.assign(ui.synthModal, { open: true, trackId, patch: normalizePatch(tr.synth) });
}

export function loadPreset(name) {
  if (!ui.synthModal.open) return;
  ui.synthModal.patch = presetPatch(name);
}

export function applySynth() {
  const tr = editingTrack();
  if (!tr) return;
  pushUndo();
  tr.synth = normalizePatch(ui.synthModal.patch);
  status(`Updated the "${tr.name}" synth.`);
}

/* ---- filter chain (edits the working copy) ---- */
export const canAddFilter = () => (ui.synthModal.patch?.filters.length ?? MAX_FILTERS) < MAX_FILTERS;

export function addFilter(type) {
  if (!canAddFilter()) return null;
  const f = makeFilter(type);
  ui.synthModal.patch.filters.push(f);
  return f;
}

export function removeFilter(id) {
  const p = ui.synthModal.patch;
  if (p) p.filters = p.filters.filter((f) => f.id !== id);
}

/* ---- insert effects (edits the working copy) ---- */
export const canAddEffect = () => (ui.synthModal.patch?.effects.length ?? MAX_EFFECTS) < MAX_EFFECTS;

export function addEffect(type) {
  if (!canAddEffect()) return null;
  const e = makeEffect(type);
  ui.synthModal.patch.effects.push(e);
  return e;
}

export function removeEffect(id) {
  const p = ui.synthModal.patch;
  if (p) p.effects = p.effects.filter((e) => e.id !== id);
}

/** Move an effect earlier (−1) or later (+1) in the chain. */
export function moveEffect(id, d) {
  const list = ui.synthModal.patch?.effects;
  const i = list?.findIndex((e) => e.id === id) ?? -1;
  const j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

export function closeSynthEditor() {
  ui.synthModal.open = false;
}

/** A short arpeggio + chord around middle C for auditioning a patch. */
export const TEST_PHRASE = [
  [0, 0.5, 60], [0.5, 0.5, 64], [1, 0.5, 67], [1.5, 0.5, 72],
  [2, 2, 60], [2, 2, 64], [2, 2, 67],
].map(([start, dur, pitch], i) => ({ id: -1 - i, start, dur, pitch, vel: 96 }));

/** What Preview plays: the selected notes if the edited layer is the current one, else the test phrase. */
export function previewMaterial() {
  const tr = editingTrack();
  const sel = tr && tr === curTrack() ? selNotes() : [];
  return sel.length ? { notes: sel, label: `${sel.length} selected note${sel.length === 1 ? '' : 's'}` } : { notes: TEST_PHRASE, label: 'test phrase' };
}
