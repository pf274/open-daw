/**
 * Piano-roll pointer handling: select / move / resize / box-select / add / delete,
 * ruler seek + loop, wheel scroll/zoom, context menu.
 *
 * Touch (onPointer*): a finger on a note moves/resizes it like the mouse; on empty space it pans;
 * two fingers pan and pinch-zoom; double-tap adds/deletes; double-tap-and-drag on empty space box-selects; long-press opens the menu; while
 * recording, tapping anywhere counts as a tap; in pick mode the keyboard strip plays the pitch.
 */
import { clamp } from '../core/music.js';
import { cloneNotes } from '../core/slides.js';
import { curTrack, project, nid } from '../stores/project.js';
import { ui, selNotes, grid, snapBeat } from '../stores/ui.js';
import { pushUndo, takeSnapshot, commitUndo } from '../stores/history.js';
import { view, bx, xb, yp, clampView, invalidate, RULER } from '../stores/view.js';
import { transport, startTransport } from '../engine/transport.js';
import { pick, pickJumpTo, pickPitchDown, pickPitchUp } from '../engine/pick.js';
import { onTapDown, onTapUp } from '../engine/recorder.js';
import { audition } from '../engine/mix.js';
import { doubleTapper, recentlyDoubleTapped, LONG_PRESS_MS } from '../composables/touch.js';

function hitNote(x, y, edgePx = 7) {
  const tr = curTrack(), p = yp(y);
  for (let i = tr.notes.length - 1; i >= 0; i--) {
    const n = tr.notes[i];
    if (n.pitch !== p) continue;
    const x0 = bx(n.start), x1 = x0 + Math.max(3, n.dur * ui.ppb);
    if (x >= x0 && x <= x1) return { note: n, edge: x >= x1 - Math.min(edgePx, (x1 - x0) / 3) };
  }
  return null;
}

function seek(b) {
  b = Math.max(0, snapBeat(b));
  ui.playhead = b;
  if (transport.playing && !transport.recording) startTransport(b);
}

