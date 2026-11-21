<script setup>
import { computed } from 'vue';
import { TREMOR_LIMITS, normalizeTremor } from '../core/tremor.js';
import { curTrack } from '../stores/project.js';
import { ui, selNotes } from '../stores/ui.js';
import { applyTremor, removeTremor, hasTremorSel } from '../engine/editing.js';
import { usePreview } from '../composables/usePreview.js';
import BaseModal from './BaseModal.vue';

const m = ui.tremorModal;
const { playing, toggle, stop } = usePreview();

const count = computed(() => selNotes().length);
const subtitle = computed(() => `Pitch wobble on ${count.value} selected note${count.value === 1 ? '' : 's'}. Audible in playback and WAV export; ignored in MIDI.`);

const preview = () => { const t = normalizeTremor(m); toggle(curTrack(), selNotes(), () => ({ tremor: t })); };
const close = () => { stop(); m.open = false; };
const apply = () => { applyTremor(m); close(); };
const remove = () => { removeTremor(); close(); };
</script>

<template>
  <BaseModal :open="m.open" title="Tremor" :subtitle="subtitle" @close="close" @apply="apply" @preview="preview">
    <label class="field">
      <span>Strength <b>±{{ m.depth }}¢</b> <small>({{ (m.depth / 100).toFixed(2) }} semitone)</small></span>
      <input v-model.number="m.depth" type="range" :min="TREMOR_LIMITS.depth[0]" :max="TREMOR_LIMITS.depth[1]" step="1">
    </label>
    <label class="field">
      <span>Frequency <b>{{ m.rate.toFixed(1) }} Hz</b></span>
      <input v-model.number="m.rate" type="range" :min="TREMOR_LIMITS.rate[0]" :max="TREMOR_LIMITS.rate[1]" step="0.1">
    </label>
    <template #actions>
      <button :class="{ on: playing }" title="Play the selection with these settings (Space)" @click="preview">
        {{ playing ? '■ Stop' : '▶ Preview' }}
      </button>
      <span class="spacer"></span>
      <button v-if="hasTremorSel()" title="Remove tremor from the selected notes" @click="remove">Remove</button>
      <button @click="close">Cancel</button>
      <button class="primary" title="Apply to the selected notes (Enter)" @click="apply">Apply</button>
    </template>
  </BaseModal>
</template>
