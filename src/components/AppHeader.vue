<script setup>
import { clamp, noteName } from '../core/music.js';
import { project } from '../stores/project.js';
import { ui, status, setTab } from '../stores/ui.js';
import { history, pushUndo, undo, redo } from '../stores/history.js';
import { transport, startTransport, stopTransport } from '../engine/transport.js';
import { startRecording } from '../engine/recorder.js';
import { enableMic, disableMic, live } from '../engine/mic.js';
import { useFrameValue } from '../composables/useFrameValue.js';
import { setView } from '../engine/song.js';
import { curPattern } from '../stores/project.js';
import FileTab from './FileTab.vue';
import SettingsTab from './SettingsTab.vue';

const TABS = [{ id: 'file', label: 'File' }, { id: 'settings', label: 'Settings' }];

function onBpm(e) {
  const v = clamp(Math.round(+e.target.value) || 100, 30, 300);
  if (v !== project.bpm) { pushUndo(); project.bpm = v; }
  e.target.value = v;
}
function toggleLoop() {
  ui.loop = !ui.loop;
  if (ui.loop && ui.loopEnd <= ui.loopStart) { ui.loopStart = 0; ui.loopEnd = 8; }
}

const toggleMic = () => (ui.mic.on ? (disableMic(), status('Mic off.')) : enableMic());
const meter = useFrameValue(() => (ui.mic.on ? clamp(live.rms * 6, 0, 1) : 0));
const liveNote = useFrameValue(() => {
  if (!ui.mic.on) return { text: '', active: false };
  const s = project.settings;
  if (!(live.midi > 0 && live.clarity >= s.minClarity)) return { text: '·', active: false };
  const r = Math.round(live.midi), cents = Math.round((live.midi - r) * 100);
  return { text: `${noteName(r)} ${cents >= 0 ? '+' : ''}${cents}¢ → ${noteName(Math.round(live.midi + s.transpose))}`, active: true };
});
</script>

<template>
  <header>
    <div class="bar top">
      <nav class="tabs" role="tablist">
        <button v-for="t in TABS" :key="t.id" role="tab" class="tab" :class="{ current: ui.tab === t.id }"
          :aria-selected="ui.tab === t.id" :title="ui.tab === t.id ? 'Click to collapse' : ''" @click="setTab(t.id)">
          {{ t.label }}
        </button>
      </nav>

      <div class="group views" role="group" aria-label="View">
        <button :class="{ on: ui.view === 'song' }" :aria-pressed="ui.view === 'song'" title="Arrange patterns into a song" @click="setView('song')">🎼 Song</button>
        <button :class="{ on: ui.view === 'pattern' }" :aria-pressed="ui.view === 'pattern'" :title="`Edit the notes of “${curPattern()?.name}”`" @click="setView('pattern')">🎹 {{ curPattern()?.name ?? 'Pattern' }}</button>
      </div>

      <div class="group">
        <button class="rec" :class="{ on: transport.recording && !transport.rhythmOnly }"
          title="Record into the selected layer (R). Whistle the pitch, tap any key for each note. Esc stops."
          :disabled="ui.view === 'song'" @click="startRecording(false)">● Rec</button>
        <button :class="{ on: transport.recording && transport.rhythmOnly }"
          title="Tap the rhythm first (T), then pick each pitch on the computer keyboard"
          :disabled="ui.view === 'song'" @click="startRecording(true)">🥁 Tap rhythm</button>
        <button :class="{ on: transport.playing && !transport.recording }" :title="ui.view === 'song' ? 'Play the song from the playhead (Space)' : 'Play the pattern from the playhead (Space)'"
          @click="ui.view === 'song' ? startTransport(ui.songPlayhead, { song: true }) : startTransport(ui.playhead)">▶ Play</button>
        <button title="Stop (Space / Esc)" @click="stopTransport()">■ Stop</button>
        <button v-if="ui.view === 'pattern'" :class="{ on: ui.loop }" title="Loop region (Shift+drag on the ruler to set it)" @click="toggleLoop">⟳ Loop</button>
      </div>

      <div class="group">
        <label>BPM <input type="number" min="30" max="300" step="1" :value="project.bpm" :disabled="transport.playing" @change="onBpm"></label>
        <button :class="{ on: ui.metronome }" title="Metronome click while recording/playing" @click="ui.metronome = !ui.metronome">Click</button>
      </div>

      <div class="group">
        <button :class="{ on: ui.mic.on }" title="Enable the microphone (input device is in Settings)" @click="toggleMic">🎤 Mic</button>
        <div v-if="ui.mic.on" class="meter"><div class="meter-fill" :style="{ width: (meter * 100).toFixed(0) + '%' }"></div></div>
        <span v-if="ui.mic.on" class="live-note" :class="{ active: liveNote.active }">{{ liveNote.text }}</span>
      </div>

      <div class="group">
        <button title="Undo (Ctrl+Z)" :disabled="!history.canUndo" @click="undo">↶</button>
        <button title="Redo (Ctrl+Shift+Z)" :disabled="!history.canRedo" @click="redo">↷</button>
      </div>
    </div>

    <div v-if="ui.tab" class="panel" role="tabpanel">
      <FileTab v-if="ui.tab === 'file'" />
      <SettingsTab v-else-if="ui.tab === 'settings'" />
    </div>
  </header>
</template>

<style scoped>
.top { padding-top: 0; padding-bottom: 0; min-height: 40px; }
.tabs { display: flex; align-self: stretch; margin-right: 6px; }
.tab { border: 0; border-radius: 0; background: none; color: var(--dim); padding: 0 14px; border-bottom: 2px solid transparent; font-weight: 600; }
.tab:hover { color: var(--text); border-color: var(--line); }
.tab.current { color: var(--text); border-bottom-color: var(--accent); }
.views button { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel { background: var(--panel2); border-bottom: 1px solid var(--line); padding: 8px 10px; }
.rec { color: var(--rec); font-weight: 600; }
.rec.on { background: var(--rec); color: var(--on-rec); border-color: var(--rec); }
.meter { width: 60px; height: 8px; background: var(--panel2); border-radius: 4px; overflow: hidden; }
.meter-fill { height: 100%; background: var(--ok); }
.live-note { min-width: 86px; font-variant-numeric: tabular-nums; color: var(--dim); }
.live-note.active { color: var(--text); }
</style>
