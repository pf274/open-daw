<script setup>
/**
 * Frequency response of the filter chain: low frequencies left, high right (log scale),
 * gain in dB up/down. Faint curve per filter, bold combined curve, dashed combined curve
 * at envelope peak when any filter sweeps. Handles drag frequency (x) and, for the
 * Frequency Amplifier, boost (y).
 */
import { computed, ref } from 'vue';
import { GRAPH_RANGE, chainDb, logFrequencies } from '../core/filterResponse.js';
import {
  filterSpec, filterAtEnvelope, filterAtTime, normalizePatch, usesGain, FILTER_LIMITS, FILTER_LABELS,
} from '../audio/customSynth.js';
import { clamp } from '../core/music.js';
import { getCtx } from '../audio/context.js';
import { previewClock } from '../engine/preview.js';
import { useFrameValue } from '../composables/useFrameValue.js';

// filters are the dialog's working copy: dragging edits them in place (intentional)
const props = defineProps({ filters: { type: Array, required: true }, colors: { type: Array, required: true } });

const W = 600, H = 190, PAD = { l: 34, r: 8, t: 8, b: 18 };
const { fMin, fMax, dbMin, dbMax } = GRAPH_RANGE;
const FREQS = logFrequencies(140);
const x = (f) => PAD.l + (Math.log(f / fMin) / Math.log(fMax / fMin)) * (W - PAD.l - PAD.r);
const y = (db) => PAD.t + ((dbMax - clamp(db, dbMin, dbMax)) / (dbMax - dbMin)) * (H - PAD.t - PAD.b);
const xToF = (px) => fMin * (fMax / fMin) ** ((px - PAD.l) / (W - PAD.l - PAD.r));
const yToDb = (py) => dbMax - ((py - PAD.t) / (H - PAD.t - PAD.b)) * (dbMax - dbMin);

const GRID_F = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const GRID_DB = [-24, -12, 0, 12];
const fLabel = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));

const active = computed(() => props.filters.map((f, i) => ({ f, i, color: props.colors[i % props.colors.length] })).filter((a) => a.f.enabled));
const specs = computed(() => active.value.map((a) => filterSpec(a.f)));
const line = (dbAt) => FREQS.map((f, k) => `${k ? 'L' : 'M'}${x(f).toFixed(1)},${y(dbAt(f)).toFixed(1)}`).join(' ');

const combined = computed(() => line((f) => chainDb(specs.value, f)));
const perFilter = computed(() => active.value.map((a, k) => ({ ...a, d: line((f) => chainDb([specs.value[k]], f)) })));
const sweeps = computed(() => specs.value.some((s) => s.env?.mode === 'freq'));
const peakCurve = computed(() => (sweeps.value ? line((f) => chainDb(specs.value.map((s) => filterAtEnvelope(s, 1)), f)) : ''));
const handles = computed(() => active.value.map((a, k) => ({
  ...a, cx: x(a.f.freq), cy: y(chainDb([specs.value[k]], a.f.freq)),
})));

/* ---- live animation while Preview plays ----
   Follows the most recently started voice, using the patch the preview was played with. */
let snap = { id: -1, attack: 0, items: [] };
function previewFilters() {
  if (snap.id !== previewClock.id) {
    const p = normalizePatch(previewClock.synth);
    snap = {
      id: previewClock.id,
      attack: p.attack,
      items: p.filters.map((f, i) => ({ i, f })).filter((o) => o.f.enabled).map((o) => ({ i: o.i, spec: filterSpec(o.f) })),
    };
  }
  return snap;
}
const live = useFrameValue(() => {
  const c = previewClock;
  if (!c.active || !c.synth) return null;
  const now = getCtx()?.currentTime ?? 0;
  if (now > c.end) return null;
  const { attack, items } = previewFilters();
  let voice = null;
  for (const v of c.voices) {
    const ts = c.t0 + (v.start - c.first) * c.spb;
    if (ts <= now && (!voice || ts > voice.ts)) voice = { ts, dur: (v.end - v.start) * c.spb };
  }
  const t = voice ? now - voice.ts : 0;
  const offT = voice ? Math.max(voice.dur, attack + 0.01) : Infinity; // note-off, as playVoice computes it
  return { t, items: items.map((o) => ({ i: o.i, spec: voice ? filterAtTime(o.spec, t, offT) : o.spec })) };
});
const liveCurve = computed(() => (live.value ? line((f) => chainDb(live.value.items.map((o) => o.spec), f)) : ''));
const liveMarks = computed(() => (live.value
  ? live.value.items.map((o) => ({
    i: o.i, color: props.colors[o.i % props.colors.length], cx: x(o.spec.freq), cy: y(chainDb([o.spec], o.spec.freq)),
  }))
  : []));