export function createRollInteraction(canvas) {
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function onMouseDown(e) {
    if (e.button !== 0 || transport.recording) return;
    const { x, y } = pos(e);
    if (y < RULER) {
      if (e.shiftKey) {
        const b = Math.max(0, snapBeat(xb(x)));
        view.drag = { mode: 'loop', anchor: b };
        ui.loopStart = b; ui.loopEnd = b;
      } else {
        view.drag = { mode: 'seek' };
        seek(xb(x));
      }
      return;
    }
    if (x < view.KEYW) { audition(curTrack(), yp(y)); return; }
    if (pick.active) { // clicking a note in pick mode jumps to it
      const h = hitNote(x, y);
      if (h) pickJumpTo(h.note.id);
      return;
    }
    const touch = e.pointerType === 'touch';
    const tr = curTrack(), hit = hitNote(x, y, touch ? 14 : 7); // fingers get a wider resize edge
    if (hit) {
      const n = hit.note;
      if (e.shiftKey) { ui.sel.has(n.id) ? ui.sel.delete(n.id) : ui.sel.add(n.id); return; }
      if (!ui.sel.has(n.id)) ui.sel = new Set([n.id]);
      // snapshot now, but only commit it to history once the click becomes a real drag
      const snap = takeSnapshot();
      let anchorNote = n, dupIds = null;
      if (e.altKey && !hit.edge) { // alt-drag duplicates; drag the copies
        const copies = cloneNotes(selNotes(), nid); // same order as selNotes()
        tr.notes.push(...copies);
        const anchorIdx = selNotes().indexOf(n);
        dupIds = new Set(copies.map((c) => c.id));
        ui.sel = dupIds;
        anchorNote = tr.notes.find((m) => m.id === copies[anchorIdx].id);
      }
      view.drag = {
        mode: hit.edge ? 'resize' : 'move', x0: x, y0: y, moved: false, snap, anchorNote, dupIds, slop: touch ? 8 : 2,
        orig: new Map(selNotes().map((m) => [m.id, { start: m.start, dur: m.dur, pitch: m.pitch }])),
        lastPitch: n.pitch,
      };
      if (!hit.edge) audition(tr, n.pitch, n.vel);
      return;
    }
    if (!e.shiftKey) ui.sel.clear();
    view.drag = { mode: 'box', x0: x, y0: y, x1: x, y1: y, base: new Set(ui.sel) };
    invalidate();
  }

  function onMouseMove(e) {
    const { x, y } = pos(e);
    const d = view.drag;
    if (!d) {
      if (e.target === canvas) {
        const h = y >= RULER && x >= view.KEYW ? hitNote(x, y) : null;
        canvas.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : y < RULER ? 'pointer' : 'default';
      }
      return;
    }
    if (d.mode === 'seek') { seek(xb(x)); return; }
    if (d.mode === 'loop') {
      const b = Math.max(0, snapBeat(xb(x)));
      ui.loopStart = Math.min(d.anchor, b);
      ui.loopEnd = Math.max(d.anchor, b);
      return;
    }
    if (d.mode === 'box') {
      d.x1 = x; d.y1 = y;
      const bA = xb(Math.min(d.x0, x)), bB = xb(Math.max(d.x0, x));
      const pA = yp(Math.max(d.y0, y)), pB = yp(Math.min(d.y0, y));
      const sel = new Set(d.base);
      for (const n of curTrack().notes) {
        if (n.pitch >= pA && n.pitch <= pB && n.start < bB && n.start + n.dur > bA) sel.add(n.id);
      }
      ui.sel = sel;
      invalidate();
      return;
    }
    if (!d.moved) {
      if (Math.abs(x - d.x0) <= d.slop && Math.abs(y - d.y0) <= d.slop) return; // still just a click
      d.moved = true;
      commitUndo(d.snap);
    }
    const dxBeats = (x - d.x0) / ui.ppb;
    const a = d.orig.get(d.anchorNote.id);
    const notes = curTrack().notes;
    if (d.mode === 'move') {
      const dp = Math.round((d.y0 - y) / ui.row);
      // snap the grabbed note's start; move everything by the same delta
      let db = ui.snap && !e.ctrlKey ? snapBeat(a.start + dxBeats) - a.start : dxBeats;
      db = Math.max(db, -Math.min(...[...d.orig.values()].map((o) => o.start)));
      for (const n of notes) {
        const o = d.orig.get(n.id);
        if (!o) continue;
        n.start = o.start + db;
        n.pitch = clamp(o.pitch + dp, 0, 127);
      }
      if (d.anchorNote.pitch !== d.lastPitch) {
        d.lastPitch = d.anchorNote.pitch;
        audition(curTrack(), d.lastPitch, d.anchorNote.vel);
      }
    } else if (d.mode === 'resize') {
      let newEnd = a.start + a.dur + dxBeats;
      if (ui.snap && !e.ctrlKey) newEnd = snapBeat(newEnd);
      const dd = newEnd - (a.start + a.dur);
      const minLen = ui.snap ? Math.min(ui.snap, 0.0625) : 0.03125;
      for (const n of notes) {
        const o = d.orig.get(n.id);
        if (o) n.dur = Math.max(minLen, o.dur + dd);
      }
    }
  }

  function onMouseUp() {
    const d = view.drag;
    if (!d) return;
    view.drag = null;
    if (d.mode === 'loop') {
      if (ui.loopEnd - ui.loopStart < 0.01) ui.loopEnd = ui.loopStart + 4;
      ui.loop = true;
    }
    if (d.mode === 'move' || d.mode === 'resize') {
      const tr = curTrack();
      // a click that never became a drag: drop any Alt-copies; history was never touched
      if (!d.moved && d.dupIds) { tr.notes = tr.notes.filter((n) => !d.dupIds.has(n.id)); ui.sel.clear(); }
      tr.notes.sort((p, q) => p.start - q.start);
    }
    invalidate();
  }

  function onDblClick(e) {
    if (transport.recording || pick.active) return;
    const { x, y } = pos(e);
    if (y < RULER || x < view.KEYW) return;
    const hit = hitNote(x, y), tr = curTrack();
    pushUndo();
    if (hit) { // double-click a note deletes it
      tr.notes = tr.notes.filter((n) => n.id !== hit.note.id);
      ui.sel.delete(hit.note.id);
    } else {
      const start = Math.max(0, ui.snap ? Math.floor(xb(x) / ui.snap) * ui.snap : xb(x));
      const n = { id: nid(), start, dur: grid(), pitch: yp(y), vel: +project.settings.vel || 96 };
      tr.notes.push(n);
      tr.notes.sort((p, q) => p.start - q.start);
      ui.sel = new Set([n.id]);
      audition(tr, n.pitch, n.vel);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    ui.ctxMenu.open = false;
    const { x, y } = pos(e);
    if (e.ctrlKey && e.shiftKey) {
      const m = ui.topPitch - (y - RULER) / ui.row;
      ui.row = clamp(ui.row * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 6, 32);
      ui.topPitch = m + (y - RULER) / ui.row;
    } else if (e.ctrlKey) {
      const b = xb(x);
      ui.ppb = clamp(ui.ppb * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 8, 600);
      ui.scrollX = b - (x - view.KEYW) / ui.ppb;
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      ui.scrollX += (e.deltaX || e.deltaY) / ui.ppb;
    } else {
      ui.topPitch -= e.deltaY / ui.row / 2;
    }
    clampView();
  }

  function onContextMenu(e) {
    e.preventDefault();
    if (transport.recording || pick.active) return;
    const { x, y } = pos(e);
    if (y < RULER || x < view.KEYW) return;
    // right-clicking an unselected note selects just that note
    const hit = hitNote(x, y);
    if (hit && !ui.sel.has(hit.note.id)) ui.sel = new Set([hit.note.id]);
    const beat = Math.max(0, ui.snap ? Math.floor(xb(x) / ui.snap) * ui.snap : xb(x));
    Object.assign(ui.ctxMenu, { open: true, kind: 'note', x: e.clientX, y: e.clientY, beat });
  }

  /* ---------------- touch ---------------- */
  const touches = new Map(); // pointerId → { x, y } of fingers on the canvas
  let gesture = null;        // { kind: 'pan' | 'pinch' | 'box' | 'note' | 'key' | 'ruler' | 'done', … }
  let press = null;          // long-press timer
  let lastTouch = -Infinity; // when a finger last lifted (to ignore the native dblclick)
  const dtap = doubleTapper();
  const cancelPress = () => { clearTimeout(press); press = null; };
  const pt = (id) => touches.get(id);

  function startPinch() {
    cancelPress();
    if (view.drag) onMouseUp(); // a second finger: end what the first one started (a moved note stays moved)
    const [a, b] = [...touches.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    gesture = { kind: 'pinch', spread: Math.max(20, Math.abs(a.x - b.x)), ppb: ui.ppb, beat: xb(mx), pitchAt: ui.topPitch - (my - RULER) / ui.row, mx, my };
  }

  function onPointerDown(e) {
    if (transport.recording) { // tap the screen (any pointer) like tapping a key
      if (e.button > 0) return;
      e.preventDefault?.();
      onTapDown({ key: 'Tap', code: `Pointer${e.pointerId ?? 0}`, timeStamp: e.timeStamp, repeat: false });
      return;
    }
    if (e.pointerType !== 'touch') { onMouseDown(e); return; }
    e.preventDefault?.();
    const p = pos(e);
    touches.set(e.pointerId, p);
    if (touches.size === 2) { if (gesture?.kind === 'key') pickPitchUp(); startPinch(); return; }
    if (touches.size > 2) return;
    ui.ctxMenu.open = false;
    const { x, y } = p;
    if (y < RULER) { gesture = { kind: 'ruler' }; onMouseDown({ ...pointerish(e), shiftKey: false }); return; }
    if (x < view.KEYW) {
      gesture = { kind: 'key' };
      if (pick.active) pickPitchDown(yp(y)); else audition(curTrack(), yp(y));
      return;
    }
    if (pick.active) { gesture = { kind: 'done' }; onMouseDown(pointerish(e)); return; }
    if (hitNote(x, y, 14)) {
      gesture = { kind: 'note', x0: x, y0: y };
      onMouseDown(pointerish(e));
    } else if (dtap.pending(e, 'roll')) { // tap, then press again and drag: box selection (lifting without a drag is a double-tap)
      gesture = { kind: 'box', x0: x, y0: y, moved: false };
      onMouseDown(pointerish(e));
      return; // no long-press menu here
    } else {
      gesture = { kind: 'pan', x0: x, y0: y, scrollX: ui.scrollX, topPitch: ui.topPitch, moved: false };
    }
    const { clientX, clientY } = e;
    press = setTimeout(() => { // long-press: the menu, as a right-click would
      press = null;
      if (view.drag && !view.drag.moved) view.drag = null; // the note press never became a drag
      if (gesture && !gesture.moved) {
        gesture = { kind: 'done' };
        onContextMenu({ preventDefault() {}, clientX, clientY, synthetic: true });
      }
    }, LONG_PRESS_MS);
  }
  /** A touch event as onMouseDown expects it (left button, no modifiers). */
  const pointerish = (e) => ({ button: 0, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, clientX: e.clientX, clientY: e.clientY, pointerType: 'touch' });

  function onPointerMove(e) {
    if (e.pointerType !== 'touch') { onMouseMove(e); return; }
    if (!touches.has(e.pointerId)) return;
    const p = pos(e);
    touches.set(e.pointerId, p);
    const g = gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (touches.size < 2) return;
      const [a, b] = [...touches.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ui.ppb = clamp(g.ppb * (Math.max(20, Math.abs(a.x - b.x)) / g.spread), 8, 600); // spread fingers apart = zoom in on time
      ui.scrollX = g.beat - (mx - view.KEYW) / ui.ppb; // the beat between the fingers follows them
      ui.topPitch = g.pitchAt + (my - RULER) / ui.row;
      clampView();
      return;
    }
    if (g.kind === 'pan') {
      const dx = p.x - g.x0, dy = p.y - g.y0;
      if (!g.moved && Math.hypot(dx, dy) < 8) return;
      g.moved = true;
      cancelPress();
      ui.scrollX = g.scrollX - dx / ui.ppb;
      ui.topPitch = g.topPitch + dy / ui.row;
      clampView();
      return;
    }
    if (g.kind === 'box') {
      if (!g.moved && Math.hypot(p.x - g.x0, p.y - g.y0) < 8) return; // still a tap
      g.moved = true;
      onMouseMove({ clientX: e.clientX, clientY: e.clientY, ctrlKey: false });
      return;
    }
    if (g.kind === 'note' || g.kind === 'ruler') {
      if (g.kind === 'note' && !g.moved && Math.hypot(p.x - g.x0, p.y - g.y0) >= 8) { g.moved = true; cancelPress(); }
      onMouseMove({ clientX: e.clientX, clientY: e.clientY, ctrlKey: false });
    }
  }

  function onPointerUp(e, cancelled = false) {
    if (transport.recording) {
      onTapUp({ key: 'Tap', code: `Pointer${e.pointerId ?? 0}`, timeStamp: e.timeStamp });
      touches.delete(e.pointerId);
      return;
    }
    if (e.pointerType !== 'touch') { onMouseUp(e); return; }
    if (!touches.has(e.pointerId)) return;
    touches.delete(e.pointerId);
    lastTouch = performance.now();
    cancelPress();
    const g = gesture;
    if (g?.kind === 'pinch') { gesture = touches.size ? { kind: 'done' } : null; return; }
    if (touches.size) return;
    gesture = null;
    if (!g) return;
    if (g.kind === 'key') { pickPitchUp(); return; }
    if (g.kind === 'ruler') { onMouseUp(e); return; }
    if (g.kind === 'box') {
      onMouseUp(e);
      if (g.moved || cancelled) dtap.reset();
      else if (dtap(e, 'roll')) onDblClick(e); // it was a double-tap after all: add a note
      return;
    }
    if (g.kind === 'note') {
      const wasDrag = view.drag?.moved;
      onMouseUp(e);
      if (!cancelled && !wasDrag && dtap(e, 'roll')) onDblClick(e); // double-tap a note deletes it
      return;
    }
    if (g.kind === 'pan' && !g.moved && !cancelled) { // a tap on empty space
      ui.sel.clear();
      invalidate();
      if (dtap(e, 'roll')) onDblClick(e); // double-tap adds a note
    }
  }
  const onPointerCancel = (e) => onPointerUp(e, true);

  /** The browser's own dblclick / long-press menu: touch handles both itself. */
  const onNativeDblClick = (e) => { if (!recentlyDoubleTapped() && performance.now() - lastTouch > 600) onDblClick(e); };
  const onNativeContextMenu = (e) => {
    if (touches.size || performance.now() - lastTouch < 800) { e.preventDefault(); return; }
    onContextMenu(e);
  };

  return { onMouseDown, onMouseMove, onMouseUp, onDblClick, onWheel, onContextMenu, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onNativeDblClick, onNativeContextMenu };
}
