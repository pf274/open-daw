/**
 * Pick mode: step through notes and choose each pitch on the computer keyboard
 * (piano layout, or drum pads on drum layers). Short press previews, holding for
 * `settings.holdMs` confirms and advances.
 */
import { reactive } from 'vue';
import { bankRange, DRUMS } from '../audio/drums.js';
import { padPitch, shiftDrumBank, BANK_KEYS } from './drumPads.js';
import { clamp } from '../core/music.js';
import { project, curTrack, isDrum } from '../stores/project.js';
import { ui, status } from '../stores/ui.js';
import { pushUndo } from '../stores/history.js';
import { view, bx, clampView, RULER } from '../stores/view.js';
import { audition } from './mix.js';
import { transport, startTransport, stopTransport } from './transport.js';

/** Physical keys (layout-independent): home row = white keys, row above = black keys. */
export const PIANO_KEYS = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

export const pick = reactive({
  active: false,
  ids: [],
  i: 0,
  base: 60,          // pitch of the A key
  done: new Set(),
  hold: null,        // { code, t0, ms, timer }
  flash: 0,
});

export const pickNote = () => curTrack().notes.find((n) => n.id === pick.ids[pick.i]);

export function enterPick(ids, nearPitch, withUndo) {
  const tr = curTrack();
  const byId = new Map(tr.notes.map((n) => [n.id, n]));
  ids = ids.filter((id) => byId.has(id));
  if (!ids.length) { status('No notes to pick pitches for.', true); return; }
  if (withUndo) pushUndo();
  ids.sort((a, b) => byId.get(a).start - byId.get(b).start);
  pick.active = true;
  pick.ids = ids;
  pick.i = 0;
  pick.done = new Set();
  pick.hold = null;
  pick.base = clamp(Math.floor((nearPitch == null ? 60 : nearPitch) / 12) * 12, 12, 108);
  if (isDrum(tr)) { const first = byId.get(ids[0]); if (DRUMS[first.pitch]) ui.drumBank = DRUMS[first.pitch].bank; } // open that drum's pad bank
  if (typeof document !== 'undefined') document.activeElement?.blur?.();
  focusPick();
  status(`Pick mode: ${ids.length} notes. Hold a key ${project.settings.holdMs} ms to confirm each.`);
}

export function exitPick(msg) {
  if (!pick.active) return;
  cancelHold();
  pick.active = false;
  ui.sel.clear();
  if (transport.playing) stopTransport();
  status(msg || `Pick mode finished — ${pick.done.size}/${pick.ids.length} notes confirmed.`);
}

function cancelHold() {
  if (pick.hold) clearTimeout(pick.hold.timer);
  pick.hold = null;
}

/** Select the current note and scroll it (and the playable key range) into view. */
export function focusPick() {
  const n = pickNote();
  if (!n) return;
  ui.sel = new Set([n.id]);
  ui.playhead = n.start;
  if (view.W && (bx(n.start) < view.KEYW + 40 || bx(n.start + n.dur) > view.W - 40)) ui.scrollX = Math.max(0, n.start - 2);
  if (view.H) {
    const visRows = (view.H - RULER) / ui.row;
    const [kLo, kHi] = isDrum(curTrack()) ? bankRange(ui.drumBank) : [pick.base, pick.base + 17];
    const lo = Math.min(n.pitch, kLo), hi = Math.max(n.pitch, kHi);
    if (hi + 1 > ui.topPitch || lo < ui.topPitch - visRows) ui.topPitch = (lo + hi) / 2 + visRows / 2;
    clampView();
  }
}

export function pickMove(d) {
  cancelHold();
  pick.i = clamp(pick.i + d, 0, pick.ids.length - 1);
  focusPick();
}
export function pickJumpTo(id) {
  const idx = pick.ids.indexOf(id);
  if (idx < 0) return false;
  cancelHold();
  pick.i = idx;
  focusPick();
  return true;
}

export function pickConfirm() {
  const n = pickNote();
  if (!n) return;
  pick.done.add(n.id);
  pick.flash = performance.now();
  pick.hold = null;
  if (pick.i >= pick.ids.length - 1) { exitPick(`All ${pick.ids.length} notes picked.`); return; }
  pick.i++;
  focusPick();
}

function setPitch(n, p) {
  n.pitch = clamp(p, 0, 127);
  audition(curTrack(), n.pitch, n.vel);
}

export function pickKeyDown(e) {
  e.preventDefault();
  if (e.repeat) return;
  const n = pickNote();
  const code = e.code;
  const drumMode = isDrum(curTrack());
  const isPad = drumMode ? code !== 'Space' && padPitch(code) != null : code in PIANO_KEYS;
  if (isPad && !e.ctrlKey && !e.metaKey) {
    startHold(code, drumMode ? padPitch(code) : pick.base + PIANO_KEYS[code]);
    return;
  }
  switch (e.key) {
    case 'z': case 'Z': case 'x': case 'X': // octave on the piano; pad bank on drum layers
      if (drumMode) { cancelHold(); shiftDrumBank(BANK_KEYS[code] ?? (e.key.toLowerCase() === 'z' ? -1 : 1)); }
      else pick.base = clamp(pick.base + (e.key.toLowerCase() === 'z' ? -12 : 12), 0, 108);
      focusPick();
      break;
    case 'ArrowLeft': case 'Backspace': pickMove(-1); break;
    case 'ArrowRight': pickMove(1); break;
    case 'ArrowUp': if (n) setPitch(n, n.pitch + 1); break;
    case 'ArrowDown': if (n) setPitch(n, n.pitch - 1); break;
    case 'Enter': pickConfirm(); break;
    case ' ': // hear the phrase leading into (and including) the current note
      if (transport.playing) { stopTransport(); focusPick(); break; }
      if (n) startTransport(Math.max(0, n.start - 4), { stopAt: n.start + n.dur, onStop: () => pick.active && focusPick() });
      break;
    case 'Escape': exitPick(); break;
  }
}

export function pickKeyUp(e) {
  if (pick.hold && pick.hold.code === e.code) cancelHold();
}

/** Set the current note to `pitch` and confirm it if held long enough (keyed by what's held: a key code, or a touch). */
function startHold(code, pitch) {
  const n = pickNote();
  if (!n || pitch == null) return;
  cancelHold(); // latest key wins
  setPitch(n, pitch);
  const ms = Math.max(100, +project.settings.holdMs || 750);
  pick.hold = {
    code, t0: performance.now(), ms,
    timer: setTimeout(() => { if (pick.hold && pick.hold.code === code) pickConfirm(); }, ms),
  };
}
/** Touch / mouse on the roll's keyboard strip: press a key (pitch) like a computer key; hold to confirm. */
export const pickPitchDown = (pitch) => startHold('pointer', pitch);
export function pickPitchUp() {
  if (pick.hold && pick.hold.code === 'pointer') cancelHold();
}
/** On-screen pick-mode controls (phones have no keyboard). */
export function pickOctave(d) {
  if (isDrum(curTrack())) { cancelHold(); shiftDrumBank(d); }
  else pick.base = clamp(pick.base + d * 12, 0, 108);
  focusPick();
}
export function pickHearPhrase() {
  const n = pickNote();
  if (transport.playing) { stopTransport(); focusPick(); return; }
  if (n) startTransport(Math.max(0, n.start - 4), { stopAt: n.start + n.dur, onStop: () => pick.active && focusPick() });
}

/** Losing window focus mid-hold must not confirm a note. */
export const pickBlur = cancelHold;

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
