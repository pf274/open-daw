<script setup>
/** Song view sidebar: imported sound effects — import, rename, volume, preview, delete; drag onto a track. */
import { ref } from 'vue';
import { project } from '../stores/project.js';
import { takeSnapshot, commitUndo } from '../stores/history.js';
import { importSoundFiles, deleteSound, previewSound, soundClipCount, soundState } from '../engine/sounds.js';
import { SOUND_MIME } from '../engine/song.js';
import { refreshSongMix } from '../engine/transport.js';

const picker = ref(null);
async function onPick(e) {
  const files = [...(e.target.files || [])];
  e.target.value = ''; // so picking the same file again still fires
  if (files.length) await importSoundFiles(files);
}
function onDragStart(e, s) {
  e.dataTransfer.setData(SOUND_MIME, String(s.id));
  e.dataTransfer.setData('text/plain', s.name);
  e.dataTransfer.effectAllowed = 'copy';
}
function onDelete(s) {
  const n = soundClipCount(s.id);
  if (n && !confirm(`Delete "${s.name}"? It is used ${n} time${n === 1 ? '' : 's'} in the song.`)) return;
  deleteSound(s.id);
}
/* volume slider: one undo step per adjustment */
let volSnap = null;
const volStart = () => { if (!volSnap) volSnap = takeSnapshot(); };
const volCommit = () => { if (volSnap) commitUndo(volSnap); volSnap = null; };

const fmtLen = (d) => (d < 10 ? `${d.toFixed(1)} s` : d < 60 ? `${Math.round(d)} s` : `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`);
</script>

<template>
  <h3>Sounds</h3>
  <p v-if="!project.sounds.length" class="help top">Import audio files (WAV, MP3, OGG…) to use as sound effects, or drop them straight onto a track.</p>
  <div v-for="s in project.sounds" :key="s.id" class="sound" :class="{ missing: soundState.missing[s.id] }"
    :draggable="!!soundState.ready[s.id]" :title="soundState.missing[s.id] ? `The audio of “${s.name}” isn’t in this browser — open the saved project file to restore it` : `Drag “${s.name}” onto a track`"
    @dragstart="onDragStart($event, s)">
    <div class="row">
      <span class="grip" aria-hidden="true">♪</span>
      <input v-model="s.name" class="name" :aria-label="`Sound name: ${s.name}`" @dragstart.prevent>
      <button class="small" :disabled="!soundState.ready[s.id]" :title="`Play “${s.name}”`" :aria-label="`Play ${s.name}`" @click="previewSound(s.id)">▶</button>
    </div>
    <div class="row meta">
      <span v-if="soundState.missing[s.id]" class="warn">audio missing</span>
      <span v-else>{{ fmtLen(s.duration) }} · used {{ soundClipCount(s.id) }}×</span>
      <input v-model.number="s.vol" class="vol" type="range" min="0" max="1" step="0.01" :aria-label="`Volume of ${s.name}`" :title="`Volume ${Math.round(s.vol * 100)}%`"
        @pointerdown="volStart" @keydown="volStart" @change="volCommit" @input="refreshSongMix" @dragstart.prevent>
      <button class="small" title="Delete sound" :aria-label="`Delete ${s.name}`" @click="onDelete(s)">✕</button>
    </div>
  </div>
  <input ref="picker" type="file" accept="audio/*,.wav,.mp3,.ogg,.oga,.flac,.m4a,.aac,.webm,.opus" multiple hidden aria-hidden="true" @change="onPick">
  <button class="wide" :disabled="soundState.importing > 0" title="Add audio files to the project's sounds" @click="picker.click()">
    {{ soundState.importing ? 'Importing…' : '+ Import sound…' }}
  </button>
</template>

<style scoped>
h3 { margin-top: 14px; }
.top { margin: -2px 0 8px; }
.sound { border: 1px solid var(--line); border-radius: 6px; padding: 6px; margin-bottom: 6px; background: var(--panel2); cursor: grab; }
.sound:active { cursor: grabbing; }
.sound.missing { border-style: dashed; cursor: default; }
.row { display: flex; gap: 4px; align-items: center; }
.row.meta { margin-top: 4px; color: var(--dim); font-size: 11px; }
.grip { color: var(--dim); width: 12px; text-align: center; }
.name { flex: 1; min-width: 0; }
.vol { flex: 1; min-width: 40px; }
.warn { color: var(--warn); }
.wide { width: 100%; }
</style>
