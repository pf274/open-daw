/** Drum pad banks: which set of drums the pad keys play right now (Z / X switch). */
import { DRUM_BANKS, drumForKey, padList, bankRange } from '../audio/drums.js';
import { clamp } from '../core/music.js';
import { ui, status } from '../stores/ui.js';
import { clampView, RULER, view } from '../stores/view.js';

export const BANK_KEYS = { KeyZ: -1, KeyX: 1 };

/** Pitch for a pad key in the current bank (Space = kick), or undefined. */
export const padPitch = (code) => drumForKey(code, ui.drumBank);

export const bankLabel = (b = ui.drumBank) => `Bank ${b + 1}/${DRUM_BANKS.length}: ${DRUM_BANKS[b].name}`;

/** Help line for the current bank: "A kick · W rim · …". */
export const padHelp = (b = ui.drumBank) => padList(b).map((d) => `${d.key} ${d.name.toLowerCase()}`).join(' · ');

/** Scroll the roll so the bank's drums are on screen. */
export function showBank(b = ui.drumBank) {
  const [lo, hi] = bankRange(b);
  const rows = (view.H - RULER) / ui.row || 24;
  if (hi + 1 > ui.topPitch || lo < ui.topPitch - rows) ui.topPitch = Math.max(hi + 2, lo + rows - 1);
  clampView();
}

export function shiftDrumBank(d) {
  const b = clamp(ui.drumBank + d, 0, DRUM_BANKS.length - 1);
  if (b === ui.drumBank) return false;
  ui.drumBank = b;
  showBank(b);
  status(`${bankLabel(b)} — ${padHelp(b)}`);
  return true;
}

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
