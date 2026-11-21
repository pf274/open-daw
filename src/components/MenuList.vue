<script setup>
/** Renders a menu model (see menus/noteMenu.js), recursively for submenus. */
import { ref, nextTick } from 'vue';

defineOptions({ name: 'MenuList' });
defineProps({ items: { type: Array, required: true } });
const emit = defineEmits(['done']);

const open = ref(-1);
const subStyle = ref({});
let subEl = null;

const resolve = (x) => (typeof x === 'function' ? x() : x);
const enabled = (it) => !it.enabled || it.enabled();
const kind = (it) => (it == null ? 'sep' : it.header != null ? 'header' : it.stepper ? 'stepper' : 'item');

async function openSub(i, it) {
  open.value = it.children && enabled(it) ? i : -1;
  subStyle.value = {};
  if (open.value < 0) return;
  await nextTick();
  const el = subEl?.$el;
  if (!el) return;
  // keep the submenu on screen: flip left if needed, and nudge up near the bottom
  const r = el.getBoundingClientRect();
  const style = {};
  if (r.right > window.innerWidth - 4) Object.assign(style, { left: 'auto', right: '100%' });
  if (r.bottom > window.innerHeight - 4) style.top = `${-5 - (r.bottom - window.innerHeight + 8)}px`;
  subStyle.value = style;
}
function click(i, it) {
  if (!enabled(it)) return;
  if (it.children) { openSub(open.value === i ? -1 : i, it); return; }
  it.run();
  emit('done');
}
</script>

<template>
  <div class="menu" role="menu">
    <template v-for="(it, i) in items" :key="i">
      <hr v-if="kind(it) === 'sep'">
      <div v-else-if="kind(it) === 'header'" class="head">{{ resolve(it.header) }}</div>
      <div v-else-if="kind(it) === 'stepper'" class="stepper" :title="it.title ? it.title() : ''" @mouseenter="open = -1">
        <span class="label">{{ it.label }}</span>
        <button class="step" aria-label="Down" @click="it.dec()">−</button>
        <span class="value">{{ resolve(it.value) }}</span>
        <button class="step" aria-label="Up" @click="it.inc()">+</button>
        <button v-if="it.reset" class="step" title="Reset" @click="it.reset()">↺</button>
      </div>
      <div v-else class="row" @mouseenter="openSub(i, it)">
        <button :disabled="!enabled(it)" :class="{ active: open === i }" :title="it.title ? it.title() : ''"
          role="menuitem" @click="click(i, it)">
          {{ it.label }}<span class="keys">{{ it.children ? '▸' : it.keys }}</span>
        </button>
        <MenuList v-if="open === i" :ref="(c) => (subEl = c)" class="sub" :style="subStyle"
          :items="resolve(it.children)" @done="emit('done')" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.menu { min-width: 200px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 4px; box-shadow: 0 8px 24px var(--shadow); }
.row { position: relative; }
.sub { position: absolute; left: 100%; top: -5px; z-index: 1; }
button { display: flex; justify-content: space-between; gap: 16px; width: 100%; text-align: left; background: none; border: 0; border-radius: 5px; padding: 5px 9px; }
button:hover:not(:disabled), button.active { background: var(--accent); color: var(--on-accent); }
.keys { color: var(--dim); font-size: 11px; }
button:hover:not(:disabled) .keys, button.active .keys { color: var(--on-accent); }
hr { border: 0; border-top: 1px solid var(--line); margin: 4px 2px; }
.head { color: var(--dim); font-size: 11px; padding: 3px 9px 5px; }
.stepper { display: flex; align-items: center; gap: 4px; padding: 3px 6px 3px 9px; }
.stepper .label { flex: 1; }
.stepper .value { min-width: 110px; text-align: center; font-variant-numeric: tabular-nums; }
.step { width: auto; padding: 2px 8px; background: var(--panel2); border: 1px solid var(--line); justify-content: center; }
</style>
