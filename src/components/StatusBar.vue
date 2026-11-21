<script setup>
import { transposeLabel } from '../core/music.js';
import { project, curTrack, curPattern, songLength, barLen } from '../stores/project.js';
import { formatPosition } from '../core/meter.js';
import { ui } from '../stores/ui.js';
import { currentBeat } from '../engine/transport.js';
import { useFrameValue } from '../composables/useFrameValue.js';

const position = useFrameValue(() => formatPosition(currentBeat(), project.timeSig));
</script>

<template>
  <footer>
    <span :class="{ warn: ui.status.warn }">{{ ui.status.msg }}</span>
    <span>
      <template v-if="ui.view === 'song'">
        <template v-if="ui.songSel.size">{{ ui.songSel.size }} clip{{ ui.songSel.size === 1 ? '' : 's' }} selected · </template>
        Song {{ position }} of {{ Math.ceil(songLength() / barLen() - 1e-9) }} bars
      </template>
      <template v-else>
        <template v-if="ui.sel.size">{{ ui.sel.size }} selected · </template>
        {{ position }}
      </template>
      · {{ project.bpm }} BPM · {{ project.timeSig.num }}/{{ project.timeSig.den }}
      <template v-if="project.transpose"> · transposed {{ transposeLabel(project.transpose, +project.settings.scaleRoot || 0) }}</template>
      <template v-if="ui.view === 'pattern'"> · {{ curPattern()?.name }} › {{ curTrack()?.name }}</template>
    </span>
  </footer>
</template>

<style scoped>
footer { padding: 4px 10px; background: var(--panel); border-top: 1px solid var(--line); color: var(--dim); font-size: 12px; display: flex; justify-content: space-between; gap: 10px; }
footer > span:first-child { color: var(--text); }
footer > span.warn { color: var(--warn); }
</style>
