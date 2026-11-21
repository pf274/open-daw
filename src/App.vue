<script setup>
import { onMounted, watch } from 'vue';
import AppHeader from './components/AppHeader.vue';
import TrackList from './components/TrackList.vue';
import HelpPanel from './components/HelpPanel.vue';
import PianoRoll from './components/PianoRoll.vue';
import ContextMenu from './components/ContextMenu.vue';
import StatusBar from './components/StatusBar.vue';
import TremorModal from './components/TremorModal.vue';
import QuantizeModal from './components/QuantizeModal.vue';
import SynthModal from './components/SynthModal.vue';
import SongView from './components/SongView.vue';
import PatternList from './components/PatternList.vue';
import PatternBar from './components/PatternBar.vue';
import SoundList from './components/SoundList.vue';
import { project, resetProject } from './stores/project.js';
import { ui, status } from './stores/ui.js';
import { installAutosave, installPrefs, restoreSaved } from './stores/persistence.js';
import { setMasterVolume } from './audio/context.js';
import { installKeyboard } from './engine/keyboard.js';
import { startFrameLoop } from './engine/frame.js';
import { applyMix } from './engine/mix.js';
import { refreshSongMix } from './engine/transport.js';
import { installPianoPreload } from './engine/samples.js';
import { restoreSounds, pruneStoredSounds } from './engine/sounds.js';
import './engine/recorder.js'; // registers the transport/mic recording hooks

if (restoreSaved()) status('Restored your last session.');
else resetProject();

// keep audio in sync with volume / mute / solo (every pattern's layers) and the master volume
watch(() => project.patterns.map((p) => p.layers.map((t) => [t.id, t.vol, t.mute, t.solo])), () => { applyMix(); refreshSongMix(); }, { deep: true });
watch(() => ui.masterVol, setMasterVolume, { immediate: true });

onMounted(() => {
  installPianoPreload();
  installAutosave();
  installPrefs();
  installKeyboard();
  startFrameLoop();
  // decode imported sounds from browser storage, then drop stored audio no sound uses any more
  restoreSounds().then(pruneStoredSounds).catch(() => {});
});
</script>

<template>
  <AppHeader />
  <main v-if="ui.view === 'song'">
    <aside>
      <PatternList />
      <SoundList />
      <HelpPanel />
    </aside>
    <SongView />
  </main>
  <main v-else>
    <aside>
      <PatternBar />
      <TrackList />
      <HelpPanel />
    </aside>
    <PianoRoll />
  </main>
  <StatusBar />
  <ContextMenu />
  <TremorModal />
  <QuantizeModal />
  <SynthModal />
</template>
