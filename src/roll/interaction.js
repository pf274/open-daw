/**
 * Piano-roll mouse handling: select / move / resize / box-select / add / delete,
 * ruler seek + loop, wheel scroll/zoom, context menu.
 */
import { clamp } from '../core/music.js';
import { cloneNotes } from '../core/slides.js';
import { curTrack, project, nid } from '../stores/project.js';
import { ui, selNotes, grid, snapBeat } from '../stores/ui.js';
import { pushUndo, takeSnapshot, commitUndo } from '../stores/history.js';
import { view, bx, xb, yp, clampView, invalidate, RULER } from '../stores/view.js';
import { transport, startTransport } from '../engine/transport.js';
import { pick, pickJumpTo } from '../engine/pick.js';
import { audition } from '../engine/mix.js';

function hitNote(x, y) {
  const tr = curTrack(), p = yp(y);
  for (let i = tr.notes.length - 1; i >= 0; i--) {
    const n = tr.notes[i];
    if (n.pitch !== p) continue;
    const x0 = bx(n.start), x1 = x0 + Math.max(3, n.dur * ui.ppb);
    if (x >= x0 && x <= x1) return { note: n, edge: x >= x1 - Math.min(7, (x1 - x0) / 3) };
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
    const tr = curTrack(), hit = hitNote(x, y);
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
        mode: hit.edge ? 'resize' : 'move', x0: x, y0: y, moved: false, snap, anchorNote, dupIds,
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
      if (Math.abs(x - d.x0) <= 2 && Math.abs(y - d.y0) <= 2) return; // still just a click
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

  return { onMouseDown, onMouseMove, onMouseUp, onDblClick, onWheel, onContextMenu };
}
