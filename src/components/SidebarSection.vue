<script setup>
/**
 * A collapsible sidebar section (accordion panel): a header that toggles its content.
 * Each section opens and closes on its own; the state is remembered per browser under `id`.
 */
import { ref } from 'vue';

const props = defineProps({
  id: { type: String, required: true },   // remembers open/closed
  title: { type: String, required: true },
  count: { type: Number, default: null }, // shown next to the title
});

const KEY = `open-daw-section-${props.id}`;
function loadOpen() {
  try { return localStorage.getItem(KEY) !== 'closed'; } catch { return true; }
}
const open = ref(loadOpen());
function toggle() {
  open.value = !open.value;
  try { localStorage.setItem(KEY, open.value ? 'open' : 'closed'); } catch { /* per-viewer convenience only */ }
}
const bodyId = `section-body-${props.id}`;
</script>

<template>
  <section class="side-section" :class="{ open }">
    <h3>
      <button class="side-head" :aria-expanded="open" :aria-controls="bodyId" :title="open ? `Collapse ${title}` : `Expand ${title}`" @click="toggle">
        <span class="chev" aria-hidden="true">▸</span>
        <span class="title">{{ title }}</span>
        <span v-if="count != null" class="count">{{ count }}</span>
      </button>
    </h3>
    <div v-show="open" :id="bodyId" class="body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.side-section { border-bottom: 1px solid var(--line); padding-bottom: 6px; margin-bottom: 6px; }
h3 { margin: 4px 0; }
.side-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 2px; border: 0; background: none; border-radius: 4px;
  color: var(--dim); font: inherit; text-transform: inherit; letter-spacing: inherit; text-align: left; }
.side-head:hover, .side-head:focus-visible { color: var(--text); background: var(--panel2); }
.chev { display: inline-block; width: 10px; font-size: 10px; transition: transform .12s; }
.open .chev { transform: rotate(90deg); }
.title { flex: 1; }
.count { min-width: 18px; padding: 0 6px; border-radius: 9px; background: var(--panel2); color: var(--dim); font-size: 11px; text-align: center; letter-spacing: 0; }
.body { padding-top: 2px; }
</style>
