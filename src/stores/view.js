/**
 * Piano-roll geometry: beat/pitch ↔ pixel conversions shared by the renderer,
 * mouse interaction and pick mode. Plain (non-reactive) for speed.
 */
import { ui } from './ui.js';
import { clamp } from '../core/music.js';
import { bankRange } from '../audio/drums.js';

export const RULER = 24;
export const PITCH_MIN = 12;
export const PITCH_MAX = 120;
export const KEYW_NORMAL = 46;
export const KEYW_DRUMS = 118;

export const view = {
  W: 0,
  H: 0,
  KEYW: KEYW_NORMAL, // left keyboard strip width (wider on drum layers)
  dirty: true,
  drag: null,        // active mouse drag (read by the renderer for the rubber band)
};

export const invalidate = () => { view.dirty = true; };

export const bx = (b) => view.KEYW + (b - ui.scrollX) * ui.ppb;          // beat → x
export const xb = (x) => (x - view.KEYW) / ui.ppb + ui.scrollX;           // x → beat
export const py = (p) => RULER + (ui.topPitch - (p + 1)) * ui.row;        // pitch → top of its row
export const yp = (y) => Math.floor(ui.topPitch - (y - RULER) / ui.row);  // y → pitch
export const fy = (m) => RULER + (ui.topPitch - m - 0.5) * ui.row;        // fractional midi → row centre

export function clampView() {
  const visRows = (view.H - RULER) / ui.row;
  ui.topPitch = clamp(ui.topPitch, PITCH_MIN + visRows, PITCH_MAX + 1);
  ui.scrollX = Math.max(0, ui.scrollX);
}

/** Scroll the roll to the active drum pad bank. */
export function viewDrums() {
  ui.topPitch = bankRange(ui.drumBank)[1] + 2;
  clampView();
}

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
