<script setup>
/**
 * One automation curve in the song timeline.
 *  double-click empty space: add a point · drag a point: move it (song snap; Ctrl/⌘ or Shift = fine, 1/64 beat)
 *  select a point: its horizontal bezier handles appear; drag one sideways to ease in/out
 *  right-click a point (or Delete): remove it
 */
import { computed, ref } from 'vue';
import { curvePath, handleBeats } from '../core/automation.js';
import { snapRound } from '../core/meter.js';
import { AUTOMATION_EFFECTS } from '../audio/effects.js';
import { ui } from '../stores/ui.js';
import { takeSnapshot, commitUndo } from '../stores/history.js';
import { addPoint, deletePoint } from '../engine/automation.js';
import { placeGrid, isFine } from '../engine/song.js';

// the automation track is a store object: dragging edits its points in place (intentional)
const props = defineProps({
  auto: { type: Object, required: true },
  beatPx: { type: Number, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  color: { type: String, required: true },
});

const PAD = 7;
const fx = computed(() => AUTOMATION_EFFECTS[props.auto.effect] || AUTOMATION_EFFECTS.volume);
const X = (beat) => beat * props.beatPx;
const Y = (v) => PAD + (1 - v) * (props.height - 2 * PAD);
const toValue = (y) => Math.max(0, Math.min(1, 1 - (y - PAD) / (props.height - 2 * PAD)));
const path = computed(() => curvePath(props.auto.points, X, Y, props.width, fx.value.default));
const selected = computed(() => (ui.autoSel?.id === props.auto.id ? ui.autoSel.index : -1));
const handles = computed(() => {
  const i = selected.value, p = props.auto.points[i];
  if (!p) return [];
  const { left, right } = handleBeats(props.auto.points, i);
  return [left != null && { side: 'left', x: X(left) }, right != null && { side: 'right', x: X(right) }].filter(Boolean).map((h) => ({ ...h, y: Y(p.value) }));
});

const svg = ref(null);
const hover = ref(null); // { x, y, text }
const local = (e) => { const r = svg.value.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
/** Ctrl/⌘ (or Shift) held: fine placement, 1/64 beat, ignoring the song snap. */
const snapBeat = (beat, e) => Math.max(0, snapRound(beat, placeGrid(isFine(e) || e.shiftKey)));

function onDblClick(e) {
  if (e.target.closest('.pt, .handle')) return;
  const { x, y } = local(e);
  const index = addPoint(props.auto, snapBeat(x / props.beatPx, e), toValue(y));
  ui.autoSel = { id: props.auto.id, index };
  ui.songSel.clear();
}

/* ---- dragging points and handles (one undo step per drag) ---- */
let drag = null;
function startDrag(e, kind, index, side) {
  e.stopPropagation();
  e.preventDefault();
  ui.autoSel = { id: props.auto.id, index };
  ui.songSel.clear();
  e.currentTarget.setPointerCapture?.(e.pointerId);
  drag = { kind, index, side, x0: e.clientX, y0: e.clientY, moved: false, snap: takeSnapshot() };
}
function onMove(e) {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.abs(e.clientX - drag.x0) < 3 && Math.abs(e.clientY - drag.y0) < 3) return;
    drag.moved = true;
    commitUndo(drag.snap);
  }
  const pts = props.auto.points, p = pts[drag.index], { x, y } = local(e);
  if (drag.kind === 'point') {
    const lo = drag.index > 0 ? pts[drag.index - 1].beat : 0;
    const hi = drag.index < pts.length - 1 ? pts[drag.index + 1].beat : Infinity;
    p.beat = Math.min(hi, Math.max(lo, snapBeat(x / props.beatPx, e))); // stays between its neighbours
    p.value = toValue(y);
  } else { // handle: horizontal distance from the point sets the ease
    const nb = drag.side === 'left' ? pts[drag.index - 1] : pts[drag.index + 1];
    const half = Math.abs(nb.beat - p.beat) / 2;
    p.ease = half > 0 ? Math.max(0, Math.min(1, Math.abs(x / props.beatPx - p.beat) / half)) : p.ease;
  }
  hover.value = { x: X(p.beat), y: Y(p.value), text: drag.kind === 'point' ? fx.value.format(p.value) : `ease ${Math.round(p.ease * 100)}%` };
}
function onUp() { drag = null; hover.value = null; }

function onPointContext(e, i) {
  e.preventDefault();
  e.stopPropagation();
  deletePoint(props.auto, i);
}
function onHover(e, p) { if (!drag) hover.value = { x: X(p.beat), y: Y(p.value), text: fx.value.format(p.value) }; }
const leave = () => { if (!drag) hover.value = null; };
</script>

<template>
  <svg ref="svg" class="auto-lane" :width="width" :height="height" role="img"
    :aria-label="`${fx.label} automation, ${auto.points.length} point${auto.points.length === 1 ? '' : 's'}`"
    @dblclick="onDblClick" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp"
    @pointerdown.self="ui.autoSel = null">
    <line class="default" x1="0" :x2="width" :y1="Y(fx.default)" :y2="Y(fx.default)" />
    <path class="area" :d="`${path} L${width},${height} L0,${height} Z`" :style="{ fill: color }" />
    <path class="curve" :d="path" :style="{ stroke: color }" />
    <g v-for="h in handles" :key="h.side">
      <line class="handle-line" :x1="X(auto.points[selected].beat)" :y1="h.y" :x2="h.x" :y2="h.y" />
      <rect class="handle" :x="h.x - 4" :y="h.y - 4" width="8" height="8"
        :aria-label="`${h.side} handle: drag sideways to change the curve`"
        @pointerdown="startDrag($event, 'handle', selected, h.side)" />
    </g>
    <circle v-for="(p, i) in auto.points" :key="i" class="pt" :class="{ sel: i === selected }"
      :cx="X(p.beat)" :cy="Y(p.value)" :r="i === selected ? 6 : 5" :style="{ fill: color }"
      @pointerdown="startDrag($event, 'point', i)" @contextmenu="onPointContext($event, i)"
      @pointerenter="onHover($event, p)" @pointerleave="leave" />
    <text v-if="!auto.points.length" class="hint" x="8" :y="height / 2 + 4">Double-click to add points · {{ fx.label }} {{ fx.format(fx.default) }}</text>
    <text v-if="hover" class="tip" :x="hover.x + 9" :y="Math.max(12, hover.y - 8)">{{ hover.text }}</text>
  </svg>
</template>

<style scoped>
.auto-lane { position: absolute; left: 0; top: 0; display: block; touch-action: none; user-select: none; }
.default { stroke: var(--line); stroke-dasharray: 3 4; }
.area { opacity: .12; pointer-events: none; }
.curve { fill: none; stroke-width: 2; pointer-events: none; }
.pt { stroke: var(--bg); stroke-width: 2; cursor: grab; }
.pt.sel { stroke: var(--strong); }
.handle-line { stroke: var(--strong); stroke-width: 1; opacity: .6; pointer-events: none; }
.handle { fill: var(--bg); stroke: var(--strong); stroke-width: 1.5; cursor: ew-resize; }
.hint { fill: var(--dim); font-size: 11px; pointer-events: none; }
.tip { fill: var(--text); font-size: 11px; font-weight: 600; paint-order: stroke; stroke: var(--bg); stroke-width: 3px; pointer-events: none; }
</style>
