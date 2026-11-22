<script setup>
/**
 * The arrangement: one row per song track (name + colour on the left), clips of patterns and
 * imported sounds laid out in bars. Drop patterns/sounds from the lists (or audio files from the desktop), drag clips to move them (Alt = copy,
 * Ctrl/⌘ = fine adjustment, ignoring the snap; ←/→ nudge), drag a clip's left/right edge to truncate it,
 * double-click a clip to edit its pattern. The Sections strip under the ruler holds labelled spans
 * (intro, verse, chorus…) that tint the lanes beneath them.
 */
import { computed, ref, watch, nextTick, onUnmounted } from 'vue';
import { clamp } from '../core/music.js';
import { project, patternById, patternLength, songLength, nid, barLen, beatLen, songRows, orderedTracks, soundById, clipLength, clipTrim, fullClipLength, MIN_CLIP, sortedSections, songTrackAudible } from '../stores/project.js';
import { snapRound, snapFloor, formatPosition } from '../core/meter.js';
import { ui, HEAD_W, saveHeadW, toggleHeadCollapsed } from '../stores/ui.js';
import { takeSnapshot, commitUndo } from '../stores/history.js';
import { transport, startTransport, currentBeat } from '../engine/transport.js';
import { addClip, addSoundClip, addSongTrack, removeSongTrack, editPattern, PATTERN_MIME, SOUND_MIME, SONG_SNAPS, songGrid, snapSong, placeGrid, isFine, moveRow, moveRowBy,
  choosePattern, chooseSound, setClipEdges, addSection, removeSection, sectionGap } from '../engine/song.js';
import { importSoundFiles, previewSound, soundPeaks, soundState } from '../engine/sounds.js';
import { addAutomation, removeAutomation, setEffect, toggleTarget, setAutomationEnabled } from '../engine/automation.js';
import { AUTOMATION_EFFECTS, EFFECT_KEYS } from '../audio/effects.js';
import AutomationLane from './AutomationLane.vue';
import { useFrameValue } from '../composables/useFrameValue.js';
import { doubleTapper, recentlyDoubleTapped } from '../composables/touch.js';
import { device } from '../stores/device.js';

const COLLAPSED_W = 28; // folded track-header column: just each row's colour
const HEAD = computed(() => (ui.headCollapsed ? COLLAPSED_W : device.narrow ? Math.min(ui.headW, 132) : ui.headW)); // track header column width (px), resizable; narrower on phones
const LANE_H = 56;  // row height (px)
const AUTO_H = 72;  // automation row height (px)
const RULER_H = 24;
const SECTIONS_H = computed(() => (device.coarse ? 36 : 22)); // the Sections strip: taller for fingers
const TOP_H = computed(() => RULER_H + SECTIONS_H.value); // sticky header rows above the first track

