import { ref, onUnmounted } from 'vue';
import { previewNotes, stopPreview } from '../engine/preview.js';

/** Preview/stop toggle for dialogs: play(track, notes, override?) */
export function usePreview() {
  const playing = ref(false);
  let timer = null;

  function stop() {
    clearTimeout(timer);
    if (playing.value) stopPreview();
    playing.value = false;
  }
  function toggle(tr, notes, override) {
    if (playing.value) { stop(); return; }
    const secs = previewNotes(tr, notes, override);
    playing.value = true;
    timer = setTimeout(() => { playing.value = false; }, secs * 1000);
  }
  onUnmounted(stop);
  return { playing, toggle, stop };
}
