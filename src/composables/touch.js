/**
 * Touch helpers: double-tap detection and long-press → context menu.
 *
 * Phones don't reliably send `dblclick` or `contextmenu`, so touch gestures are recognised here.
 * When a double-tap was handled, the browser's own dblclick that may follow is ignored
 * (see recentlyDoubleTapped), so nothing happens twice.
 */
const TAP_MS = 350, TAP_PX = 24;
let lastFired = -Infinity;

/**
 * A double-tap detector: call it on each tap (pointerup without movement); true on the second tap of a pair. `key` = what was tapped.
 * `.pending(e, key)` asks, on a pointerdown, whether this press is the second of a pair (without using up the first tap):
 * that is how double-tap-and-drag (box selection) is told apart from a plain drag. `.reset()` forgets the first tap.
 */
export function doubleTapper() {
  let last = null;
  const near = (e, key, now) => !!last && last.key === key && now - last.t < TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < TAP_PX;
  const tap = (e, key = '') => {
    const now = performance.now();
    const hit = near(e, key, now);
    last = hit ? null : { t: now, x: e.clientX, y: e.clientY, key };
    if (hit) lastFired = now;
    return hit;
  };
  tap.pending = (e, key = '') => near(e, key, performance.now());
  tap.reset = () => { last = null; };
  return tap;
}
/** True just after a touch double-tap was handled: skip the native dblclick that may follow. */
export const recentlyDoubleTapped = () => performance.now() - lastFired < 700;

export const LONG_PRESS_MS = 500;
const MOVE_PX = 10;

/**
 * Long-press anywhere (touch only) opens that element's context menu, as a right-click would:
 * a `contextmenu` event is dispatched at the pressed element. Elements marked `data-own-touch`
 * (the piano roll canvas) handle touch themselves. The browser's own long-press menu event
 * (Android sends one, iOS doesn't) is swallowed so the menu opens exactly once.
 */
export function installLongPress(root = document) {
  let press = null, swallowUntil = 0;
  const clear = () => { if (press) clearTimeout(press.timer); press = null; };
  const onDown = (e) => {
    clear();
    if (e.pointerType !== 'touch' || e.target.closest?.('[data-own-touch], input, select, textarea')) return;
    const { target, clientX, clientY } = e;
    press = {
      x: clientX, y: clientY,
      timer: setTimeout(() => {
        press = null;
        swallowUntil = performance.now() + 800;
        window.dispatchEvent(new Event('pointercancel')); // end any drag the press started
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY, button: 2 }));
      }, LONG_PRESS_MS),
    };
  };
  const onMove = (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_PX) clear(); };
  const onNative = (e) => {
    if (!e.isTrusted) return; // ours
    if (press || performance.now() < swallowUntil) { // a touch long-press: ours handles it
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onClick = (e) => { if (performance.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); } }; // the release after a long-press isn't a click
  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('pointermove', onMove, true);
  root.addEventListener('pointerup', clear, true);
  root.addEventListener('pointercancel', clear, true);
  root.addEventListener('contextmenu', onNative, true);
  root.addEventListener('click', onClick, true);
  return () => {
    clear();
    root.removeEventListener('pointerdown', onDown, true);
    root.removeEventListener('pointermove', onMove, true);
    root.removeEventListener('pointerup', clear, true);
    root.removeEventListener('pointercancel', clear, true);
    root.removeEventListener('contextmenu', onNative, true);
    root.removeEventListener('click', onClick, true);
  };
}