const song = computed(() => project.song);
const beatPx = computed(() => ui.barPx / barLen()); // a bar is always barPx wide, whatever its length
const bars = computed(() => Math.max(32, Math.ceil(songLength() / barLen() - 1e-9) + 8));
/** Faint lines at every song-grid step (when finer than a bar). */
/** Ruler: short ticks at each counted beat, along the bottom edge. */
const rulerTicks = computed(() => {
  const beatW = beatLen() * beatPx.value;
  return beatW >= 6 ? { backgroundImage: 'linear-gradient(to right, var(--dim) 1px, transparent 1px)', backgroundSize: `${beatW}px 6px`, backgroundPosition: 'left bottom', backgroundRepeat: 'repeat-x' } : {};
});
/** Lane background: bar lines, a line per counted beat (3 per bar in 3/4), and snap lines when finer than a beat. */
const laneGrid = computed(() => {
  const layers = [[ui.barPx, 'var(--line)']];
  const beatW = beatLen() * beatPx.value;
  if (beatW >= 6 && beatLen() < barLen() - 1e-9) layers.push([beatW, 'var(--grid-beat)']);
  const snapW = songGrid() * beatPx.value;
  if (snapW >= 5 && songGrid() < beatLen() - 1e-9) layers.push([snapW, 'var(--grid-snap)']);
  return {
    backgroundImage: layers.map(([, c]) => `linear-gradient(to right, ${c} 1px, transparent 1px)`).join(', '),
    backgroundSize: layers.map(([w]) => `${w}px 100%`).join(', '),
  };
});
const width = computed(() => HEAD.value + bars.value * ui.barPx);
/** `#rrggbb` → rgba() at alpha `a` (anything else: mixed with transparent). */
function tint(color, a) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color || '');
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})` : `color-mix(in srgb, ${color} ${a * 100}%, transparent)`;
}
/** Lanes under a song section get a faint wash of its colour (one gradient for all sections, under the grid lines). */
const sectionWash = computed(() => {
  const stops = [];
  for (const x of sortedSections()) {
    const a = x.start * beatPx.value, b = x.end * beatPx.value, c = tint(x.color, 0.09);
    stops.push(`transparent ${a}px`, `${c} ${a}px`, `${c} ${b}px`, `transparent ${b}px`);
  }
  return stops.length ? `linear-gradient(to right, ${stops.join(', ')})` : null;
});
/** A lane's background: the grid, over the section wash. */
const laneBg = computed(() => {
  const g = laneGrid.value, wash = sectionWash.value;
  if (!wash) return g;
  return { backgroundImage: `${g.backgroundImage}, ${wash}`, backgroundSize: `${g.backgroundSize}, 100% 100%` };
});

/* mini note previews, one per pattern (shared by its clips) */
const previews = computed(() => {
  const out = new Map();
  for (const p of project.patterns) {
    const notes = p.layers.flatMap((l) => l.notes);
    const lo = notes.length ? Math.min(...notes.map((n) => n.pitch)) : 60;
    const hi = notes.length ? Math.max(...notes.map((n) => n.pitch)) : 60;
    const rowH = 100 / (hi - lo + 1);
    out.set(p.id, {
      len: patternLength(p),
      rects: notes.map((n) => ({ x: n.start, w: Math.max(0.08, n.dur), y: (hi - n.pitch) * rowH, h: Math.max(4, rowH * 0.8) })),
    });
  }
  return out;
});
const clipsOf = (t) => song.value.clips.filter((c) => c.trackId === t.id);
/* waveforms, one per decoded sound (shared by its clips): a mirrored outline, x in peak bins */
const waves = computed(() => {
  const out = new Map();
  for (const s of project.sounds) {
    const pk = soundState.ready[s.id] && soundPeaks(s.id);
    if (!pk) continue;
    const top = [...pk].map((v, i) => `${i},${50 - Math.max(1, v * 48)}`);
    const bottom = [...pk].map((v, i) => `${i},${50 + Math.max(1, v * 48)}`).reverse();
    out.set(s.id, { bins: pk.length, d: `M${top.join('L')}L${bottom.join('L')}Z` });
  }
  return out;
});
const isSound = (c) => c.soundId != null;
/** The part of a pattern preview / waveform a truncated clip shows (SVG viewBox). */
function previewBox(c) {
  const trim = clipTrim(c), len = clipLength(c) || 1;
  if (!isSound(c)) return `${trim} 0 ${len} 100`;
  const bins = waves.value.get(c.soundId).bins, full = fullClipLength(c) || 1;
  return `${(bins * trim) / full} 0 ${(bins * len) / full} 100`;
}
const cutStart = (c) => clipTrim(c) > 1e-9;
const cutEnd = (c) => fullClipLength(c) - clipTrim(c) - clipLength(c) > 1e-9;
const clipStyle = (c, t) => ({
  left: `${c.start * beatPx.value}px`,
  width: `${Math.max(12, (clipLength(c) || barLen()) * beatPx.value - 2)}px`,
  background: t.color,
});

/* ---- placing patterns ---- */
const beatAt = (e, el) => (e.clientX - el.getBoundingClientRect().left) / beatPx.value;
const DROP_TYPES = [PATTERN_MIME, SOUND_MIME, 'Files'];
async function onDrop(e, t) {
  const at = beatAt(e, e.currentTarget); // addClip/addSoundClip snap down to the song grid
  const fine = { fine: isFine(e) }; // Ctrl/⌘: exactly where dropped
  const dt = e.dataTransfer;
  if (dt.getData(PATTERN_MIME)) { const id = +dt.getData(PATTERN_MIME); if (addClip(t.id, id, at, fine)) choosePattern(id, { quiet: true }); return; }
  if (dt.getData(SOUND_MIME)) { addSoundClip(t.id, +dt.getData(SOUND_MIME), at, fine); return; }
  const files = [...(dt.files || [])];
  if (!files.length) return;
  // audio files from the desktop: import, then place them one after another from the drop point
  let start = snapSong(at, fine.fine);
  const ids = [];
  for (const s of await importSoundFiles(files)) {
    const c = addSoundClip(t.id, s.id, start, { fine: true }); // already placed: chain them back to back
    if (c) { ids.push(c.id); start = c.start + clipLength(c); }
  }
  if (ids.length) ui.songSel = new Set(ids);
}
const onDragOver = (e) => { if ([...e.dataTransfer.types].some((ty) => DROP_TYPES.includes(ty))) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
/** Double-click empty space: place the most recently selected pattern (picked in the list, or a clip of it clicked here). */
function onLaneDblClick(e, t) {
  const at = beatAt(e, e.currentTarget), fine = { fine: isFine(e) };
  if (ui.placeSound != null && soundById(ui.placeSound)) addSoundClip(t.id, ui.placeSound, at, fine);
  else addClip(t.id, project.curPattern, at, fine);
}
const onNativeLaneDblClick = (e, t) => { if (!recentlyDoubleTapped()) onLaneDblClick(e, t); };
/* touch: a tap is a pointerup the browser didn't turn into a scroll (that sends pointercancel instead) */
const dtap = doubleTapper();
function onLaneUp(e, t) {
  if (e.pointerType !== 'touch' || e.target !== e.currentTarget) return;
  if (marquee.value?.active) { dtap.reset(); return; } // the end of a double-tap-and-drag box selection, not a tap
  ui.songSel.clear(); // a tap on empty space deselects (on release: a long-press menu keeps the selection)
  if (dtap(e, `lane${t.id}`)) onLaneDblClick(e, t);
}
/** Song view zoom (also Ctrl+wheel). */
const zoom = (f) => { ui.barPx = clamp(ui.barPx * f, 24, 320); };

/* ---- moving clips ---- */
const drag = ref(null);
function onClipDown(e, c) {
  if (e.button !== 0) return;
  e.stopPropagation();
  if (e.shiftKey && !e.altKey) {
    if (ui.songSel.has(c.id)) { ui.songSel.delete(c.id); return; }
    ui.songSel.add(c.id);
    if (!isSound(c)) choosePattern(c.patternId, { quiet: true });
    return;
  }
  if (!ui.songSel.has(c.id)) ui.songSel = new Set([c.id]);
  if (isSound(c)) chooseSound(c.soundId, { quiet: true });
  else choosePattern(c.patternId, { quiet: true }); // double-clicking empty space now places this pattern
  const tracks = orderedTracks();
  const laneIdx = (id) => tracks.findIndex((t) => t.id === id);
  const anchorRow = rows.value.findIndex((r) => r.kind === 'track' && r.item.id === c.trackId);
  const el = scroller.value;
  drag.value = {
    x0: e.clientX, y0: e.clientY, sx0: el?.scrollLeft ?? 0, sy0: el?.scrollTop ?? 0, last: null,
    moved: false, copy: e.altKey, snap: takeSnapshot(), tracks,
    anchorLane: laneIdx(c.trackId), lastLane: laneIdx(c.trackId),
    anchorY: rowTops.value[anchorRow] + LANE_H / 2, // centre of the grabbed clip's row
    clip: c, touch: e.pointerType === 'touch',
    orig: song.value.clips.filter((x) => ui.songSel.has(x.id)).map((x) => ({ id: x.id, start: x.start, lane: laneIdx(x.trackId) })),
  };
  // Follow the pointer on the window: moving a clip to another track re-creates its element,
  // which would end pointer capture on it and lose the rest of the drag.
  window.addEventListener('pointermove', onClipMove);
  window.addEventListener('pointerup', onClipUp);
  window.addEventListener('pointercancel', onClipUp);
}
/** Pointer position as plain data (kept for auto-scrolling, which re-applies the last move). */
const pointerOf = (e) => ({ clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
function onClipMove(e) {
  const d = drag.value;
  if (!d) return;
  d.last = pointerOf(e);
  applyClipMove(d.last);
  if (d.moved) autoScroll.start();
}
function applyClipMove(e) {
  const d = drag.value;
  if (!d) return;
  const el = scroller.value;
  // distance moved in the song (scrolling while dragging counts too)
  const dx = e.clientX - d.x0 + ((el?.scrollLeft ?? 0) - d.sx0), dy = e.clientY - d.y0 + ((el?.scrollTop ?? 0) - d.sy0);
  if (!d.moved) {
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // still a click
    d.moved = true;
    commitUndo(d.snap);
    if (d.copy) { // Alt-drag: leave copies behind, drag the originals
      song.value.clips.push(...d.orig.map((o) => ({ ...song.value.clips.find((x) => x.id === o.id), id: nid() })));
    }
  }
  const grid = placeGrid(isFine(e) || e.shiftKey); // Ctrl/⌘ (or Shift): fine adjustment, ignoring the snap
  const minStart = Math.min(...d.orig.map((o) => o.start));
  const dBeats = Math.max(-minStart, snapRound(dx / beatPx.value, grid));
  // which pattern track is under the pointer? (over an automation row: stay on the last track)
  const over = rows.value[rowAt(d.anchorY + dy)];
  if (over?.kind === 'track') d.lastLane = d.tracks.indexOf(over.item);
  const lanes = d.tracks.length;
  const minLane = Math.min(...d.orig.map((o) => o.lane)), maxLane = Math.max(...d.orig.map((o) => o.lane));
  const dLane = clamp(d.lastLane - d.anchorLane, -minLane, lanes - 1 - maxLane);
  for (const o of d.orig) {
    const clip = song.value.clips.find((x) => x.id === o.id);
    clip.start = o.start + dBeats;
    clip.trackId = d.tracks[o.lane + dLane].id;
  }
}
function onClipUp(e) {
  const d = drag.value;
  drag.value = null;
  if (d?.touch && !d.moved && e?.type === 'pointerup' && dtap(e, `clip${d.clip.id}`)) openClip(d.clip); // double-tap
  autoScroll.stop();
  window.removeEventListener('pointermove', onClipMove);
  window.removeEventListener('pointerup', onClipUp);
  window.removeEventListener('pointercancel', onClipUp);
}

/** While dragging a clip (or a selection box) near the edge of the song area, scroll that way (so off-screen tracks and bars are reachable). */
const EDGE = 36; // px from the edge where scrolling starts
const autoScroll = {
  raf: 0,
  start() { if (!this.raf && typeof requestAnimationFrame !== 'undefined') this.raf = requestAnimationFrame(() => this.tick()); },
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; },
  tick() {
    this.raf = 0;
    const d = drag.value || marquee.value, el = scroller.value;
    if (!d?.last || !el) return;
    const apply = d === drag.value ? applyClipMove : applyMarquee;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return; // not laid out
    const speed = (pos, lo, hi) => (pos < lo + EDGE ? -Math.ceil((lo + EDGE - pos) / 3) : pos > hi - EDGE ? Math.ceil((pos - hi + EDGE) / 3) : 0);
    const vx = speed(d.last.clientX, r.left + HEAD.value, r.right), vy = speed(d.last.clientY, r.top + TOP_H.value, r.bottom);
    if (!vx && !vy) return;
    const x = el.scrollLeft, y = el.scrollTop;
    el.scrollLeft += vx;
    el.scrollTop += vy;
    if (el.scrollLeft !== x || el.scrollTop !== y) apply(d.last);
    this.start();
  },
};
onUnmounted(onClipUp);

/* ---- box selection: drag on empty track space to select every clip the box touches (Shift adds) ---- */
const gridEl = ref(null);
const marquee = ref(null); // { x0, y0, x1, y1 (grid px), base: Set, active, last, touch }
/** Pointer position in grid coordinates (the grid scrolls with the content, so this counts scrolling). */
function gridPoint(e) {
  const r = gridEl.value?.getBoundingClientRect() ?? { left: 0, top: 0 };
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
let lanePointer = 'mouse'; // what last pressed a lane: a finger's long-press menu keeps the selection
function onLaneDown(e, t) {
  lanePointer = e.pointerType || 'mouse';
  if (e.button !== 0) return;
  const touch = e.pointerType === 'touch';
  // a finger scrolls the song; tap, then press again and drag to box-select (onLaneTouchStart stops the scroll)
  if (touch && !dtap.pending(e, `lane${t.id}`)) return; // (a tap deselects when it lifts: see onLaneUp)
  const { x, y } = gridPoint(e);
  const base = e.shiftKey ? new Set(ui.songSel) : new Set();
  ui.songSel = new Set(base);
  ui.autoSel = null;
  marquee.value = { x0: x, y0: y, x1: x, y1: y, base, active: false, last: null, touch };
  window.addEventListener('pointermove', onMarqueeMove);
  window.addEventListener('pointerup', onMarqueeUp);
  window.addEventListener('pointercancel', onMarqueeUp);
}
/** A touch box selection is starting: keep the browser from scrolling the song instead (touchstart follows pointerdown). */
const onLaneTouchStart = (e) => { if (marquee.value?.touch && e.cancelable) e.preventDefault(); };
function onMarqueeMove(e) {
  const m = marquee.value;
  if (!m) return;
  m.last = pointerOf(e);
  applyMarquee(m.last);
  if (m.active) autoScroll.start();
}
function applyMarquee(e) {
  const m = marquee.value;
  if (!m) return;
  const { x, y } = gridPoint(e);
  if (!m.active && Math.abs(x - m.x0) < 4 && Math.abs(y - m.y0) < 4) return; // still a click
  m.active = true;
  m.x1 = Math.max(HEAD.value, x); // not into the header column
  m.y1 = Math.max(TOP_H.value, y);
  const box = marqueeBox.value;
  const hit = new Set(m.base);
  rows.value.forEach((r, i) => {
    if (r.kind !== 'track') return;
    const top = TOP_H.value + rowTops.value[i];
    if (top + LANE_H <= box.top || top >= box.top + box.height) return;
    for (const c of clipsOf(r.item)) {
      const left = HEAD.value + c.start * beatPx.value;
      const right = left + Math.max(12, (clipLength(c) || barLen()) * beatPx.value - 2); // as drawn
      if (right > box.left && left < box.left + box.width) hit.add(c.id);
    }
  });
  ui.songSel = hit;
}
function onMarqueeUp() {
  marquee.value = null;
  autoScroll.stop();
  window.removeEventListener('pointermove', onMarqueeMove);
  window.removeEventListener('pointerup', onMarqueeUp);
  window.removeEventListener('pointercancel', onMarqueeUp);
}
onUnmounted(onMarqueeUp);
const marqueeBox = computed(() => {
  const m = marquee.value;
  if (!m) return null;
  const x0 = Math.max(HEAD.value, m.x0), y0 = Math.max(TOP_H.value, m.y0);
  return { left: Math.min(x0, m.x1), top: Math.min(y0, m.y1), width: Math.abs(m.x1 - x0), height: Math.abs(m.y1 - y0) };
});

/* ---- truncating clips: drag the left or right edge (Ctrl/⌘ or Shift: fine) ---- */
const trimDrag = ref(null);
function onTrimDown(e, c, side) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  ui.songSel = new Set([c.id]);
  if (!isSound(c)) choosePattern(c.patternId, { quiet: true });
  trimDrag.value = { id: c.id, side, x0: e.clientX, sx0: scroller.value?.scrollLeft ?? 0, from: c.start, to: c.start + clipLength(c), snap: takeSnapshot(), moved: false };
  window.addEventListener('pointermove', onTrimMove);
  window.addEventListener('pointerup', onTrimUp);
  window.addEventListener('pointercancel', onTrimUp);
}
function onTrimMove(e) {
  const d = trimDrag.value;
  if (!d) return;
  const dx = e.clientX - d.x0 + ((scroller.value?.scrollLeft ?? 0) - d.sx0);
  if (!d.moved) {
    if (Math.abs(dx) < 3) return;
    d.moved = true;
    commitUndo(d.snap);
  }
  const clip = song.value.clips.find((x) => x.id === d.id);
  if (!clip) return;
  const grid = placeGrid(isFine(e) || e.shiftKey);
  const edge = Math.max(0, snapRound((d.side === 'start' ? d.from : d.to) + dx / beatPx.value, grid)); // the edge lands on the grid
  if (d.side === 'start') setClipEdges(clip, edge, d.to);
  else setClipEdges(clip, d.from, edge);
}
function onTrimUp() {
  trimDrag.value = null;
  window.removeEventListener('pointermove', onTrimMove);
  window.removeEventListener('pointerup', onTrimUp);
  window.removeEventListener('pointercancel', onTrimUp);
}
onUnmounted(onTrimUp);

/* ---- song sections (intro, verse, chorus…): drag in the strip to add one; drag to move, edges to resize ---- */
const sections = computed(() => sortedSections());
const sectionStyle = (x) => ({
  left: `${x.start * beatPx.value}px`, width: `${Math.max(4, (x.end - x.start) * beatPx.value)}px`,
  background: tint(x.color, 0.32), borderColor: x.color,
});
const secDrag = ref(null);
const editingSection = ref(null); // id of the section whose name is being typed
function startSecDrag(e, d) {
  e.preventDefault();
  e.stopPropagation();
  secDrag.value = { x0: e.clientX, sx0: scroller.value?.scrollLeft ?? 0, snap: takeSnapshot(), moved: false, ...d };
  window.addEventListener('pointermove', onSecMove);
  window.addEventListener('pointerup', onSecUp);
  window.addEventListener('pointercancel', onSecUp);
}
/** Empty strip: drag out a new section. */
function onStripDown(e) {
  if (e.button !== 0) return;
  if (e.pointerType === 'touch') return; // a finger scrolls the song; double-tap / long-press the strip to add a section
  const at = Math.max(0, beatAt(e, e.currentTarget));
  const gap = sectionGap(at);
  if (!gap) return;
  startSecDrag(e, { mode: 'create', anchor: snapRound(at, placeGrid(isFine(e))), gap, id: null });
}
/** A section: drag its body to move it, or an edge (`side`) to resize it. */
function onSectionDown(e, x, side = 'move') {
  if (e.button !== 0 || editingSection.value === x.id) return;
  e.currentTarget.closest?.('.section')?.focus();
  startSecDrag(e, { mode: side, id: x.id, touch: e.pointerType === 'touch', orig: { start: x.start, end: x.end }, gap: sectionGap(x.start, x.id) || [x.start, x.end] });
}
function onSecMove(e) {
  const d = secDrag.value;
  if (!d) return;
  const dx = e.clientX - d.x0 + ((scroller.value?.scrollLeft ?? 0) - d.sx0);
  if (!d.moved) {
    if (Math.abs(dx) < 4) return;
    d.moved = true;
    if (d.mode !== 'create') commitUndo(d.snap);
  }
  const grid = placeGrid(isFine(e) || e.shiftKey);
  const [lo, hi] = d.gap;
  if (d.mode === 'create') {
    const b = Math.min(hi, Math.max(lo, snapRound(d.anchor + dx / beatPx.value, grid)));
    const from = Math.max(lo, Math.min(d.anchor, b)), to = Math.min(hi, Math.max(d.anchor, b));
    let x = d.id && song.value.sections.find((s) => s.id === d.id);
    if (!x) {
      if (to - from < MIN_CLIP) return;
      x = addSection(from, to);
      if (!x) return;
      d.id = x.id;
    }
    if (to - from >= MIN_CLIP) Object.assign(x, { start: from, end: to });
    return;
  }
  const x = song.value.sections.find((s) => s.id === d.id);
  if (!x) return;
  const { start, end } = d.orig;
  if (d.mode === 'move') {
    const len = end - start;
    const s0 = Math.min(Math.max(lo, start + snapRound(dx / beatPx.value, grid)), hi - len);
    Object.assign(x, { start: s0, end: s0 + len });
  } else if (d.mode === 'start') {
    x.start = Math.min(Math.max(lo, snapRound(start + dx / beatPx.value, grid)), end - MIN_CLIP);
  } else {
    x.end = Math.max(Math.min(hi, snapRound(end + dx / beatPx.value, grid)), start + MIN_CLIP);
  }
}
function onSecUp(e) {
  const d = secDrag.value;
  secDrag.value = null;
  if (d?.touch && d.mode === 'move' && !d.moved && e?.type === 'pointerup' && dtap(e, `sec${d.id}`)) { // double-tap a section: rename it
    const x = song.value.sections.find((s) => s.id === d.id);
    if (x) renameSection(x);
  }
  const made = d?.mode === 'create' && d.id && song.value.sections.find((s) => s.id === d.id);
  if (made) renameSection(made); // just drawn: type its name
  window.removeEventListener('pointermove', onSecMove);
  window.removeEventListener('pointerup', onSecUp);
  window.removeEventListener('pointercancel', onSecUp);
}
onUnmounted(onSecUp);
/** Double-click (or double-tap) empty strip: a 4-bar section from the bar clicked. */
function onStripDblClick(e) { addSectionAt(beatAt(e, e.currentTarget), 4); }
function addSectionAt(beat, barsLong) {
  const at = snapFloor(Math.max(0, beat), barLen());
  const x = addSection(at, at + barsLong * barLen());
  if (x) renameSection(x);
  return x;
}
const onNativeStripDblClick = (e) => { if (!recentlyDoubleTapped()) onStripDblClick(e); };
function onStripUp(e) {
  if (e.pointerType === 'touch' && e.target === e.currentTarget && dtap(e, 'strip')) onStripDblClick(e);
}
/** Right-click / long-press the empty strip: add a section there. */
function onStripContext(e) {
  e.preventDefault();
  const beat = beatAt(e, e.currentTarget);
  const free = !!sectionGap(beat);
  Object.assign(ui.ctxMenu, {
    open: true, kind: 'custom', serial: ui.ctxMenu.serial + 1, x: e.clientX, y: e.clientY,
    items: [
      { header: `Bar ${Math.floor(Math.max(0, beat) / barLen()) + 1}` },
      { label: 'Add section here (4 bars)', run: () => addSectionAt(beat, 4), enabled: () => free },
      { label: 'Add section here (8 bars)', run: () => addSectionAt(beat, 8), enabled: () => free },
    ],
  });
}
/** Right-click / long-press a section: rename, recolour, delete. */
function onSectionContext(e, x) {
  e.preventDefault();
  Object.assign(ui.ctxMenu, {
    open: true, kind: 'custom', serial: ui.ctxMenu.serial + 1, x: e.clientX, y: e.clientY,
    items: [
      { header: x.name },
      { label: 'Rename', run: () => renameSection(x) },
      { label: 'Change colour…', run: () => {
        const el = document.querySelector(`[data-section="${x.id}"] input[type=color]`);
        try { if (el?.showPicker) { el.showPicker(); return; } } catch { /* fall back */ }
        el?.click();
      } },
      null,
      { label: 'Delete section', run: () => removeSection(x.id) },
    ],
  });
}
function renameSection(x) {
  editingSection.value = x.id;
  nextTick(() => { const el = document.querySelector(`[data-section="${x.id}"] input.sec-name`); el?.focus(); el?.select(); });
}
function finishRename(x) {
  if (!x.name.trim()) x.name = 'Section';
  editingSection.value = null;
}
function onSectionKey(e, x) {
  if (e.target !== e.currentTarget) return; // typing in the name / colour fields
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); removeSection(x.id); }
  else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); e.stopPropagation(); renameSection(x); }
}
const sectionTitle = (x) => `${x.name}: ${formatPosition(x.start, project.timeSig)} – ${formatPosition(x.end, project.timeSig)} — drag to move, drag an edge to resize, double-click to rename, Delete removes`;

function onClipContext(e, c) {
  e.preventDefault();
  if (!ui.songSel.has(c.id)) ui.songSel = new Set([c.id]);
  Object.assign(ui.ctxMenu, { open: true, kind: 'clip', x: e.clientX, y: e.clientY, beat: c.start, trackId: c.trackId });
}
/** Right-click empty space on a track: the clip menu, with "Paste here" aimed at that spot. A long-press keeps the selection, so its menu acts on the selected clips. */
function onLaneContext(e, t) {
  e.preventDefault();
  if (lanePointer !== 'touch') ui.songSel.clear();
  Object.assign(ui.ctxMenu, { open: true, kind: 'clip', x: e.clientX, y: e.clientY, beat: snapSong(beatAt(e, e.currentTarget)), trackId: t.id });
}
/** Double-click / Enter: open a pattern clip in the editor; play a sound clip. */
function openClip(c) {
  if (isSound(c)) previewSound(c.soundId);
  else editPattern(c.patternId);
}
function onClipKey(e, c) {
  if (e.key === 'Enter') { e.preventDefault(); openClip(c); }
}

/* ---- ruler, playhead, zoom ---- */
function onRulerDown(e) {
  const beat = Math.max(0, snapRound(beatAt(e, e.currentTarget), placeGrid(isFine(e)))); // nearest grid line (Ctrl/⌘: exact)
  ui.songPlayhead = beat;
  if (transport.playing && transport.mode === 'song') startTransport(beat, { song: true });
}
const playhead = useFrameValue(() => currentBeat());

/* ---- resizing the track header column ---- */
let resize = null;
function onResizeDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.setPointerCapture?.(e.pointerId);
  resize = { x0: e.clientX, w0: ui.headW };
}
function onResizeMove(e) {
  if (resize) ui.headW = clamp(Math.round(resize.w0 + e.clientX - resize.x0), HEAD_W.min, HEAD_W.max);
}
function onResizeUp() { if (resize) saveHeadW(); resize = null; }
function onResizeKey(e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  e.stopPropagation();
  ui.headW = clamp(ui.headW + (e.key === 'ArrowRight' ? 10 : -10), HEAD_W.min, HEAD_W.max);
  saveHeadW();
}
const scroller = ref(null);
watch(() => ui.songPlayhead, (b) => { // back to the start (Restart / Home): scroll there too
  if (b === 0 && scroller.value) scroller.value.scrollLeft = 0;
});
watch(playhead, (b) => { // keep the playhead on screen while playing
  const el = scroller.value;
  if (!el || !transport.playing) return;
  const x = HEAD.value + b * beatPx.value;
  if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - HEAD.value - 40;
});
/* ---- two-finger pinch zooms the timeline (the page itself doesn't zoom), keeping the bar between the fingers under them; the fingers also scroll ---- */
let pinch = null; // { spread, barPx, beat, offX, top, midY }
const PINCH_MIN = 20; // px: closer fingers count as this far apart
function fingers(e) {
  const [a, b] = e.touches;
  return { mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2, spread: Math.max(PINCH_MIN, Math.abs(a.clientX - b.clientX)) };
}
function onPinchStart(e) {
  const el = scroller.value;
  if (e.touches?.length !== 2 || !el) return;
  // a second finger ends whatever the first one started (anything already moved stays moved)
  onClipUp(); onMarqueeUp(); onTrimUp(); onSecUp();
  const f = fingers(e), offX = f.mx - el.getBoundingClientRect().left;
  pinch = { spread: f.spread, barPx: ui.barPx, beat: (el.scrollLeft + offX - HEAD.value) / beatPx.value, offX, top: el.scrollTop, midY: f.my };
}
function onPinchMove(e) {
  const el = scroller.value;
  if (!pinch || e.touches?.length !== 2 || !el) return;
  if (e.cancelable) e.preventDefault(); // we scroll and zoom ourselves
  const f = fingers(e), p = pinch;
  ui.barPx = clamp(p.barPx * (f.spread / p.spread), 24, 320); // fingers apart = zoom in
  const offX = f.mx - el.getBoundingClientRect().left;
  nextTick(() => { // once the grid has its new width
    el.scrollLeft = HEAD.value + p.beat * beatPx.value - offX;
    el.scrollTop = p.top - (f.my - p.midY);
  });
}
function onPinchEnd(e) { if (!(e.touches?.length >= 2)) pinch = null; }

function onWheel(e) {
  if (!e.ctrlKey) return;
  e.preventDefault();
  ui.barPx = clamp(ui.barPx * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 24, 320);
}

function onRemoveTrack(t) {
  const n = clipsOf(t).length;
  if (n && !confirm(`Delete "${t.name}" and its ${n} clip${n === 1 ? '' : 's'}?`)) return;
  removeSongTrack(t.id);
}
const clipName = (c) => (isSound(c) ? soundById(c.soundId)?.name : patternById(c.patternId)?.name) ?? '?';
const clipHint = (c) => (isSound(c) ? (soundState.missing[c.soundId] ? 'audio missing' : 'double-click to play') : 'double-click to edit');

/* ---- rows: pattern tracks and automation tracks, in one order ---- */
const rows = computed(() => songRows());
const rowH = (r) => (r.kind === 'track' ? LANE_H : AUTO_H);
const rowTops = computed(() => { let y = 0; return rows.value.map((r) => { const top = y; y += rowH(r); return top; }); });
/** Index of the row at height `y` (measured from the top of the first row), clamped. */
function rowAt(y) {
  const tops = rowTops.value;
  let i = 0;
  while (i + 1 < tops.length && y >= tops[i + 1]) i++;
  return i;
}

/* reordering: drag a row's ⠿ grip (one undo step), or focus it and press ↑/↓ */
const rowDrag = ref(null); // { key, from, to, y0, center }
function onGripDown(e, r, i) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.setPointerCapture?.(e.pointerId);
  rowDrag.value = { key: r.key, from: i, to: i, y0: e.clientY, center: rowTops.value[i] + rowH(r) / 2 };
}
function onGripMove(e) {
  const d = rowDrag.value;
  if (!d) return;
  const y = d.center + (e.clientY - d.y0);
  // insertion point among the other rows: after every row whose middle is above the pointer
  d.to = rows.value.reduce((n, r, i) => n + (i !== d.from && rowTops.value[i] + rowH(r) / 2 < y ? 1 : 0), 0);
}
function onGripUp() {
  const d = rowDrag.value;
  rowDrag.value = null;
  if (d && d.to !== d.from) moveRow(d.key, d.to);
}
function onGripKey(e, r) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  e.stopPropagation();
  moveRowBy(r.key, e.key === 'ArrowUp' ? -1 : 1);
  nextTick(() => document.querySelector(`[data-row="${r.key}"] .grip`)?.focus()); // keep focus on the moved row
}
/** Where the drop line goes: the top of the row the dragged one will land before. */
const dropY = computed(() => {
  const d = rowDrag.value;
  if (!d) return 0;
  const others = rows.value.map((r, i) => i).filter((i) => i !== d.from);
  if (d.to >= others.length) { const last = others[others.length - 1]; return rowTops.value[last] + rowH(rows.value[last]); }
  return rowTops.value[others[d.to]];
});

/* ---- automation rows ---- */
const targetLabel = (a) => {
  const names = orderedTracks().filter((t) => a.targets.includes(t.id)).map((t) => t.name);
  return names.length === 0 ? 'no tracks' : names.length <= 2 ? names.join(', ') : `${names.length} tracks`;
};
/* effect settings sliders: one undo step per adjustment */
let optSnap = null;
const optStart = () => { if (!optSnap) optSnap = takeSnapshot(); };
const optCommit = () => { if (optSnap) commitUndo(optSnap); optSnap = null; };

/* ---- phones: a row's actions (mute, solo, colour, move, delete) live in its ⋯ menu ---- */
/** Open the colour picker of a row (its swatch input is visually hidden on phones). */
function pickColor(r) {
  const el = document.querySelector(`[data-row="${r.key}"] input[type=color]`);
  if (!el) return;
  try { if (el.showPicker) { el.showPicker(); return; } } catch { /* not allowed here: fall back to a click */ }
  el.click();
}
function rowActions(r, i) {
  const t = r.item, track = r.kind === 'track';
  const check = (on, label) => (on ? `✓ ${label}` : label);
  return [
    { header: t.name },
    ...(track ? [
      { label: () => check(t.mute, 'Mute'), run: () => { t.mute = !t.mute; } },
      { label: () => check(t.solo, 'Solo'), run: () => { t.solo = !t.solo; } },
    ] : [
      { label: () => (t.enabled !== false ? 'Switch off (keeps its curve)' : 'Switch on'), run: () => setAutomationEnabled(t, t.enabled === false) },
    ]),
    { label: 'Change colour…', run: () => pickColor(r) },
    null,
    { label: 'Move up', run: () => moveRowBy(r.key, -1), enabled: () => i > 0 },
    { label: 'Move down', run: () => moveRowBy(r.key, 1), enabled: () => i < rows.value.length - 1 },
    null,
    { label: track ? 'Delete track' : 'Delete automation track', run: () => (track ? onRemoveTrack(t) : onRemoveAutomation(t)) },
  ];
}
function openRowActions(e, r, i) {
  const b = e.currentTarget.getBoundingClientRect();
  Object.assign(ui.ctxMenu, { open: true, kind: 'custom', items: rowActions(r, i), serial: ui.ctxMenu.serial + 1, x: b.left, y: b.bottom + 2 });
}

function onRemoveAutomation(a) {
  if (a.points.length && !confirm(`Delete "${a.name}" and its ${a.points.length} point${a.points.length === 1 ? '' : 's'}?`)) return;
  removeAutomation(a.id);
}
</script>

<template>
  <div class="song-view" :class="{ collapsed: ui.headCollapsed }" :style="{ '--head-w': HEAD + 'px' }" @wheel="onWheel">
    <div ref="scroller" class="scroller" @pointerdown.self="ui.songSel.clear()"
      @touchstart.capture="onPinchStart" @touchmove.capture="onPinchMove" @touchend.capture="onPinchEnd" @touchcancel.capture="onPinchEnd">
      <div ref="gridEl" class="grid" :style="{ width: width + 'px' }">
        <div class="ruler-row">
          <div class="corner">
            <button class="small fold" :aria-expanded="!ui.headCollapsed" :aria-label="ui.headCollapsed ? 'Show track names' : 'Hide track names'"
              :title="ui.headCollapsed ? 'Show the track names and controls' : 'Fold the track column to just each track’s colour'" @click="toggleHeadCollapsed">{{ ui.headCollapsed ? '»' : '«' }}</button>
            <div class="resizer" role="separator" aria-orientation="vertical" :aria-valuenow="ui.headW"
              :aria-valuemin="HEAD_W.min" :aria-valuemax="HEAD_W.max" aria-label="Track header width" tabindex="0"
              title="Drag to resize the track names column (double-click to reset)"
              @pointerdown="onResizeDown" @pointermove="onResizeMove" @pointerup="onResizeUp" @pointercancel="onResizeUp"
              @dblclick="ui.headW = HEAD_W.def; saveHeadW()" @keydown="onResizeKey"></div>
            <span class="corner-title">Tracks</span>
            <span class="zoom" role="group" aria-label="Zoom">
              <button class="small" title="Zoom out (Ctrl+wheel)" aria-label="Zoom out" @click="zoom(1 / 1.25)">−</button>
              <button class="small" title="Zoom in (Ctrl+wheel)" aria-label="Zoom in" @click="zoom(1.25)">+</button>
            </span>
            <label class="snap" title="Where clips can be placed (also in Settings → Editing)"><span class="snap-word">Snap</span>
              <select v-model="ui.songSnap" aria-label="Song snap">
                <option v-for="o in SONG_SNAPS" :key="o.label" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
          </div>
          <div class="ruler" :style="rulerTicks" title="Click to move the song playhead (Ctrl+click: exact position)" @pointerdown="onRulerDown">
            <span v-for="b in bars" :key="b" class="bar-label" :style="{ left: (b - 1) * ui.barPx + 'px' }">{{ b }}</span>
          </div>
        </div>
        <div class="sections-row" :style="{ top: RULER_H + 'px', height: SECTIONS_H + 'px', '--sec-h': SECTIONS_H + 'px' }">
          <div class="corner sec-corner" title="Mark parts of the song: drag in the strip to the right (or double-click it for 4 bars)">Sections</div>
          <div class="sections" :class="{ empty: !sections.length }" title="Drag to mark a section of the song (intro, verse, chorus…); double-click for a 4-bar section; right-click for more"
            @pointerdown.self="onStripDown" @pointerup.self="onStripUp" @dblclick.self="onNativeStripDblClick" @contextmenu.self="onStripContext">
            <span v-if="!sections.length" class="sec-hint" :style="{ left: '6px' }">{{ device.coarse ? 'Double-tap here to add a section (intro, verse, chorus…)' : 'Drag here to mark an intro, verse, chorus…' }}</span>
            <div v-for="x in sections" :key="x.id" :data-section="x.id" class="section" :class="{ moving: secDrag?.id === x.id }" :style="sectionStyle(x)"
              role="group" tabindex="0" :aria-label="`Section ${x.name}`" :title="sectionTitle(x)"
              @pointerdown.self="onSectionDown($event, x)" @dblclick.self="!recentlyDoubleTapped() && renameSection(x)" @keydown="onSectionKey($event, x)"
              @contextmenu="onSectionContext($event, x)">
              <div class="sec-edge start" @pointerdown="onSectionDown($event, x, 'start')"></div>
              <input v-model="x.color" type="color" class="swatch sec-swatch" :aria-label="`Colour of ${x.name}`" title="Section colour" @pointerdown.stop>
              <input v-if="editingSection === x.id" v-model="x.name" class="sec-name" :aria-label="`Name of section ${x.name}`"
                @pointerdown.stop @blur="finishRename(x)" @keydown.enter.prevent="$event.target.blur()" @keydown.escape.prevent="$event.target.blur()">
              <span v-else class="sec-label" @pointerdown="onSectionDown($event, x)" @dblclick="!recentlyDoubleTapped() && renameSection(x)">{{ x.name }}</span>
              <button class="sec-del" :aria-label="`Delete section ${x.name}`" title="Delete section" @pointerdown.stop @click="removeSection(x.id)">✕</button>
              <div class="sec-edge end" @pointerdown="onSectionDown($event, x, 'end')"></div>
            </div>
          </div>
        </div>

        <template v-for="(r, i) in rows" :key="r.key">
          <div v-if="r.kind === 'track'" :data-row="r.key" class="lane-row" :class="{ dragging: rowDrag?.key === r.key }" :style="{ height: LANE_H + 'px' }">
            <div class="head" :style="{ borderLeftColor: r.item.color }">
              <button v-if="ui.headCollapsed" class="strip" :style="{ background: r.item.color }" :class="{ off: !songTrackAudible(r.item) }"
                :title="`${r.item.name}${r.item.mute ? ' (muted)' : ''}${r.item.solo ? ' (solo)' : ''} — tap for actions`" :aria-label="`Actions for ${r.item.name}`"
                @click="openRowActions($event, r, i)"></button>
              <button class="grip" :aria-label="`Move ${r.item.name} (drag, or ↑/↓)`" title="Drag to move this row (or focus and press ↑/↓)"
                @pointerdown="onGripDown($event, r, i)" @pointermove="onGripMove" @pointerup="onGripUp" @pointercancel="onGripUp" @keydown="onGripKey($event, r)">⠿</button>
              <input v-model="r.item.color" type="color" class="swatch" :aria-label="`Colour of ${r.item.name}`" title="Track colour">
              <input v-model="r.item.name" class="name" :title="r.item.name" :aria-label="`Name of ${r.item.name}`">
              <span v-if="r.item.mute" class="badge" title="Muted">M</span>
              <span v-if="r.item.solo" class="badge" title="Solo">S</span>
              <button class="small actions" :aria-label="`Actions for ${r.item.name}`" title="Mute, solo, colour, move, delete" @click="openRowActions($event, r, i)">⋯</button>
              <button class="small inline" :class="{ on: r.item.mute }" title="Mute track" @click="r.item.mute = !r.item.mute">M</button>
              <button class="small inline" :class="{ on: r.item.solo }" title="Solo track" @click="r.item.solo = !r.item.solo">S</button>
              <button class="small del inline" title="Delete track" :aria-label="`Delete ${r.item.name}`" @click="onRemoveTrack(r.item)">✕</button>
            </div>
            <div class="lane" :class="{ muted: !songTrackAudible(r.item) }" :style="laneBg"
              @dragover="onDragOver" @drop.prevent="onDrop($event, r.item)" @dblclick.self="onNativeLaneDblClick($event, r.item)" @pointerup.self="onLaneUp($event, r.item)"
              @contextmenu.self="onLaneContext($event, r.item)"
              @pointerdown.self="onLaneDown($event, r.item)" @touchstart.self="onLaneTouchStart">
              <div v-for="c in clipsOf(r.item)" :key="c.id" class="clip" :class="{ sel: ui.songSel.has(c.id), sound: isSound(c), missing: isSound(c) && soundState.missing[c.soundId], 'cut-start': cutStart(c), 'cut-end': cutEnd(c) }" :style="clipStyle(c, r.item)"
                role="button" tabindex="0" :aria-label="`${isSound(c) ? 'Sound' : 'Pattern'} ${clipName(c)} at ${formatPosition(c.start, project.timeSig)}`"
                :title="`${clipName(c)} at ${formatPosition(c.start, project.timeSig)} — ${clipHint(c)}, drag to move (Ctrl for fine adjustment, Alt copies), drag an edge to truncate, ←/→ nudge (Ctrl+←/→ fine)`"
                @pointerdown="onClipDown($event, c)"
                @dblclick.stop="!recentlyDoubleTapped() && openClip(c)" @contextmenu="onClipContext($event, c)" @keydown="onClipKey($event, c)">
                <span class="clip-name">{{ isSound(c) ? '♪ ' : '' }}{{ clipName(c) }}</span>
                <svg v-if="isSound(c) && waves.get(c.soundId)" class="preview wave" :viewBox="previewBox(c)" preserveAspectRatio="none">
                  <path :d="waves.get(c.soundId).d" />
                </svg>
                <svg v-else-if="!isSound(c) && previews.get(c.patternId)" class="preview" :viewBox="previewBox(c)" preserveAspectRatio="none">
                  <rect v-for="(r, i) in previews.get(c.patternId).rects" :key="i" :x="r.x" :y="r.y" :width="r.w" :height="r.h" />
                </svg>
                <div class="trim start" title="Drag to truncate the beginning (Ctrl: fine)" @pointerdown="onTrimDown($event, c, 'start')" @dblclick.stop></div>
                <div class="trim end" title="Drag to truncate the end (Ctrl: fine)" @pointerdown="onTrimDown($event, c, 'end')" @dblclick.stop></div>
              </div>
            </div>
          </div>

          <div v-else :data-row="r.key" class="lane-row auto-row" :class="{ disabled: r.item.enabled === false, dragging: rowDrag?.key === r.key }" :style="{ height: AUTO_H + 'px' }">
            <div class="head auto-head" :style="{ borderLeftColor: r.item.color }">
              <button v-if="ui.headCollapsed" class="strip auto" :style="{ background: r.item.color }" :class="{ off: r.item.enabled === false }"
                :title="`${r.item.name}${r.item.enabled === false ? ' (off)' : ''} — tap for actions`" :aria-label="`Actions for ${r.item.name}`"
                @click="openRowActions($event, r, i)"></button>
              <div class="line">
                <button class="grip" :aria-label="`Move ${r.item.name} (drag, or ↑/↓)`" title="Drag to move this row (or focus and press ↑/↓)"
                  @pointerdown="onGripDown($event, r, i)" @pointermove="onGripMove" @pointerup="onGripUp" @pointercancel="onGripUp" @keydown="onGripKey($event, r)">⠿</button>
                <input v-model="r.item.color" type="color" class="swatch" :aria-label="`Colour of ${r.item.name}`" title="Automation colour">
                <input v-model="r.item.name" class="name" :title="r.item.name" :aria-label="`Name of ${r.item.name}`">
                <span v-if="r.item.enabled === false" class="badge" title="Switched off">Off</span>
                <button class="small actions" :aria-label="`Actions for ${r.item.name}`" title="On/off, colour, move, delete" @click="openRowActions($event, r, i)">⋯</button>
                <button class="small onoff inline" :class="{ on: r.item.enabled !== false }" :aria-pressed="r.item.enabled !== false"
                  :title="r.item.enabled !== false ? 'Switch this automation off (keeps its curve)' : 'Switch this automation on'"
                  @click="setAutomationEnabled(r.item, r.item.enabled === false)">{{ r.item.enabled !== false ? 'On' : 'Off' }}</button>
                <button class="small del inline" title="Delete automation track" :aria-label="`Delete ${r.item.name}`" @click="onRemoveAutomation(r.item)">✕</button>
              </div>
              <div class="line">
                <select :value="r.item.effect" :aria-label="`Effect of ${r.item.name}`" title="The effect this automation controls" @change="setEffect(r.item, $event.target.value)">
                  <option v-for="k in EFFECT_KEYS" :key="k" :value="k">{{ AUTOMATION_EFFECTS[k].label }}</option>
                </select>
                <details class="targets">
                  <summary :title="`Applies to: ${targetLabel(r.item)}`">→ {{ targetLabel(r.item) }}</summary>
                  <div class="target-list" role="group" :aria-label="`Tracks ${r.item.name} applies to`">
                    <label v-for="t in orderedTracks()" :key="t.id">
                      <input type="checkbox" :checked="r.item.targets.includes(t.id)" @change="toggleTarget(r.item, t.id)">
                      <span class="dot" :style="{ background: t.color }"></span>{{ t.name }}
                    </label>
                  </div>
                </details>
                <details v-if="r.item.options && AUTOMATION_EFFECTS[r.item.effect].options" class="targets fx-opts">
                  <summary :title="`${AUTOMATION_EFFECTS[r.item.effect].label} settings`" :aria-label="`${r.item.name} settings`">⚙</summary>
                  <div class="target-list opts" role="group" :aria-label="`${r.item.name} effect settings`">
                    <label v-for="(d, key) in AUTOMATION_EFFECTS[r.item.effect].options.params" :key="key" :title="d.help || ''">
                      {{ d.label }} <b>{{ d.fmt(r.item.options[key]) }}</b>
                      <input v-model.number="r.item.options[key]" type="range" :min="d.min" :max="d.max" :step="d.step"
                        @pointerdown="optStart" @keydown="optStart" @change="optCommit">
                    </label>
                    <p class="opt-help">The curve sets the {{ AUTOMATION_EFFECTS[r.item.effect].label.split(' — ')[1] || 'amount' }}; these set the rest.</p>
                  </div>
                </details>
              </div>
            </div>
            <div class="lane auto-lane-wrap" :style="laneBg">
              <AutomationLane :auto="r.item" :beat-px="beatPx" :width="bars * ui.barPx" :height="AUTO_H" :color="r.item.color" />
            </div>
          </div>

        </template>
        <div v-if="rowDrag && rowDrag.to !== rowDrag.from" class="drop-line" :style="{ top: TOP_H + dropY + 'px' }"></div>

        <div class="add-row">
          <div class="add-head">
            <button @click="addSongTrack">+ Add track</button>
            <button title="A row whose curve drives an effect (volume, pan, filters, reverb, echo…) on chosen tracks" @click="addAutomation()">+ Add automation</button>
          </div>
          <span class="help">Drop patterns or sounds from the left (or audio files from your computer) · double-click empty space to place the last selected pattern · drag on empty space to box-select (Shift adds) · drag a clip's edge to truncate it · drag in the Sections strip to mark intro, verse, chorus… · hold Ctrl for fine adjustment · Ctrl+wheel zooms</span>
        </div>
        <div v-if="marquee?.active" class="marquee" :style="{ left: marqueeBox.left + 'px', top: marqueeBox.top + 'px', width: marqueeBox.width + 'px', height: marqueeBox.height + 'px' }"></div>
        <div class="playhead" :style="{ left: HEAD + playhead * beatPx + 'px' }"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.song-view { position: relative; min-width: 0; min-height: 0; }
.scroller { position: absolute; inset: 0; overflow: auto; }
.grid { position: relative; min-height: 100%; }
.ruler-row, .lane-row { display: flex; }
.corner, .head { position: sticky; left: 0; z-index: 2; width: var(--head-w); flex: none; background: var(--panel); border-right: 1px solid var(--line); }
.ruler-row { position: sticky; top: 0; z-index: 3; height: 24px; background: var(--panel); border-bottom: 1px solid var(--line); }
.corner { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 6px 0 8px; color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; z-index: 4; }
.snap { text-transform: none; letter-spacing: 0; gap: 3px; min-width: 0; flex: 0 1 auto; }
.snap select { padding: 0 2px; font-size: 11px; min-width: 44px; width: 100%; }
.fold, .zoom { flex: none; }
.corner-title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* the corner follows the column's width: drop the title, then the word "Snap", before anything spills into the timeline */
.ruler-row .corner { container-type: inline-size; }
@container (max-width: 250px) { .corner-title { display: none; } }
@container (max-width: 190px) { .snap-word { display: none; } }
/* a narrow track column (any screen): name + ⋯ menu, as on phones */
.lane-row .head { container-type: inline-size; }
@container (max-width: 200px) {
  .lane-row .head .inline { display: none; }
  .lane-row .head .actions, .lane-row .head .badge { display: inline-block; }
  .lane-row .head .swatch { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
}
.ruler { position: relative; flex: 1; cursor: pointer; }
.bar-label { position: absolute; top: 0; bottom: 0; padding-left: 4px; border-left: 1px solid var(--line); color: var(--dim); font-size: 11px; line-height: 24px; }
.head { display: flex; align-items: center; gap: 4px; padding: 0 6px; border-bottom: 1px solid var(--line); border-left: 4px solid; }
.swatch { width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%; overflow: hidden; background: none; cursor: pointer; flex: none; }
.swatch::-webkit-color-swatch-wrapper { padding: 0; }
.swatch::-webkit-color-swatch { border: 0; border-radius: 50%; }
.swatch::-moz-color-swatch { border: 0; border-radius: 50%; }
.head .small { padding: 1px 5px; font-size: 11px; }
.head .del { opacity: 0; transition: opacity .1s; }
.lane-row:hover .del, .head:focus-within .del { opacity: 1; } /* destructive: only when you're on the row */
.head .name { padding: 2px 5px; }
.corner { position: sticky; }
.resizer { position: absolute; top: 0; right: -4px; width: 8px; height: 100%; cursor: col-resize; z-index: 5; }
.resizer::after { content: ''; position: absolute; top: 4px; bottom: 4px; left: 3px; width: 2px; border-radius: 1px; background: transparent; }
.resizer:hover::after, .resizer:focus-visible::after { background: var(--accent); }
.name { flex: 1; min-width: 0; }
.lane { position: relative; flex: 1; border-bottom: 1px solid var(--line);
  background-image: linear-gradient(to right, var(--line) 1px, transparent 1px); background-color: var(--bg); }
.lane.muted { opacity: .45; } /* muted, or another track is soloed */
.clip { position: absolute; top: 4px; bottom: 4px; border-radius: 5px; overflow: hidden; cursor: grab; touch-action: none;
  color: rgb(var(--ink)); box-shadow: inset 0 0 0 1px rgba(0,0,0,.25); user-select: none; }
.clip:active { cursor: grabbing; }
.clip.sel { box-shadow: inset 0 0 0 2px var(--strong), 0 0 0 1px var(--bg); }
.clip:focus-visible { outline: 2px solid var(--strong); outline-offset: 1px; }
.clip-name { position: absolute; top: 2px; left: 5px; right: 4px; font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 1; }
.preview { position: absolute; left: 2px; right: 2px; top: 17px; bottom: 3px; width: calc(100% - 4px); height: calc(100% - 20px); }
.preview rect { fill: rgba(var(--ink), .55); }
.wave path { fill: rgba(var(--ink), .5); }
.clip.sound { background-image: linear-gradient(var(--raise), var(--raise)); }
.clip.missing { opacity: .5; background-image: repeating-linear-gradient(45deg, transparent 0 6px, rgba(0,0,0,.18) 6px 12px); }
.auto-head { flex-direction: column; align-items: stretch; justify-content: center; gap: 3px; padding: 3px 6px; }
.auto-head:has(details[open]) { z-index: 5; } /* keep the targets list above the rows below */
.auto-head .line { display: flex; align-items: center; gap: 4px; min-width: 0; }
.auto-head select { flex: 1; min-width: 0; font-size: 12px; padding: 1px 4px; }
.targets { position: relative; border: 0; padding: 0; margin: 0; flex: 1; min-width: 0; }
.targets summary { font-size: 11px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; list-style: none; cursor: pointer; padding: 2px 4px; border: 1px solid var(--line); border-radius: 4px; }
.target-list { position: absolute; z-index: 6; top: 100%; left: 0; min-width: 160px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px; box-shadow: 0 8px 24px var(--shadow); display: grid; gap: 4px; }
.target-list label { color: var(--text); font-size: 12px; gap: 6px; }
.fx-opts { flex: none; }
.fx-opts summary { padding: 1px 6px; }
.target-list.opts { min-width: 210px; left: 0; }
.target-list.opts label { flex-direction: column; align-items: stretch; gap: 2px; }
.target-list.opts b { color: var(--dim); font-weight: 600; }
.opt-help { margin: 2px 0 0; color: var(--dim); font-size: 11px; }
.target-list .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.auto-row .lane { background-color: var(--lane-alt); }
.grip { flex: none; width: 16px; padding: 0; border: 0; background: none; color: var(--dim); cursor: grab; font-size: 14px; line-height: 1; touch-action: none; }
.grip:hover, .grip:focus-visible { color: var(--text); }
.grip:active { cursor: grabbing; }
.lane-row.dragging { opacity: .5; }
.drop-line { position: absolute; left: 0; right: 0; height: 3px; margin-top: -1px; background: var(--accent); z-index: 7; pointer-events: none; box-shadow: 0 0 6px var(--accent); }
.onoff { min-width: 34px; }
.head .actions, .head .badge { display: none; }
.head .actions { flex: none; min-width: 28px; padding: 0 6px; font-weight: 700; }
.badge { flex: none; padding: 0 4px; border-radius: 3px; background: var(--accent); color: var(--on-accent); font-size: 10px; font-weight: 700; line-height: 16px; }
.auto-row.disabled .lane { opacity: .35; }
.auto-row.disabled .auto-head .name { text-decoration: line-through; color: var(--dim); }
.add-row { display: flex; align-items: flex-start; }
.add-head { position: sticky; left: 0; z-index: 2; width: var(--head-w); flex: none; display: flex; flex-direction: column; gap: 4px; padding: 8px 6px; background: var(--panel); border-right: 1px solid var(--line); }
.add-head button { width: 100%; }
.add-row .help { padding: 10px; margin: 0; }
.trim { position: absolute; top: 0; bottom: 0; width: 6px; max-width: 30%; cursor: ew-resize; z-index: 2; touch-action: none; }
.trim.start { left: 0; }
.trim.end { right: 0; }
.trim:hover, .clip.sel .trim:hover { background: rgba(255,255,255,.45); }
.clip.cut-start { border-top-left-radius: 0; border-bottom-left-radius: 0; box-shadow: inset 2px 0 0 rgba(var(--ink),.55), inset 0 0 0 1px rgba(0,0,0,.25); }
.clip.cut-end { border-top-right-radius: 0; border-bottom-right-radius: 0; box-shadow: inset -2px 0 0 rgba(var(--ink),.55), inset 0 0 0 1px rgba(0,0,0,.25); }
.clip.cut-start.cut-end { box-shadow: inset 2px 0 0 rgba(var(--ink),.55), inset -2px 0 0 rgba(var(--ink),.55), inset 0 0 0 1px rgba(0,0,0,.25); }
.clip.sel.cut-start, .clip.sel.cut-end { box-shadow: inset 0 0 0 2px var(--strong), 0 0 0 1px var(--bg); }
.sections-row { display: flex; position: sticky; z-index: 3; background: var(--panel); border-bottom: 1px solid var(--line); }
.sec-corner { font-size: 10px; }
.sections { position: relative; flex: 1; cursor: crosshair; background: var(--bg); }
.sec-hint { position: absolute; top: 0; line-height: var(--sec-h, 22px); font-size: 11px; color: var(--dim); pointer-events: none; white-space: nowrap; }
.section { position: absolute; top: 2px; bottom: 2px; display: flex; align-items: center; gap: 3px; padding: 0 6px; border-left: 3px solid; border-radius: 3px;
  overflow: hidden; cursor: grab; touch-action: none; user-select: none; font-size: 11px; font-weight: 600; color: var(--text); }
.section.moving, .section:active { cursor: grabbing; }
.section:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; }
.sec-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sec-name { flex: 1; min-width: 40px; height: 16px; padding: 0 3px; font-size: 11px; }
.sec-swatch { width: 10px; height: 10px; }
.sec-del { flex: none; padding: 0 3px; border: 0; background: none; color: var(--text); font-size: 10px; line-height: 1; opacity: 0; cursor: pointer; }
.section:hover .sec-del, .section:focus-within .sec-del { opacity: .8; }
.sec-edge { position: absolute; top: 0; bottom: 0; width: 6px; cursor: ew-resize; z-index: 1; }
.sec-edge.start { left: -3px; }
.sec-edge.end { right: 0; }
.sec-edge:hover { background: color-mix(in srgb, var(--strong) 30%, transparent); }
.marquee { position: absolute; z-index: 1; pointer-events: none; border: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); border-radius: 2px; }
.zoom { display: inline-flex; gap: 2px; text-transform: none; letter-spacing: 0; }
.zoom button { padding: 0 6px; line-height: 1.2; }
@media (max-width: 760px) {
  .corner-title, .snap { display: none; } /* phones: song snap lives in Settings → Editing */
  .corner { padding: 0 4px; gap: 3px; justify-content: flex-start; }
  .head { gap: 2px; padding: 0 3px; }
  /* the colour shows on the left edge; the picker opens from the ⋯ menu */
  .head .swatch { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .head .inline { display: none; } /* mute / solo / on-off / delete: in the ⋯ menu */
  .head .actions { display: inline-block; }
  .head .badge { display: inline-block; }
  .add-row .help { display: none; }
}
@media (pointer: coarse) {
  .trim { width: 16px; max-width: 34%; }
  .head .del, .sec-del { opacity: .6; } /* no hover on a touch screen */
  /* the taller Sections strip (SECTIONS_H): bigger labels and controls */
  .section { top: 3px; bottom: 3px; font-size: 13px; gap: 6px; padding: 0 8px; border-left-width: 4px; }
  .sec-name { height: 26px; min-height: 0; font-size: 13px; }
  .sec-swatch { width: 16px; height: 16px; min-height: 0; }
  .sec-del { min-height: 0; padding: 0 6px; font-size: 13px; }
  .sec-hint { font-size: 12px; }
  .sec-edge { width: 18px; }
  .clip { -webkit-touch-callout: none; }
  .corner button, .corner select { min-height: 0; } /* the header rows have fixed heights (positions depend on them) */
  .zoom button { min-width: 26px; }
}
/* folded track column: only each row's colour (tap it for the row's actions) */
.fold { flex: none; padding: 0 5px; min-width: 20px; font-weight: 700; }
.collapsed .corner { padding: 0 3px; justify-content: center; }
.collapsed .corner > :not(.fold), .collapsed .sec-corner { font-size: 0; }
.collapsed .corner > :not(.fold) { display: none; }
.collapsed .head { padding: 0; border-left-width: 0; }
.collapsed .head > :not(.strip):not(.swatch), .collapsed .auto-head .line > :not(.swatch), .collapsed .auto-head .line:not(:first-of-type) { display: none; }
.collapsed .head .swatch { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; } /* kept for "Change colour…" */
.collapsed .auto-head .line { position: absolute; }
.strip { position: absolute; inset: 3px 4px; padding: 0; border: 0; border-radius: 4px; cursor: pointer; min-height: 0; }
.strip.auto { background-image: repeating-linear-gradient(0deg, rgba(0,0,0,.18) 0 3px, transparent 3px 6px) !important; }
.strip.off { opacity: .35; }
.strip:focus-visible { outline: 2px solid var(--strong); outline-offset: 1px; }
.collapsed .add-head { padding: 8px 2px; }
.collapsed .add-head button { display: none; }
.playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--strong); pointer-events: none; z-index: 1; opacity: .85; }
</style>
