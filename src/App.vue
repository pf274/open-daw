<script setup>
import { onMounted, onUnmounted, watch } from 'vue';
import AppHeader from './components/AppHeader.vue';
import TrackList from './components/TrackList.vue';
import HelpPanel from './components/HelpPanel.vue';
import PianoRoll from './components/PianoRoll.vue';
import ContextMenu from './components/ContextMenu.vue';
import StatusBar from './components/StatusBar.vue';
import TremorModal from './components/TremorModal.vue';
import QuantizeModal from './components/QuantizeModal.vue';
import SynthModal from './components/SynthModal.vue';
import ConfirmModal from './components/ConfirmModal.vue';
import ExportOverlay from './components/ExportOverlay.vue';
import SongView from './components/SongView.vue';
import PatternList from './components/PatternList.vue';
import PatternBar from './components/PatternBar.vue';
import SoundList from './components/SoundList.vue';
import SidebarSection from './components/SidebarSection.vue';
import { project, resetProject } from './stores/project.js';
import { ui, status } from './stores/ui.js';
import { installAutosave, installPrefs, restoreSaved } from './stores/persistence.js';
import { setMasterVolume } from './audio/context.js';
import { installKeyboard } from './engine/keyboard.js';
import { startFrameLoop } from './engine/frame.js';
import { applyMix } from './engine/mix.js';
import { refreshSongMix } from './engine/transport.js';
import { installPianoPreload } from './engine/samples.js';
import { installTheme } from './stores/theme.js';
import { installLongPress, installNoPageZoom } from './composables/touch.js';
import { device } from './stores/device.js';
import { restoreSounds, pruneStoredSounds } from './engine/sounds.js';
import './engine/recorder.js'; // registers the transport/mic recording hooks

installTheme();

if (restoreSaved()) status('Restored your last session.');
else resetProject();

// phones: the sidebar drawer closes when switching views, and isn't left open on a wide screen
watch(() => [ui.view, device.narrow], () => { ui.drawer = false; });

// keep audio in sync with volume / mute / solo (every pattern's layers) and the master volume
watch(() => project.patterns.map((p) => p.layers.map((t) => [t.id, t.vol, t.mute, t.solo])), () => { applyMix(); refreshSongMix(); }, { deep: true });
watch(() => ui.masterVol, setMasterVolume, { immediate: true });

let offLongPress = null, offNoZoom = null;
onUnmounted(() => { offLongPress?.(); offNoZoom?.(); });
onMounted(() => {
  installPianoPreload();
  installAutosave();
  installPrefs();
  installKeyboard();
  offLongPress = installLongPress();
  offNoZoom = installNoPageZoom();
  startFrameLoop();
  // decode imported sounds from browser storage, then drop stored audio no sound uses any more
  restoreSounds().then(pruneStoredSounds).catch(() => {});
});
</script>

<template>
  <AppHeader />
  <main v-if="ui.view === 'song'">
    <aside :class="{ open: ui.drawer }" aria-label="Patterns and sounds">
      <button class="drawer-close" aria-label="Close the side panel" @click="ui.drawer = false">✕</button>
      <SidebarSection id="patterns" title="Patterns" :count="project.patterns.length"><PatternList /></SidebarSection>
      <SidebarSection id="sounds" title="Sounds" :count="project.sounds.length"><SoundList /></SidebarSection>
      <HelpPanel />
    </aside>
    <SongView />
  </main>
  <main v-else>
    <aside :class="{ open: ui.drawer }" aria-label="Patterns and layers">
      <button class="drawer-close" aria-label="Close the side panel" @click="ui.drawer = false">✕</button>
      <PatternBar />
      <TrackList />
      <HelpPanel />
    </aside>
    <PianoRoll />
  </main>
  <div v-if="ui.drawer && device.narrow" class="drawer-backdrop" @click="ui.drawer = false"></div>
  <StatusBar />
  <ContextMenu />
  <TremorModal />
  <QuantizeModal />
  <SynthModal />
  <ConfirmModal />
  <ExportOverlay />
</template>
