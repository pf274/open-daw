/** Editor/session state that is NOT part of the saved document. */
import { reactive } from 'vue';
import { curTrack } from './project.js';
import { confirmState } from './confirm.js';

/** A remembered on/off preference (per browser); falls back to `def` when storage is unavailable. */
export function loadPref(key, def) {
  try { const v = localStorage.getItem(key); return v === null ? def : v === 'true'; }
  catch { return def; }
}

/** Song view track-header column width limits (px). Declared before `ui`, which reads it on creation. */
export const HEAD_W = { min: 150, max: 420, def: 230 };

export const ui = reactive({
  // transport & grid
  snap: 0.25,
  metronome: loadPref('whistle-midi-metronome', true), // remembered per browser (see stores/persistence.js)
  countIn: 4,
  loop: false,
  loopStart: 0,
  loopEnd: 8,
  playhead: 0,
  masterVol: 0.8,

  // piano-roll viewport
  ppb: 80,          // pixels per beat
  row: 14,          // pixels per pitch row
  scrollX: 0,       // beats
  topPitch: 84,     // pitch value at the top edge
  showTrace: true,

  // selection & clipboard
  sel: new Set(),   // selected note ids (current track)
  clipboard: null,
  noteLen: 0,       // length (beats) of the last selected note; new notes copy it (0 = use the grid)

  // last-used quantize settings (grid 0 = follow the editor's snap)
  quantize: { grid: 0, strength: 100, ends: false },

  // mic
  mic: { on: false, deviceId: '', devices: [] },

  // which drum pad bank the keys play (pick mode + live pads; Z/X switch)
  drumBank: 0,

  // song view
  view: loadView(),   // 'pattern' (the note editor) | 'song' (the arrangement)
  songPlayhead: 0,    // beats
  songSel: new Set(), // selected clip ids
  barPx: 72,          // song view zoom: pixels per bar
  headW: loadHeadW(), // song view: width of the track-header column (px), resizable
  headCollapsed: loadHeadCollapsed(), // song view: track-header column folded to colour strips
  songSnap: 1,        // song view grid: 'bar', or counted beats (1, ½, ¼); 0 = off
  autoSel: null,      // selected automation point: { id (automation track), index }
  placeSound: null,   // a sound picked in the list (or as a clip): double-clicking empty space places it instead of the pattern
  clipClipboard: null, // copied clips: { clips: [{ patternId, offset, lane }], length, top }

  // chrome
  theme: loadThemePref(), // 'system' | 'light' | 'dark' (see stores/theme.js)
  themeResolved: 'dark',  // what's showing: 'light' | 'dark'
  tab: loadTab(),
  drawer: false,    // phones: the sidebar slid open   // 'file' | 'settings' | null (collapsed)
  status: { msg: 'Ready.', warn: false },
  ctxMenu: { open: false, kind: 'note', x: 0, y: 0, beat: 0, trackId: null, items: null, serial: 0 }, // kind: 'note' (piano roll) | 'clip' (song view) | 'custom' (`items` given by the opener)
  tremorModal: { open: false, depth: 30, rate: 5.5 },
  quantizeModal: { open: false, grid: 0, strength: 100, ends: false },
  synthModal: { open: false, trackId: null, patch: null }, // patch = unsaved working copy
});

function loadThemePref() {
  try { const v = localStorage.getItem('open-daw-theme'); return v === 'light' || v === 'dark' ? v : 'system'; }
  catch { return 'system'; }
}

function loadHeadCollapsed() {
  try { return localStorage.getItem('open-daw-head-collapsed') === 'true'; } catch { return false; }
}
export function toggleHeadCollapsed() {
  ui.headCollapsed = !ui.headCollapsed;
  try { localStorage.setItem('open-daw-head-collapsed', String(ui.headCollapsed)); } catch { /* per-viewer convenience only */ }
}

function loadHeadW() {
  try { const v = +localStorage.getItem('whistle-midi-head-w'); return v >= HEAD_W.min && v <= HEAD_W.max ? v : HEAD_W.def; }
  catch { return HEAD_W.def; }
}
export function saveHeadW() {
  try { localStorage.setItem('whistle-midi-head-w', String(ui.headW)); } catch { /* per-viewer convenience only */ }
}

function loadView() {
  try { return localStorage.getItem('open-daw-view') === 'song' ? 'song' : 'pattern'; }
  catch { return 'pattern'; }
}
export function saveView() {
  try { localStorage.setItem('open-daw-view', ui.view); } catch { /* per-viewer convenience only */ }
}

function loadTab() {
  try { const t = localStorage.getItem('open-daw-tab'); return t === 'none' ? null : t || 'file'; }
  catch { return 'file'; }
}
export function setTab(t) {
  ui.tab = ui.tab === t ? null : t; // clicking the active tab collapses the panel
  try { localStorage.setItem('open-daw-tab', ui.tab || 'none'); } catch { /* per-viewer convenience only */ }
}

/** True while a modal dialog owns the keyboard. */
export const modalOpen = () => ui.tremorModal.open || ui.quantizeModal.open || ui.synthModal.open || confirmState.open;

export function status(msg, warn = false) {
  ui.status.msg = msg;
  ui.status.warn = warn;
}

export const selNotes = () => curTrack().notes.filter((n) => ui.sel.has(n.id));
export const grid = () => ui.snap || 0.25;
export const snapBeat = (b) => (ui.snap ? Math.round(b / ui.snap) * ui.snap : b);

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
