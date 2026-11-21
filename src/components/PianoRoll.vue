<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { project } from '../stores/project.js';
import { ui } from '../stores/ui.js';
import { view, bx, clampView, invalidate } from '../stores/view.js';
import { transport, currentBeat } from '../engine/transport.js';
import { pick } from '../engine/pick.js';
import { onFrame } from '../engine/frame.js';
import { renderRoll } from '../roll/render.js';
import { createRollInteraction } from '../roll/interaction.js';
import RecOverlay from './RecOverlay.vue';
import PickOverlay from './PickOverlay.vue';

const wrap = ref(null);
const canvas = ref(null);
let g = null, handlers = null, ro = null, offFrame = null;

function resize() {
  const r = canvas.value.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  view.W = r.width;
  view.H = r.height;
  canvas.value.width = Math.round(r.width * dpr);
  canvas.value.height = Math.round(r.height * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  clampView();
  invalidate();
}

// any document or editor change → redraw on the next frame
watch([project, ui], invalidate, { deep: true });

function frame() {
  if (transport.playing) {
    const b = currentBeat(); // follow the playhead (incl. jumping back on loop wraps)
    if (bx(b) > view.W - 60 || bx(b) < view.KEYW) ui.scrollX = Math.max(0, b - 1);
  }
  if (view.dirty || transport.playing || ui.mic.on || pick.active) {
    view.dirty = false;
    renderRoll(g);
  }
}

const onMove = (e) => handlers.onPointerMove(e);
const onUp = (e) => handlers.onPointerUp(e);
const onCancel = (e) => handlers.onPointerCancel(e);

onMounted(() => {
  g = canvas.value.getContext('2d');
  handlers = createRollInteraction(canvas.value);
  canvas.value.addEventListener('wheel', handlers.onWheel, { passive: false });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  ro = new ResizeObserver(resize);
  ro.observe(wrap.value);
  resize();
  offFrame = onFrame(frame);
});
onUnmounted(() => {
  ro?.disconnect();
  offFrame?.();
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
});
</script>

<template>
  <div class="center">
    <div ref="wrap" class="roll-wrap">
      <canvas ref="canvas" data-own-touch
        @pointerdown="handlers.onPointerDown"
        @dblclick="handlers.onNativeDblClick"
        @contextmenu="handlers.onNativeContextMenu"></canvas>
      <RecOverlay />
      <PickOverlay />
    </div>
  </div>
</template>

<style scoped>
.center { position: relative; min-width: 0; min-height: 0; }
.roll-wrap { position: absolute; inset: 0; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
</style>
