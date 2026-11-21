<script setup>
/** Editor for one filter in the chain (edits the dialog's working copy in place). */
import { computed } from 'vue';
import {
  FILTER_TYPES, FILTER_LABELS, FILTER_LIMITS as L, ENV_MODES, ENV_MODE_LABELS,
  usesResonance, usesWidth, usesGain,
} from '../audio/customSynth.js';
import AdsrGraph from './AdsrGraph.vue';

const props = defineProps({
  filter: { type: Object, required: true },
  index: { type: Number, required: true },
  color: { type: String, required: true },
});
defineEmits(['remove']);
const f = computed(() => props.filter);

/* frequency uses a log slider (0–1000) so every octave gets the same travel */
const [fLo, fHi] = L.freq;
const freqPos = computed({
  get: () => Math.round((Math.log(f.value.freq / fLo) / Math.log(fHi / fLo)) * 1000),
  set: (v) => { f.value.freq = Math.round(fLo * (fHi / fLo) ** (v / 1000)); },
});
const fmtHz = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${hz} Hz`);
const fmtS = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`);
const modes = computed(() => ENV_MODES.filter((m) => m !== 'gain' || usesGain(f.value.type)));

function onType(e) {
  f.value.type = e.target.value;
  if (f.value.env.mode === 'gain' && !usesGain(f.value.type)) f.value.env.mode = 'off';
}
</script>

<template>
  <div class="card" :class="{ off: !f.enabled }">
    <div class="head">
      <span class="num" :style="{ background: color }">{{ index + 1 }}</span>
      <select :value="f.type" :aria-label="`Filter ${index + 1} type`" @change="onType">
        <option v-for="t in FILTER_TYPES" :key="t" :value="t">{{ FILTER_LABELS[t] }}</option>
      </select>
      <label class="toggle"><input v-model="f.enabled" type="checkbox"> On</label>
      <span class="spacer"></span>
      <button class="small" :title="`Remove filter ${index + 1}`" :aria-label="`Remove filter ${index + 1}`" @click="$emit('remove')">✕</button>
    </div>

    <div class="grid">
      <label>{{ usesGain(f.type) || usesWidth(f.type) ? 'Centre' : 'Cutoff' }} <b>{{ fmtHz(f.freq) }}</b>
        <input v-model.number="freqPos" type="range" min="0" max="1000" step="1"></label>
      <label v-if="usesResonance(f.type)" title="Peak at the cutoff">Resonance <b>{{ f.resonance.toFixed(1) }} dB</b>
        <input v-model.number="f.resonance" type="range" :min="L.resonance[0]" :max="L.resonance[1]" step="0.5"></label>
      <label v-if="usesWidth(f.type)" title="How wide a range of frequencies is affected">Width <b>{{ f.width.toFixed(1) }} oct</b>
        <input v-model.number="f.width" type="range" :min="L.width[0]" :max="L.width[1]" step="0.1"></label>
      <label v-if="usesGain(f.type)" title="How much the range is amplified">Boost <b>+{{ f.gain.toFixed(1) }} dB</b>
        <input v-model.number="f.gain" type="range" :min="L.gain[0]" :max="L.gain[1]" step="0.5"></label>
    </div>

    <div class="env">
      <label class="mode">Envelope
        <select v-model="f.env.mode" :aria-label="`Filter ${index + 1} envelope`">
          <option v-for="m in modes" :key="m" :value="m">{{ ENV_MODE_LABELS[m] }}</option>
        </select>
      </label>
      <template v-if="f.env.mode !== 'off'">
        <AdsrGraph :attack="f.env.attack" :decay="f.env.decay" :sustain="f.env.sustain" :release="f.env.release" :height="36" :color="color" />
        <div class="grid five">
          <label v-if="f.env.mode === 'freq'" title="How far the envelope moves the frequency at its peak">Amount
            <b>{{ f.env.amount > 0 ? '+' : '' }}{{ f.env.amount.toFixed(1) }} oct</b>
            <input v-model.number="f.env.amount" type="range" :min="L.amount[0]" :max="L.amount[1]" step="0.1"></label>
          <label>Attack <b>{{ fmtS(f.env.attack) }}</b>
            <input v-model.number="f.env.attack" type="range" :min="L.attack[0]" :max="L.attack[1]" step="0.001"></label>
          <label>Decay <b>{{ fmtS(f.env.decay) }}</b>
            <input v-model.number="f.env.decay" type="range" :min="L.decay[0]" :max="L.decay[1]" step="0.01"></label>
          <label>Sustain <b>{{ Math.round(f.env.sustain * 100) }}%</b>
            <input v-model.number="f.env.sustain" type="range" :min="L.sustain[0]" :max="L.sustain[1]" step="0.01"></label>
          <label>Release <b>{{ fmtS(f.env.release) }}</b>
            <input v-model.number="f.env.release" type="range" :min="L.release[0]" :max="L.release[1]" step="0.01"></label>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.card { border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px 10px; display: grid; gap: 8px; }
.card.off { opacity: .55; }
.head { display: flex; align-items: center; gap: 6px; }
.num { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; color: rgb(var(--ink)); font-weight: 700; font-size: 11px; flex: none; }
.toggle { color: var(--text); }
.spacer { flex: 1; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 12px; }
.grid.five { grid-template-columns: repeat(5, 1fr); }
.grid label { display: flex; flex-direction: column; align-items: stretch; gap: 2px; color: var(--text); font-size: 12px; }
.grid b { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--dim); }
.grid input[type=range] { width: 100%; }
.env { display: grid; gap: 6px; }
.mode { color: var(--text); }
@media (max-width: 560px) { .grid, .grid.five { grid-template-columns: 1fr 1fr; } }
</style>
