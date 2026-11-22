<script setup>
import { ui, setTab } from '../stores/ui.js';
import { history, undo, redo } from '../stores/history.js';
import { transport, startTransport, stopTransport, restartTransport } from '../engine/transport.js';
import { startRecording } from '../engine/recorder.js';
import { setView } from '../engine/song.js';
import FileTab from './FileTab.vue';
import SettingsTab from './SettingsTab.vue';
import { toggleTheme } from '../stores/theme.js';
import { zoomRoll } from '../stores/view.js';

const TABS = [{ id: 'file', label: 'File' }, { id: 'settings', label: 'Settings' }];

function toggleLoop() {
  ui.loop = !ui.loop;
  if (ui.loop && ui.loopEnd <= ui.loopStart) { ui.loopStart = 0; ui.loopEnd = 8; }
}

</script>

<template>
  <header>
    <div class="bar top">
      <button class="menu-btn" :class="{ on: ui.drawer }" :aria-expanded="ui.drawer" aria-label="Side panel" title="Patterns, layers and sounds" @click="ui.drawer = !ui.drawer">☰</button>
      <nav class="tabs" role="tablist">
        <button v-for="t in TABS" :key="t.id" role="tab" class="tab" :class="{ current: ui.tab === t.id }"
          :aria-selected="ui.tab === t.id" :title="ui.tab === t.id ? 'Click to collapse' : ''" @click="setTab(t.id)">
          {{ t.label }}
        </button>
      </nav>

      <!-- in the pattern editor: back to the song (patterns open from the Song view's side panel or a clip's menu) -->
      <div v-if="ui.view === 'pattern'" class="group views">
        <button title="Back to the song arrangement" @click="setView('song')">🎼 Song</button>
      </div>

      <div class="group">
        <template v-if="ui.view === 'pattern'"><!-- recording goes into a pattern -->
          <button class="rec" :class="{ on: transport.recording && !transport.rhythmOnly }"
            title="Record into the selected layer (R). Whistle the pitch, tap any key for each note. Esc stops."
            @click="startRecording(false)">● Rec</button>
          <button :class="{ on: transport.recording && transport.rhythmOnly }"
            title="Tap the rhythm first (T), then pick each pitch on the computer keyboard"
            @click="startRecording(true)">🥁 Tap rhythm</button>
        </template>
        <button :class="{ on: transport.playing && !transport.recording }" :title="ui.view === 'song' ? 'Play the song from the playhead (Space)' : 'Play the pattern from the playhead (Space)'"
          @click="ui.view === 'song' ? startTransport(ui.songPlayhead, { song: true }) : startTransport(ui.playhead)">▶ Play</button>
        <button title="Stop (Space / Esc)" @click="stopTransport()">■ Stop</button>
        <button :title="ui.view === 'song' ? 'Back to the beginning of the song (Home). Keeps playing if it was.' : 'Back to the beginning of the pattern (Home). Keeps playing if it was.'"
          :disabled="transport.recording" @click="restartTransport()">⏮ Restart</button>
        <button v-if="ui.view === 'pattern'" :class="{ on: ui.loop }" title="Loop region (Shift+drag on the ruler to set it)" @click="toggleLoop">⟳ Loop</button>
      </div>

      <div class="group">
        <button :class="{ on: ui.metronome }" title="Metronome click while recording/playing (tempo is in Settings → Time)" @click="ui.metronome = !ui.metronome">Metronome</button>
      </div>

      <div class="group">
        <button title="Undo (Ctrl+Z)" :disabled="!history.canUndo" @click="undo">↶</button>
        <button title="Redo (Ctrl+Shift+Z)" :disabled="!history.canRedo" @click="redo">↷</button>
      </div>

      <button class="theme" :aria-label="ui.themeResolved === 'light' ? 'Switch to dark mode' : 'Switch to light mode'"
        :title="`${ui.themeResolved === 'light' ? 'Dark' : 'Light'} mode (more choices, including following your system, in Settings)`"
        @click="toggleTheme">{{ ui.themeResolved === 'light' ? '☾' : '☀' }}</button>
      <div v-if="ui.view === 'pattern'" class="group zoom" role="group" aria-label="Zoom">
        <button title="Zoom out (Ctrl+wheel, or pinch)" aria-label="Zoom out" @click="zoomRoll(1 / 1.25)">−</button>
        <button title="Zoom in (Ctrl+wheel, or pinch)" aria-label="Zoom in" @click="zoomRoll(1.25)">+</button>
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
.panel { background: var(--panel2); border-bottom: 1px solid var(--line); padding: 8px 10px; }
.rec { color: var(--rec); font-weight: 600; }
.rec.on { background: var(--rec); color: var(--on-rec); border-color: var(--rec); }
.theme { margin-left: auto; min-width: 30px; }
.menu-btn { display: none; min-width: 34px; }
.zoom button { min-width: 30px; }
@media (max-width: 760px) {
  /* one row that scrolls sideways instead of wrapping into several */
  .top { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; gap: 6px; padding: 0 6px; }
  .top::-webkit-scrollbar { display: none; }
  .top > * { flex: none; }
  .menu-btn { display: inline-block; }
  .tab { padding: 0 9px; }
  .group { padding-right: 6px; }
  .theme { margin-left: 0; }
  .panel { max-height: 45vh; overflow-y: auto; padding: 6px; }
}
</style>
