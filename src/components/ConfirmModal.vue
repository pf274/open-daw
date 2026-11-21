<script setup>
/** The dialog behind askConfirm() (stores/confirm.js). Cancel has focus, so a stray Enter never deletes anything. */
import { ref, watch, nextTick } from 'vue';
import { confirmState as c, answerConfirm } from '../stores/confirm.js';
import BaseModal from './BaseModal.vue';

const cancelBtn = ref(null);
watch(() => c.open, async (open) => { if (open) { await nextTick(); cancelBtn.value?.focus(); } });
</script>

<template>
  <BaseModal :open="c.open" :title="c.title" :width="380" @close="answerConfirm(false)" @apply="answerConfirm(true)">
    <p v-if="c.message" class="msg">{{ c.message }}</p>
    <template #actions>
      <span class="spacer"></span>
      <button ref="cancelBtn" class="cancel" @click="answerConfirm(false)">Cancel</button>
      <button class="ok" :class="c.danger ? 'danger' : 'primary'" @click="answerConfirm(true)">{{ c.confirmLabel }}</button>
    </template>
  </BaseModal>
</template>

<style scoped>
.msg { margin: 4px 0 16px; color: var(--text); line-height: 1.45; }
.danger { background: var(--rec); border-color: var(--rec); color: var(--on-rec); font-weight: 600; }
</style>
