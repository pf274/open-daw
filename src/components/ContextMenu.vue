<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { ui } from '../stores/ui.js';
import { buildNoteMenu } from '../menus/noteMenu.js';
import { buildClipMenu } from '../menus/clipMenu.js';
import MenuList from './MenuList.vue';

const el = ref(null);
const pos = ref({ left: 0, top: 0 });
const MENUS = { note: buildNoteMenu(), clip: buildClipMenu() }; // by ui.ctxMenu.kind

// keep the menu inside the viewport, also when it grows (a submenu opening inline on a touch screen)
function place() {
  if (!el.value) return;
  const r = el.value.getBoundingClientRect();
  pos.value = {
    left: Math.max(4, Math.min(ui.ctxMenu.x, window.innerWidth - r.width - 4)),
    top: Math.max(4, Math.min(ui.ctxMenu.y, window.innerHeight - r.height - 4)),
  };
}
let resizeObs = null;
watch(() => ui.ctxMenu.open && [ui.ctxMenu.x, ui.ctxMenu.y], async (open) => {
  resizeObs?.disconnect();
  if (!open) return;
  armed = false;
  pos.value = { left: ui.ctxMenu.x, top: ui.ctxMenu.y };
  await nextTick();
  place();
  if (typeof ResizeObserver !== 'undefined' && el.value) (resizeObs = new ResizeObserver(place)).observe(el.value);
});

/*
 * A menu opened by a long-press appears under the finger that is still down; lifting it must not choose
 * the item it lands on. So clicks only count once a press has started inside the menu (keyboard
 * clicks, which have no press, always count).
 */
let armed = false;
const onMenuDown = () => { armed = true; };
const onMenuClick = (e) => { if (!armed && e.detail !== 0) { e.preventDefault(); e.stopPropagation(); } };

const close = (e) => { if (ui.ctxMenu.open && !el.value?.contains(e.target)) ui.ctxMenu.open = false; };
onMounted(() => window.addEventListener('pointerdown', close, true)); // pointer: closes on touch too
onUnmounted(() => { window.removeEventListener('pointerdown', close, true); resizeObs?.disconnect(); });
</script>

<template>
  <div v-if="ui.ctxMenu.open" ref="el" class="ctx" :style="{ left: pos.left + 'px', top: pos.top + 'px' }" @contextmenu.prevent
    @pointerdown.capture="onMenuDown" @click.capture="onMenuClick">
    <MenuList :key="ui.ctxMenu.kind === 'custom' ? `custom-${ui.ctxMenu.serial}` : ui.ctxMenu.kind"
      :items="ui.ctxMenu.kind === 'custom' ? ui.ctxMenu.items : MENUS[ui.ctxMenu.kind] || MENUS.note" @done="ui.ctxMenu.open = false" />
  </div>
</template>

<style scoped>
.ctx { position: fixed; z-index: 20; max-height: calc(100dvh - 8px); overflow-y: auto; overscroll-behavior: contain; border-radius: 8px; }
/* mouse on a wide screen: flyout submenus need to stick out. Touch screens (and phones) open them inline and scroll instead. */
@media (min-width: 761px) and (pointer: fine) { .ctx { overflow: visible; max-height: none; } }
</style>
