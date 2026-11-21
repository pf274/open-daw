<script setup>
/** One insert effect in a synth patch's chain; sliders come from the effect's definition. */
import { computed } from 'vue';
import { FX } from '../audio/fx.js';

// the effect is part of the dialog's working copy: sliders edit it in place (intentional)
const props = defineProps({
  effect: { type: Object, required: true },
  index: { type: Number, required: true },
  count: { type: Number, required: true },
});
defineEmits(['remove', 'move']);
const def = computed(() => FX[props.effect.type]);
</script>

<template>
  <div class="card" :class="{ off: !effect.enabled }">
    <div class="head">
      <span class="num">{{ index + 1 }}</span>
      <strong>{{ def.label }}</strong>
      <label class="toggle"><input v-model="effect.enabled" type="checkbox"> On</label>
      <span class="spacer"></span>
      <button class="small" :disabled="index === 0" :aria-label="`Move ${def.label} earlier`" title="Earlier in the chain" @click="$emit('move', -1)">↑</button>
      <button class="small" :disabled="index === count - 1" :aria-label="`Move ${def.label} later`" title="Later in the chain" @click="$emit('move', 1)">↓</button>
      <button class="small" :aria-label="`Remove ${def.label}`" title="Remove" @click="$emit('remove')">✕</button>
    </div>
    <div class="grid">
      <label v-for="(d, key) in def.params" :key="key" :title="d.help || ''">
        {{ d.label }} <b>{{ d.fmt(effect[key]) }}</b>
        <input v-model.number="effect[key]" type="range" :min="d.min" :max="d.max" :step="d.step" :aria-label="`${def.label} ${d.label}`">
      </label>
    </div>
  </div>
</template>

<style scoped>
.card { border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px 10px; display: grid; gap: 8px; }
.card.off { opacity: .55; }
.head { display: flex; align-items: center; gap: 6px; }
.num { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--panel2); color: var(--dim); font-weight: 700; font-size: 11px; flex: none; }
.toggle { color: var(--text); }
.spacer { flex: 1; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 6px 12px; }
.grid label { display: flex; flex-direction: column; align-items: stretch; gap: 2px; color: var(--text); font-size: 12px; }
.grid b { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--dim); }
.grid input[type=range] { width: 100%; }
</style>
