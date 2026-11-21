<script setup>
/** Song view sidebar: every pattern, draggable onto the song; Edit opens the pattern editor. */
import { project, patternLength, barLen } from '../stores/project.js';
import { newPattern, duplicatePattern, deletePattern, editPattern, clipCount, choosePattern, PATTERN_MIME } from '../engine/song.js';
import { ui } from '../stores/ui.js';
import { askConfirm } from '../stores/confirm.js';
import { device } from '../stores/device.js';

function onDragStart(e, p) {
  e.dataTransfer.setData(PATTERN_MIME, String(p.id));
  e.dataTransfer.setData('text/plain', p.name);
  e.dataTransfer.effectAllowed = 'copy';
}
async function onDelete(p) {
  if (project.patterns.length === 1) { deletePattern(p.id); return; } // refused, with a message: nothing to confirm
  const n = clipCount(p.id);
  const ok = await askConfirm({
    title: `Delete pattern “${p.name}”?`,
    message: (n ? `It is used ${n} time${n === 1 ? '' : 's'} in the song, and ${n === 1 ? 'that clip' : 'those clips'} will be removed too. ` : 'It isn’t used in the song. ')
      + 'You can undo this with ↶ (Ctrl+Z).',
    confirmLabel: 'Delete pattern', danger: true,
  });
  if (ok) deletePattern(p.id);
}
/** Click a card (not its controls) to select that pattern; Enter on a focused card does the same. */
function onCardClick(e, p) {
  if (e.target.closest('input, button')) return;
  choosePattern(p.id);
  if (device.narrow) ui.drawer = false; // phones: back to the song, ready to double-tap a track
}
const bars = (p) => Math.round(patternLength(p) / barLen());
</script>

<template>
  <p class="help top">{{ device.coarse ? 'Tap a pattern to select it, then double-tap a track to place it.' : 'Click a pattern to select it, then double-click a track to place it, or drag it onto a track.' }}</p>
  <div v-for="p in project.patterns" :key="p.id" class="pattern" :class="{ current: p.id === project.curPattern && ui.placeSound == null }"
    draggable="true" role="button" tabindex="0" :aria-pressed="p.id === project.curPattern"
    :title="`Click to select “${p.name}” (double-click a track to place it), or drag it onto a track`"
    @dragstart="onDragStart($event, p)" @click="onCardClick($event, p)" @keydown.enter.self="choosePattern(p.id)">
    <div class="row">
      <span class="grip" aria-hidden="true">⠿</span>
      <input v-model="p.name" class="name" :aria-label="`Pattern name: ${p.name}`" @dragstart.prevent>
      <button class="small primary" :title="`Open “${p.name}” in the pattern editor`" @click="editPattern(p.id)">Edit</button>
    </div>
    <div class="row meta">
      <span>{{ bars(p) }} bar{{ bars(p) === 1 ? '' : 's' }} · {{ p.layers.length }} layer{{ p.layers.length === 1 ? '' : 's' }} · used {{ clipCount(p.id) }}×</span>
      <span class="spacer"></span>
      <button class="small" title="Duplicate pattern" :aria-label="`Duplicate ${p.name}`" @click="duplicatePattern(p.id)">⧉</button>
      <button class="small" title="Delete pattern" :aria-label="`Delete ${p.name}`" @click="onDelete(p)">✕</button>
    </div>
  </div>
  <button class="wide" title="A new, empty pattern with the same instruments as the current one" @click="newPattern()">+ New pattern</button>
</template>

<style scoped>
.top { margin: -2px 0 8px; }
.pattern { border: 1px solid var(--line); border-radius: 6px; padding: 6px; margin-bottom: 6px; background: var(--panel2); cursor: grab; }
.pattern.current { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.pattern:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.pattern:active { cursor: grabbing; }
.row { display: flex; gap: 4px; align-items: center; }
.row.meta { margin-top: 4px; color: var(--dim); font-size: 11px; }
.grip { color: var(--dim); cursor: grab; }
.name { flex: 1; min-width: 0; }
.spacer { flex: 1; }
.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); font-weight: 600; }
.wide { width: 100%; }
</style>
