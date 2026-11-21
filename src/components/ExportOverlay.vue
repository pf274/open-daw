<script setup>
/** Covers the app while a WAV export renders: a progress ring, what it's doing, and Cancel (or Esc). */
import { computed } from 'vue';
import { exportState, cancelExport } from '../engine/files.js';

const R = 26, CIRC = 2 * Math.PI * R;
const pct = computed(() => (exportState.progress == null ? null : Math.round(exportState.progress * 100)));
const label = computed(() => ({
  samples: 'Loading piano samples…',
  render: `Rendering the ${exportState.scope}…`,
  encode: 'Writing the WAV file…',
}[exportState.phase] || 'Exporting…'));
const measured = computed(() => exportState.phase === 'render' && pct.value != null);
</script>

<template>
  <div v-if="exportState.rendering" class="backdrop">
    <div class="card" role="dialog" aria-modal="true" aria-label="Exporting audio">
      <div class="ring" role="progressbar" :aria-valuenow="measured ? pct : undefined" aria-valuemin="0" aria-valuemax="100" :aria-valuetext="label">
        <svg viewBox="0 0 64 64" :class="{ spin: !measured }">
          <circle class="track" cx="32" cy="32" :r="R" />
          <circle class="bar" cx="32" cy="32" :r="R" :stroke-dasharray="CIRC"
            :stroke-dashoffset="measured ? CIRC * (1 - exportState.progress) : CIRC * 0.72" />
        </svg>
        <span v-if="measured" class="pct">{{ pct }}%</span>
      </div>
      <p class="label" aria-live="polite">{{ label }}</p>
      <button :disabled="exportState.cancelled || exportState.phase === 'encode'" @click="cancelExport">{{ exportState.cancelled ? 'Cancelling…' : 'Cancel' }}</button>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 40; background: var(--backdrop); display: grid; place-items: center; padding: 16px;
  animation: appear .15s .2s both; } /* short exports finish before it fades in: no flash */
@keyframes appear { from { opacity: 0; } }
.card { display: flex; flex-direction: column; align-items: center; gap: 12px; min-width: 200px; padding: 22px 26px 18px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 16px 40px var(--shadow); }
.ring { position: relative; width: 96px; height: 96px; }
svg { width: 100%; height: 100%; transform: rotate(-90deg); }
svg.spin { animation: spin 1s linear infinite; }
circle { fill: none; stroke-width: 5; }
.track { stroke: var(--line); }
.bar { stroke: var(--accent); stroke-linecap: round; transition: stroke-dashoffset .15s linear; }
.pct { position: absolute; inset: 0; display: grid; place-items: center; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
.label { margin: 0; color: var(--dim); }
@keyframes spin { from { transform: rotate(-90deg); } to { transform: rotate(270deg); } }
@media (prefers-reduced-motion: reduce) { svg.spin { animation-duration: 3s; } }
</style>
