<script setup>
import { project, addTrack, isDrum } from '../stores/project.js';
import { ui, status } from '../stores/ui.js';
import { pushUndo } from '../stores/history.js';
import { viewDrums } from '../stores/view.js';
import { transport } from '../engine/transport.js';
import { pick, exitPick } from '../engine/pick.js';
import TrackItem from './TrackItem.vue';

const NEXT_INSTRUMENTS = ['piano', 'bass', 'strings', 'marimba', 'organ', 'guitar'];

function select(t) {
  if (project.sel === t.id || transport.recording) return;
  if (pick.active) exitPick();
  project.sel = t.id;
  ui.sel.clear();
  if (isDrum(t)) viewDrums();
}
function remove(t) {
  if (project.tracks.length === 1) { status('A project needs at least one layer.', true); return; }
  if (t.notes.length && !confirm(`Delete layer "${t.name}" (${t.notes.length} notes)?`)) return;
  pushUndo();
  project.tracks = project.tracks.filter((x) => x.id !== t.id);
  if (project.sel === t.id) project.sel = project.tracks[0].id;
  ui.sel.clear();
}
function add() {
  pushUndo();
  addTrack(null, NEXT_INSTRUMENTS[project.tracks.length % NEXT_INSTRUMENTS.length]);
  ui.sel.clear();
}
function addDrums() {
  pushUndo();
  addTrack('Drums', 'drums');
  ui.sel.clear();
  viewDrums();
  status('Drum layer added. Press 🥁 Tap rhythm (T), tap the beat, then pick each drum. Turn on Loop to layer passes.');
}
</script>

<template>
  <h3>Layers</h3>
  <TrackItem v-for="t in project.tracks" :key="t.id" :track="t" :selected="t.id === project.sel"
    @select="select(t)" @remove="remove(t)" />
  <div class="add">
    <button @click="add">+ Add layer</button>
    <button title="Add a drum-kit layer (exports on GM channel 10)" @click="addDrums">+ Add drums</button>
  </div>
</template>

<style scoped>
.add { display: flex; gap: 6px; }
.add button { flex: 1; }
</style>
