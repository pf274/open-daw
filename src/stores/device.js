/**
 * What kind of screen and pointer we're on, kept up to date (rotation, resizing, plugging in a mouse):
 *   narrow  — phone-sized: the sidebar becomes a drawer, the toolbar a single scrolling row
 *   coarse  — a finger is the main pointer: bigger targets, touch gestures
 */
import { reactive } from 'vue';

export const NARROW_QUERY = '(max-width: 760px)';
export const COARSE_QUERY = '(pointer: coarse)';

const mq = (q) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null);

export const device = reactive({ narrow: false, coarse: false });

function track(key, query) {
  const m = mq(query);
  device[key] = !!m?.matches;
  m?.addEventListener?.('change', () => { device[key] = m.matches; });
}
track('narrow', NARROW_QUERY);
track('coarse', COARSE_QUERY);

import.meta.hot?.decline();
