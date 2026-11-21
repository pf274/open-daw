<script setup>
import { computed } from 'vue';
import { clamp, noteName } from '../core/music.js';
import { curTrack, isDrum } from '../stores/project.js';
import { pick, pickNote, pickMove, pickConfirm, pickOctave, pickHearPhrase, exitPick } from '../engine/pick.js';
import { device } from '../stores/device.js';
import { pitchLabel } from '../roll/render.js';
import { padList } from '../audio/drums.js';
import { bankLabel } from '../engine/drumPads.js';
import { ui } from '../stores/ui.js';
import { useFrameValue } from '../composables/useFrameValue.js';

const drum = computed(() => isDrum(curTrack()));
const title = computed(() => {
  const n = pickNote();
  if (!n) return '';
  const range = drum.value ? `${bankLabel()} (Z / X switch)` : `keys A…' = ${noteName(pick.base)}–${noteName(pick.base + 17)}`;
  return `Note ${pick.i + 1} / ${pick.ids.length}  ·  ${pick.done.has(n.id) ? '✓ ' : ''}${pitchLabel(curTrack(), n.pitch)}  ·  ${range}  ·  ${pick.done.size} confirmed`;
});
const bar = useFrameValue(() => {
  const flashing = performance.now() - pick.flash < 150;
  const p = pick.hold ? clamp((performance.now() - pick.hold.t0) / pick.hold.ms, 0, 1) : 0;
  return { width: (flashing ? 100 : p * 100).toFixed(0) + '%', color: flashing ? 'var(--ok)' : 'var(--gold)' };
});
</script>

<template>
  <div v-if="pick.active" class="pick-overlay">
    <div class="title">{{ title }}</div>
    <div class="bar"><div class="fill" :style="{ width: bar.width, background: bar.color }"></div></div>
    <div class="controls" role="toolbar" aria-label="Pick mode">
      <button class="small" title="Previous note (← / Backspace)" @click="pickMove(-1)">◀ Prev</button>
      <button class="small" :title="drum ? 'Previous pad bank (Z)' : 'Octave down (Z)'" @click="pickOctave(-1)">{{ drum ? 'Bank −' : 'Oct −' }}</button>
      <button class="small" :title="drum ? 'Next pad bank (X)' : 'Octave up (X)'" @click="pickOctave(1)">{{ drum ? 'Bank +' : 'Oct +' }}</button>
      <button class="small" title="Hear the phrase up to this note (Space)" @click="pickHearPhrase">▶ Hear</button>
      <button class="small ok" title="Confirm this note's pitch and go to the next (Enter)" @click="pickConfirm">✓ Confirm</button>
      <button class="small" title="Next note (→)" @click="pickMove(1)">Next ▶</button>
      <button class="small" title="Finish pick mode (Esc)" @click="exitPick()">Done</button>
    </div>
    <div v-if="device.coarse" class="help">
      Touch a key on the {{ drum ? 'drum list' : 'keyboard' }} at the left to try that {{ drum ? 'drum' : 'pitch' }}; <b>hold</b> it to confirm and move on.
    </div>
    <div v-else-if="drum" class="help">
      <template v-for="(d, i) in padList(ui.drumBank)" :key="d.key"><template v-if="i"> · </template><b>{{ d.key }}</b> {{ d.name.toLowerCase() }}</template><br>
      <b>Z / X</b> switch pad bank ·
      short press previews · <b>hold</b> to confirm &amp; advance · <b>← / →</b> move · <b>Enter</b> confirm ·
      <b>Space</b> hear the phrase · <b>Esc</b> finish
    </div>
    <div v-else class="help">
      <b>A W S E D F T G Y H U J K O L P ; '</b> = piano keys · short press previews · <b>hold</b> to confirm &amp; advance<br>
      <b>Z / X</b> octave · <b>← / →</b> or <b>Backspace</b> move between notes · <b>Enter</b> confirm current ·
      <b>Space</b> hear the phrase · <b>Esc</b> finish
    </div>
  </div>
</template>

<style scoped>
.pick-overlay {
  position: absolute; left: 60px; right: 14px; bottom: 12px; padding: 8px 12px; pointer-events: none; max-height: 60%; overflow-y: auto;
  background: var(--overlay); border: 1px solid var(--gold); border-radius: 8px;
}
.title { font-weight: 600; color: var(--gold); }
.bar { height: 6px; background: var(--panel2); border-radius: 3px; overflow: hidden; margin-top: 6px; }
.fill { height: 100%; }
.help { margin-top: 4px; }
.controls { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; pointer-events: auto; }
.controls .ok { border-color: var(--ok); color: var(--ok); font-weight: 600; }
@media (max-width: 760px) { .pick-overlay { left: 54px; right: 6px; bottom: 6px; padding: 6px 8px; } } /* keep the key strip free */
</style>
