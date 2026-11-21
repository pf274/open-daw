<script setup>
/**
 * Shared dialog shell: backdrop, title, focus, and keys —
 * Esc → close, Enter → apply, Space (outside buttons) → preview.
 * Register its open-state in stores/ui.js modalOpen() so global shortcuts pause.
 */
import { ref, watch, nextTick } from 'vue';

const props = defineProps({
  open: Boolean,
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  width: { type: Number, default: 420 },
});
const emit = defineEmits(['close', 'apply', 'preview']);
const dialog = ref(null);

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); emit('close'); }
  else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); emit('apply'); }
  else if (e.key === ' ' && !['BUTTON', 'SELECT'].includes(e.target.tagName) && e.target.type !== 'checkbox') { e.preventDefault(); emit('preview'); }
}

watch(() => props.open, async (open) => {
  if (!open) return;
  await nextTick();
  dialog.value?.querySelector('input, select')?.focus();
});
</script>

<template>
  <div v-if="open" class="backdrop" @pointerdown.self="emit('close')">
    <div ref="dialog" class="modal" role="dialog" aria-modal="true" :aria-label="title"
      :style="{ width: `min(${width}px, 100%)` }" @keydown="onKey">
      <h2>{{ title }}</h2>
      <p v-if="subtitle" class="sub">{{ subtitle }}</p>
      <slot />
      <div class="actions"><slot name="actions" /></div>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 30; background: var(--backdrop); display: grid; place-items: center; padding: 16px; }
.modal { max-height: calc(100vh - 32px); overflow-y: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; box-shadow: 0 16px 40px var(--shadow); }
h2 { margin: 0 0 4px; font-size: 16px; }
.sub { margin: 0 0 14px; color: var(--dim); font-size: 12px; }
.actions { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
.modal :deep(.field) { display: flex; flex-direction: column; align-items: stretch; gap: 6px; margin-bottom: 14px; color: var(--text); }
.modal :deep(.field b) { font-variant-numeric: tabular-nums; }
.modal :deep(.field small) { color: var(--dim); }
.modal :deep(.spacer) { flex: 1; }
.modal :deep(.primary) { background: var(--accent); color: var(--on-accent); border-color: var(--accent); font-weight: 600; }
</style>
