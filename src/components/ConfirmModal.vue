<script setup>
/**
 * The dialog behind askConfirm() / askText() (stores/confirm.js). Cancel has focus, so a stray Enter never
 * deletes anything; with a text field, the field has focus (its name selected) and Enter confirms.
 */
import { ref, watch, nextTick } from 'vue';
import { confirmState as c, answerConfirm } from '../stores/confirm.js';
import BaseModal from './BaseModal.vue';

const cancelBtn = ref(null), field = ref(null);
watch(() => c.open, async (open) => {
  if (!open) return;
  await nextTick();
  if (c.input == null) { cancelBtn.value?.focus(); return; }
  const el = field.value;
  el?.focus();
  const dot = c.input.lastIndexOf('.'); // select the name, not the extension
  el?.setSelectionRange(0, dot > 0 ? dot : c.input.length);
});
const okDisabled = () => c.input != null && !c.input.trim();
</script>

<template>
  <BaseModal :open="c.open" :title="c.title" :width="380" @close="answerConfirm(false)" @apply="!okDisabled() && answerConfirm(true)">
    <p v-if="c.message" class="msg">{{ c.message }}</p>
    <label v-if="c.input != null" class="field">{{ c.inputLabel }}
      <input ref="field" v-model="c.input" type="text" spellcheck="false" autocapitalize="off" autocomplete="off">
    </label>
    <template #actions>
      <span class="spacer"></span>
      <button ref="cancelBtn" class="cancel" @click="answerConfirm(false)">Cancel</button>
      <button class="ok" :class="c.danger ? 'danger' : 'primary'" :disabled="okDisabled()" @click="answerConfirm(true)">{{ c.confirmLabel }}</button>
    </template>
  </BaseModal>
</template>

<style scoped>
.msg { margin: 4px 0 16px; color: var(--text); line-height: 1.45; }
.danger { background: var(--rec); border-color: var(--rec); color: var(--on-rec); font-weight: 600; }
</style>
