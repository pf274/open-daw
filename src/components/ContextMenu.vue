<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { ui } from '../stores/ui.js';
import { buildNoteMenu } from '../menus/noteMenu.js';
import { buildClipMenu } from '../menus/clipMenu.js';
import MenuList from './MenuList.vue';

const el = ref(null);
const pos = ref({ left: 0, top: 0 });
const MENUS = { note: buildNoteMenu(), clip: buildClipMenu() }; // by ui.ctxMenu.kind

// keep the menu inside the viewport
watch(() => ui.ctxMenu.open && [ui.ctxMenu.x, ui.ctxMenu.y], async (open) => {
  if (!open) return;
  pos.value = { left: ui.ctxMenu.x, top: ui.ctxMenu.y };
  await nextTick();
  const r = el.value.getBoundingClientRect();
  pos.value = {
    left: Math.max(4, Math.min(ui.ctxMenu.x, window.innerWidth - r.width - 4)),
    top: Math.max(4, Math.min(ui.ctxMenu.y, window.innerHeight - r.height - 4)),
  };
});

const close = (e) => { if (ui.ctxMenu.open && !el.value?.contains(e.target)) ui.ctxMenu.open = false; };
onMounted(() => window.addEventListener('mousedown', close, true));
onUnmounted(() => window.removeEventListener('mousedown', close, true));
</script>

<template>
  <div v-if="ui.ctxMenu.open" ref="el" class="ctx" :style="{ left: pos.left + 'px', top: pos.top + 'px' }" @contextmenu.prevent>
    <MenuList :key="ui.ctxMenu.kind" :items="MENUS[ui.ctxMenu.kind] || MENUS.note" @done="ui.ctxMenu.open = false" />
  </div>
</template>

<style scoped>
.ctx { position: fixed; z-index: 20; }
</style>
