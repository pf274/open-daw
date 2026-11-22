<script setup>
import { device } from '../stores/device.js';
</script>

<template>
  <details>
    <summary>How to use</summary>
    <p v-if="device.coarse" class="help">
      <b>Touch:</b> ☰ opens this panel. In the roll, drag a note to move it (its right end resizes it), drag empty space to scroll,
      pinch (or − / +) to zoom (one finger above the other: taller notes), <b>double-tap</b> to add or delete a note, <b>double-tap and drag</b> to box-select, and <b>long-press</b> for the menu (copy, transpose, quantize…).
      While recording, <b>tap the roll</b> on each note. In pick mode, hold a key on the left keyboard to choose its pitch.<br>
      <b>Song:</b> tap a pattern or sound in this panel, then double-tap a track to place it. Drag clips to move them, drag their
      edges to shorten them, double-tap and drag to box-select clips, long-press for the clip menu, and pinch (or − / +) to zoom.
    </p>
    <p class="help">
      1. In <b>Settings → Recording</b>, choose whistle or hum / sing, press <b>🎤 Mic</b> and try it; the readout shows the detected note (● Rec turns the mic on by itself too).<br>
      2. Select a layer, put the playhead where you want to start, press <b>● Rec</b> (or R).<br>
      3. After the count-in, whistle or hum the melody and <b>tap any key</b> on each note. Esc stops.<br>
      4. Fix notes in the roll, add layers, then <b>File → Export</b>.
    </p>
    <p class="help">
      <b>Tap rhythm (no mic):</b> press <b>🥁 Tap rhythm</b> (or T), tap the beat, Esc. Then the keyboard becomes a piano
      (or drum pads on a drum layer): press keys to audition, <b>hold</b> one for 0.75 s to lock it in and move to the next note.
    </p>
    <p class="help">
      <b>Right-click the roll</b> for every edit: copy/paste, Select ▸, Transpose ▸ (incl. song key), Timing ▸ (Quantize…, nudge, length,
      stretch), Velocity ▸, Move to layer ▸, Change notes…, Connect, Tremor….<br>
      <b>Roll:</b> double-click adds/deletes a note · drag moves · drag right edge resizes · drag on empty space box-selects ·
      Shift-click adds to the selection · Alt-drag duplicates.<br>
      <b>Ruler:</b> click sets the playhead · Shift-drag sets the loop.<br>
      <b>Scroll:</b> wheel = pitch, Shift+wheel = time, Ctrl+wheel = zoom time, Ctrl+Shift+wheel = zoom pitch.<br>
      <b>Settings</b> (top tab) holds tempo (BPM), snap, key &amp; scale (or your own notes), song transpose, and everything for recording: whistle / hum, the mic, count-in and how taps become notes.
      Click the open tab again to collapse it.
    </p>
  </details>
</template>
