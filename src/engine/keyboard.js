/**
 * Global keyboard routing. Priority: context menu → recording taps → pick mode → shortcuts.
 */
import { ui, modalOpen } from '../stores/ui.js';
import { undo, redo } from '../stores/history.js';
import { transport, startTransport, stopTransport, restartTransport } from './transport.js';
import { onTapDown, onTapUp, startRecording } from './recorder.js';
import { pick, pickKeyDown, pickKeyUp, pickBlur } from './pick.js';
import { ACTIONS, transposeSel } from './editing.js';
import { deleteSelectedClips, duplicateSelectedClips, selectAllClips, copySelectedClips, cutSelectedClips, pasteClips, nudgeSelectedClips } from './song.js';
import { deleteSelectedPoint } from './automation.js';

const isField = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');

/** Home: back to the beginning (same as the Restart button). */
export const seekHome = restartTransport;

function onKeyDown(e) {
  if (modalOpen()) return; // the dialog handles its own keys
  if (ui.ctxMenu.open) {
    ui.ctxMenu.open = false;
    if (e.key === 'Escape') { e.preventDefault(); return; }
  }
  if (transport.recording) {
    e.preventDefault();
    if (e.key === 'Escape') stopTransport();
    else onTapDown(e);
    return;
  }
  if (pick.active) { pickKeyDown(e); return; }
  if (isField(e.target) && e.key !== 'Escape') return;
  if (ui.view === 'song') { songKeyDown(e); return; }

  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  const handled = (fn) => { e.preventDefault(); fn(); };

  if (k === ' ') handled(() => (transport.playing ? stopTransport() : startTransport(ui.playhead)));
  else if (k === 'Escape') transport.playing ? stopTransport() : ACTIONS.selNone();
  else if (mod && (k === 'z' || k === 'Z')) handled(() => (e.shiftKey ? redo() : undo()));
  else if (mod && k === 'y') handled(redo);
  else if (mod && k === 'a') handled(ACTIONS.selAll);
  else if (mod && k === 'd') handled(ACTIONS.duplicate);
  else if (mod && k === 'c') handled(ACTIONS.copy);
  else if (mod && k === 'x') handled(ACTIONS.cut);
  else if (mod && k === 'v') handled(ACTIONS.paste);
  else if (mod) return;
  else if (k === 'r' || k === 'R') handled(() => startRecording(false));
  else if (k === 't' || k === 'T') handled(() => startRecording(true));
  else if (k === 'p' || k === 'P') handled(ACTIONS.pick);
  else if (k === 'q' || k === 'Q') handled(ACTIONS.quantize);
  else if (k === 'Delete' || k === 'Backspace') handled(() => ui.sel.size && ACTIONS.delete());
  else if (k === 'ArrowUp') handled(() => transposeSel(e.shiftKey ? 12 : 1));
  else if (k === 'ArrowDown') handled(() => transposeSel(e.shiftKey ? -12 : -1));
  else if (k === 'ArrowLeft') handled(ACTIONS.nudgeLeft);
  else if (k === 'ArrowRight') handled(ACTIONS.nudgeRight);
  else if (k === 'Home') handled(seekHome);
}

/** Song view: transport, undo and clip editing only — note edits must not reach the hidden pattern. */
function songKeyDown(e) {
  const mod = e.ctrlKey || e.metaKey, k = e.key;
  const handled = (fn) => { e.preventDefault(); fn(); };
  if (k === ' ') handled(() => (transport.playing ? stopTransport() : startTransport(ui.songPlayhead, { song: true })));
  else if (k === 'Escape') { if (transport.playing) stopTransport(); else { ui.songSel.clear(); ui.autoSel = null; } }
  else if (mod && (k === 'z' || k === 'Z')) handled(() => (e.shiftKey ? redo() : undo()));
  else if (mod && k === 'y') handled(redo);
  else if (mod && k === 'a') handled(selectAllClips);
  else if (mod && k === 'd') handled(duplicateSelectedClips);
  else if (mod && k === 'c') handled(copySelectedClips);
  else if (mod && k === 'x') handled(cutSelectedClips);
  else if (mod && k === 'v') handled(() => pasteClips());
  else if (k === 'Delete' || k === 'Backspace') handled(() => (ui.autoSel ? deleteSelectedPoint() : deleteSelectedClips()));
  else if (k === 'Home') handled(restartTransport);
  else if ((k === 'ArrowLeft' || k === 'ArrowRight') && ui.songSel.size) handled(() => nudgeSelectedClips(k === 'ArrowLeft' ? -1 : 1, mod));
}

function onKeyUp(e) {
  if (transport.recording) { e.preventDefault(); onTapUp(e); }
  else if (pick.active) { e.preventDefault(); pickKeyUp(e); }
}

export function installKeyboard() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { pickBlur(); ui.ctxMenu.open = false; });
  // buttons must not keep focus, or Space would re-trigger them instead of play/stop
  document.addEventListener('click', (e) => e.target.closest?.('button')?.blur());
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}