/* ---- dragging ---- */
const svg = ref(null);
const dragging = ref(null);
function toLocal(e) {
  const r = svg.value.getBoundingClientRect();
  return { px: ((e.clientX - r.left) / r.width) * W, py: ((e.clientY - r.top) / r.height) * H };
}
function down(e, a) {
  dragging.value = a.f.id;
  e.target.setPointerCapture?.(e.pointerId);
}
function move(e, a) {
  if (dragging.value !== a.f.id) return;
  const { px, py } = toLocal(e);
  a.f.freq = Math.round(clamp(xToF(px), ...FILTER_LIMITS.freq));
  if (usesGain(a.f.type)) a.f.gain = Math.round(clamp(yToDb(py), ...FILTER_LIMITS.gain) * 2) / 2;
}
const up = () => { dragging.value = null; };
</script>

<template>
  <svg ref="svg" class="graph" :class="{ live: !!live }" :viewBox="`0 0 ${W} ${H}`" role="img"
    :aria-label="`Frequency response of ${active.length} filter${active.length === 1 ? '' : 's'}`">
    <g class="grid">
      <line v-for="f in GRID_F" :key="'f' + f" :x1="x(f)" :x2="x(f)" :y1="PAD.t" :y2="H - PAD.b" />
      <line v-for="d in GRID_DB" :key="'d' + d" :x1="PAD.l" :x2="W - PAD.r" :y1="y(d)" :y2="y(d)" :class="{ zero: d === 0 }" />
      <text v-for="f in GRID_F" :key="'tf' + f" :x="x(f)" :y="H - 5" text-anchor="middle">{{ fLabel(f) }}</text>
      <text v-for="d in GRID_DB" :key="'td' + d" :x="PAD.l - 4" :y="y(d) + 3" text-anchor="end">{{ d > 0 ? '+' : '' }}{{ d }}</text>
      <text :x="PAD.l - 4" :y="H - 5" text-anchor="end">Hz</text>
    </g>
    <path v-for="p in perFilter" :key="'c' + p.f.id" class="single" :d="p.d" :style="{ stroke: p.color }" />
    <path v-if="peakCurve" class="peak" :d="peakCurve" />
    <path class="combined" :d="combined" />
    <template v-if="live">
      <path class="live-curve" :d="liveCurve" />
      <circle v-for="mk in liveMarks" :key="'l' + mk.i" class="live-mark" :cx="mk.cx" :cy="mk.cy" r="6" :style="{ stroke: mk.color }" />
      <text class="live-badge" :x="W - PAD.r - 4" :y="PAD.t + 12" text-anchor="end">● LIVE {{ live.t.toFixed(2) }} s</text>
    </template>
    <g v-for="h in handles" :key="'h' + h.f.id" class="handle" :class="{ dragging: dragging === h.f.id }"
      @pointerdown.prevent="down($event, h)" @pointermove="move($event, h)" @pointerup="up" @pointercancel="up">
      <title>{{ h.i + 1 }}. {{ FILTER_LABELS[h.f.type] }} — drag to change frequency{{ usesGain(h.f.type) ? ' and boost' : '' }}</title>
      <circle :cx="h.cx" :cy="h.cy" r="9" :style="{ fill: h.color }" />
      <text :x="h.cx" :y="h.cy + 3.5" text-anchor="middle">{{ h.i + 1 }}</text>
    </g>
    <text v-if="!active.length" class="empty" :x="W / 2" :y="H / 2" text-anchor="middle">No filters: the sound passes through unchanged</text>
  </svg>
  <p class="legend">
    <template v-if="live"><b class="live-legend">Green: what the filters are doing right now.</b> </template>
    Bold: all filters combined · faint: each filter<span v-if="peakCurve"> · dashed: at envelope peak</span>.
    Drag a numbered handle to move a filter{{ filters.some((f) => usesGain(f.type)) ? ' (up/down sets an amplifier’s boost)' : '' }}.
  </p>
</template>

<style scoped>
.graph { width: 100%; height: auto; display: block; background: var(--panel2); border-radius: 6px; touch-action: none; user-select: none; }
.grid line { stroke: var(--line); stroke-width: 1; }
.grid line.zero { stroke: var(--dim); stroke-dasharray: 3 3; }
.grid text { fill: var(--dim); font-size: 9px; }
.single { fill: none; stroke-width: 1.25; opacity: .55; }
.combined { fill: none; stroke: var(--text); stroke-width: 2.25; }
.peak { fill: none; stroke: var(--text); stroke-width: 1.5; stroke-dasharray: 5 4; opacity: .7; }
.live .combined, .live .single, .live .peak { opacity: .3; }
.live-curve { fill: none; stroke: var(--ok); stroke-width: 2.5; pointer-events: none; }
.live-mark { fill: none; stroke-width: 2; pointer-events: none; }
.live-badge { fill: var(--ok); font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; pointer-events: none; }
.handle { cursor: grab; }
.handle.dragging { cursor: grabbing; }
.handle circle { stroke: var(--bg); stroke-width: 2; }
.handle text { fill: rgb(var(--ink)); font-size: 10px; font-weight: 700; pointer-events: none; }
.empty { fill: var(--dim); font-size: 12px; }
.legend { margin: 4px 0 0; color: var(--dim); font-size: 11px; }
.live-legend { color: var(--ok); font-weight: 600; }
</style>
