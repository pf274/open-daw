import { ref, onMounted, onUnmounted } from 'vue';
import { onFrame } from '../engine/frame.js';

/**
 * A ref recomputed every animation frame — for fast-changing, non-reactive
 * sources (playhead position, live pitch, hold progress).
 */
export function useFrameValue(compute) {
  const value = ref(compute());
  let off = null;
  onMounted(() => { off = onFrame(() => { value.value = compute(); }); });
  onUnmounted(() => off && off());
  return value;
}
