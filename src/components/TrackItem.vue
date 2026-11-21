<script setup>
import { INSTRUMENTS } from '../audio/instruments.js';
import { project, isDrum, audible } from '../stores/project.js';
import { viewDrums } from '../stores/view.js';
import { audition } from '../engine/mix.js';
import { setInstrument, openSynthEditor } from '../engine/synthEditor.js';

// Tracks are store objects: editing their fields in place is intentional.
const props = defineProps({ track: { type: Object, required: true }, selected: Boolean });
defineEmits(['select', 'remove']);

const INST_OPTIONS = Object.entries(INSTRUMENTS).map(([k, v]) => ({
  value: k,
  label: v.custom ? `${v.name} (editable)` : `${v.name} (${v.drums ? 'GM ch 10' : 'GM ' + (v.gm + 1)})`,
}));

function onInstrument(e) {
  const t = props.track;
  setInstrument(t, e.target.value);
  if (isDrum(t)) {
    if (t.id === project.sel) viewDrums();
    audition(t, 38);
  } else if (t.inst === 'custom') {
    openSynthEditor(t.id); // straight into the editor the first time
  } else audition(t, 72);
}
</script>

<template>
  <div class="track" :class="{ sel: selected, silent: !audible(track) }" @pointerdown="$emit('select')">
    <div class="row">
      <span class="dot" :style="{ background: track.color }"></span>
      <input v-model="track.name" class="name">
      <button class="small mute-solo" :class="{ on: track.mute }" title="Mute" @click="track.mute = !track.mute">M</button>
      <button class="small mute-solo" :class="{ on: track.solo }" title="Solo" @click="track.solo = !track.solo">S</button>
      <button class="small" title="Delete layer" @click.stop="$emit('remove')">✕</button>
    </div>
    <div class="row">
      <select :value="track.inst" @change="onInstrument">
        <option v-for="o in INST_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <button v-if="track.inst === 'custom'" class="small" title="Edit this layer's synth sound" @click="openSynthEditor(track.id)">Edit synth…</button>
    </div>
    <div class="row">
      <label style="flex:none">Vol</label>
      <input v-model.number="track.vol" type="range" min="0" max="1" step="0.01">
      <span class="count">{{ track.notes.length }} notes</span>
    </div>
  </div>
</template>

<style scoped>
.track { border: 1px solid var(--line); border-radius: 6px; padding: 6px; margin-bottom: 6px; background: var(--panel2); cursor: pointer; }
.track.silent > .row > :not(.mute-solo) { opacity: .45; } /* muted, or another layer is soloed (M / S stay clear) */
.track.sel { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.row { display: flex; gap: 4px; align-items: center; margin-top: 4px; }
.row:first-child { margin-top: 0; }
.name, select { flex: 1; min-width: 0; }
input[type=range] { flex: 1; }
.dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.count { color: var(--dim); font-size: 11px; min-width: 56px; text-align: right; }
</style>
