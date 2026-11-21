<script setup>
import { transport, tp, currentBeat } from '../engine/transport.js';
import { rec } from '../engine/recorder.js';
import { beatLen } from '../stores/project.js';
import { useFrameValue } from '../composables/useFrameValue.js';

const state = useFrameValue(() => {
  if (!transport.recording) return { text: '', flash: false };
  const b = currentBeat();
  return {
    text: b < tp.startBeat ? `Count-in ${Math.ceil((tp.startBeat - b) / beatLen() - 1e-9)}` : `REC  ·  ${rec.taps.length} taps`,
    flash: performance.now() - rec.flashTap < 90,
  };
});
</script>

<template>
  <div v-if="transport.recording" class="rec-overlay" :class="{ flash: state.flash }">{{ state.text }}</div>
</template>

<style scoped>
.rec-overlay {
  position: absolute; top: 34px; right: 14px; padding: 6px 10px; border-radius: 6px;
  background: rgba(255, 90, 90, .9); color: #fff; font-weight: 600; pointer-events: none;
}
.rec-overlay.flash { background: rgba(255, 217, 90, .95); }
</style>
