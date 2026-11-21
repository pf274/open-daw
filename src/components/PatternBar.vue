<script setup>
/** Top of the pattern editor's sidebar: which pattern is open (switch / rename / new / duplicate). */
import { project, curPattern } from '../stores/project.js';
import { selectPattern, newPattern, duplicatePattern, setView, clipCount } from '../engine/song.js';

function onNew() {
  const p = newPattern();
  selectPattern(p.id);
}
function onDuplicate() {
  const p = duplicatePattern(project.curPattern);
  if (p) selectPattern(p.id);
}
</script>

<template>
  <h3>Pattern</h3>
  <div class="bar">
    <select :value="project.curPattern" aria-label="Pattern being edited" @change="selectPattern(+$event.target.value)">
      <option v-for="p in project.patterns" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
    <button class="small" title="New empty pattern with the same instruments" @click="onNew">+ New</button>
    <button class="small" title="Duplicate this pattern" @click="onDuplicate">⧉</button>
  </div>
  <div class="bar">
    <input v-model="curPattern().name" class="name" aria-label="Pattern name">
  </div>
  <p class="help used">
    Used {{ clipCount(project.curPattern) }}× in the song ·
    <a href="#" @click.prevent="setView('song')">open the song</a>
  </p>
</template>

<style scoped>
.bar { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; }
.bar select, .name { flex: 1; min-width: 0; }
.used { margin: 0 0 8px; }
.used a { color: var(--accent); }
</style>
