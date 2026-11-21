<script setup>
import { computed } from 'vue';
import { curTrack } from '../stores/project.js';
import { ui, selNotes } from '../stores/ui.js';
import { applyQuantize, quantizedCopies } from '../engine/editing.js';
import { usePreview } from '../composables/usePreview.js';
import { SNAP_OPTIONS } from '../stores/options.js';
import BaseModal from './BaseModal.vue';

const m = ui.quantizeModal;
const { playing, toggle, stop } = usePreview();

const GRIDS = [{ value: 0, label: 'Editor snap' }, ...SNAP_OPTIONS.filter((o) => o.value > 0)];
const count = computed(() => selNotes().length);
const editorSnap = computed(() => SNAP_OPTIONS.find((o) => o.value === ui.snap)?.label || ui.snap);
const subtitle = computed(() => `Move ${count.value} selected note${count.value === 1 ? '' : 's'} toward the grid. Q repeats the last settings.`);

const preview = () => toggle(curTrack(), quantizedCopies(m));
const close = () => { stop(); m.open = false; };
const apply = () => { applyQuantize(m); close(); };
</script>

<template>
  <BaseModal :open="m.open" title="Quantize" :subtitle="subtitle" @close="close" @apply="apply" @preview="preview">
    <label class="field">
      <span>Grid <small v-if="!m.grid">(currently {{ editorSnap }})</small></span>
      <select v-model.number="m.grid">
        <option v-for="g in GRIDS" :key="g.value" :value="g.value">{{ g.label }}</option>
      </select>
    </label>
    <label class="field">
      <span>Strength <b>{{ m.strength }}%</b> <small>(100% = exactly on the grid)</small></span>
      <input v-model.number="m.strength" type="range" min="0" max="100" step="5">
    </label>
    <label class="check">
      <input v-model="m.ends" type="checkbox"> Also quantize note ends (lengths)
    </label>
    <template #actions>
      <button :class="{ on: playing }" title="Play the selection quantized with these settings (Space)" @click="preview">
        {{ playing ? '■ Stop' : '▶ Preview' }}
      </button>
      <span class="spacer"></span>
      <button @click="close">Cancel</button>
      <button class="primary" title="Apply to the selected notes (Enter)" @click="apply">Apply</button>
    </template>
  </BaseModal>
</template>

<style scoped>
.check { margin-bottom: 14px; color: var(--text); }
</style>
