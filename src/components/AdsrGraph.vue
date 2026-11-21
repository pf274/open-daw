<script setup>
/** Small envelope picture: attack, decay to sustain, a fixed "held" section, release. */
import { computed } from 'vue';

const props = defineProps({
  attack: { type: Number, required: true },
  decay: { type: Number, required: true },
  sustain: { type: Number, required: true },
  release: { type: Number, required: true },
  height: { type: Number, default: 56 },
  color: { type: String, default: 'var(--accent)' },
});

const W = 220;
const path = computed(() => {
  const { attack: a, decay: d, sustain: s, release: r, height: H } = props;
  const hold = 0.35, total = a + d + hold + r, pad = 3;
  const x = (t) => pad + (t / total) * (W - 2 * pad), y = (v) => H - pad - v * (H - 2 * pad);
  const pts = [[0, 0], [a, 1], [a + d, s], [a + d + hold, s], [total, 0]];
  return pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
});
</script>

<template>
  <svg class="adsr" :viewBox="`0 0 ${W} ${height}`" :style="{ height: height + 'px' }" role="img" aria-label="Envelope shape">
    <path :d="path" :style="{ stroke: color }" />
  </svg>
</template>

<style scoped>
.adsr { width: 100%; display: block; background: var(--panel2); border-radius: 4px; }
path { fill: none; stroke-width: 2; stroke-linejoin: round; }
</style>
