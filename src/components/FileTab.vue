<script setup>
import { ui } from '../stores/ui.js';
import { ref } from 'vue';
import { exportMidi, exportWav, exportState, saveProject, loadProjectFile, newProject } from '../engine/files.js';

const fileInput = ref(null);
function onFile(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) loadProjectFile(f);
}
function onNew() {
  if (confirm('Start a new project? (Undo can bring the current one back.)')) newProject();
}
</script>

<template>
  <div class="row">
    <div class="group">
      <span class="caption">Project</span>
      <button title="Start an empty project" @click="onNew">New</button>
      <button title="Open a saved project (.json)" @click="fileInput.click()">Open…</button>
      <button title="Download the project as .json" @click="saveProject">Save</button>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onFile">
    </div>
    <div class="group">
      <span class="caption">Export {{ ui.view === 'song' ? 'song' : 'pattern' }}</span>
      <button :title="ui.view === 'song' ? 'The whole song as a .mid file, one MIDI track per instrument (slides and tremor are ignored)' : 'This pattern\'s unmuted layers as a .mid file (slides and tremor are ignored)'" @click="exportMidi">⬇ MIDI</button>
      <button title="Render all unmuted layers to a .wav file (slides and tremor are audible)" :disabled="exportState.rendering" @click="exportWav">
        {{ exportState.rendering ? 'Rendering…' : '⬇ WAV' }}
      </button>
    </div>
    <span class="note">Your work also autosaves in this browser.</span>
  </div>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.caption { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin-right: 2px; }
.note { color: var(--dim); font-size: 12px; }
</style>
