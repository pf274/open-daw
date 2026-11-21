/** One shared requestAnimationFrame loop. Subscribers run every frame. */
const subs = new Set();
let started = false;

/** @returns {() => void} unsubscribe */
export function onFrame(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function startFrameLoop() {
  if (started) return;
  started = true;
  const loop = () => {
    for (const cb of subs) cb();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
