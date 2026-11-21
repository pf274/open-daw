<script setup>
import { computed, reactive, ref, watch, onUnmounted } from 'vue';
import { previewGmProgram, stopPreview } from '../engine/preview.js';
import { REVERB_LIMITS } from '../audio/reverb.js';
import { FX, FX_TYPES } from '../audio/fx.js';
import EffectCard from './EffectCard.vue';
import { WAVES, FILTER_TYPES, FILTER_LABELS, PATCH_LIMITS, PRESET_GROUPS, MAX_FILTERS, MAX_EFFECTS, normalizePatch } from '../audio/customSynth.js';
import { GM_PROGRAMS } from '../core/gm.js';
import { ui } from '../stores/ui.js';
import { editingTrack, loadPreset, applySynth, closeSynthEditor, previewMaterial, addFilter, removeFilter, canAddFilter, addEffect, removeEffect, moveEffect, canAddEffect } from '../engine/synthEditor.js';
import { usePreview } from '../composables/usePreview.js';
import BaseModal from './BaseModal.vue';
import AdsrGraph from './AdsrGraph.vue';
import FilterGraph from './FilterGraph.vue';
import FilterCard from './FilterCard.vue';

const m = ui.synthModal;
const p = computed(() => m.patch);
const L = PATCH_LIMITS;
const { playing, toggle, stop } = usePreview();

const title = computed(() => `Synth — ${editingTrack()?.name ?? ''}`);
const material = computed(() => previewMaterial());
const subtitle = computed(() => `Preview plays the ${material.value.label}. Changes apply to the whole layer.`);

const WAVE_ICONS = { sine: '∿', triangle: '⋀', sawtooth: '⩘', square: '⊓' };

const fmtS = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`);

/* ---- tabs ---- */
const tab = ref('sound');
watch(() => m.open, (open) => { if (open) tab.value = 'sound'; });
const enabledCount = computed(() => p.value?.filters.filter((f) => f.enabled).length ?? 0);

/* ---- effects ---- */
const effectCount = computed(() => (p.value?.effects.filter((e) => e.enabled).length ?? 0) + (p.value?.reverb.amount > 0 ? 1 : 0));
function onAddEffect(e) {
  if (e.target.value) addEffect(e.target.value);
  e.target.value = '';
}

/* ---- reverb ---- */
const RL = REVERB_LIMITS;
const toneLabel = (t) => (t < 0.33 ? 'dark' : t > 0.66 ? 'bright' : 'warm');
/** Picture of the tail: silence for the pre-delay, then an exponential decay. */
const tailPath = computed(() => {
  const { decay, preDelay, amount } = p.value.reverb, W = 220, H = 40, total = 8.15;
  const x = (t) => (t / total) * W, h = 4 + amount * (H - 8);
  let d = `M0,${H} L${x(preDelay).toFixed(1)},${H} L${x(preDelay).toFixed(1)},${(H - h).toFixed(1)}`;
  for (let i = 1; i <= 24; i++) { const t = (decay * i) / 24; d += ` L${x(preDelay + t).toFixed(1)},${(H - h * Math.exp((-6.9 * t) / decay)).toFixed(1)}`; }
  return `${d} L${x(preDelay + decay).toFixed(1)},${H} Z`;
});

/* ---- filters ---- */
const FILTER_COLORS = ['#6aa8ff', '#ff9f5a', '#5ad19a', '#d77bff', '#ffd95a', '#ff6b9a'];
function onAddFilter(e) {
  if (e.target.value) addFilter(e.target.value);
  e.target.value = '';
}

const preview = () => {
  const tr = editingTrack();
  stopGm();
  // a frozen copy: edits made mid-preview must not change what's playing (or its graph animation)
  if (tr) toggle({ ...tr, inst: 'custom', synth: normalizePatch(m.patch) }, material.value.notes);
};

/* ---- hear the MIDI export instrument (real GM samples, loaded on demand) ---- */
const gm = reactive({ state: 'idle', error: '' }); // idle | loading | playing
let gmAbort = null, gmTimer = null;
function stopGm() {
  gmAbort?.abort();
  clearTimeout(gmTimer);
  if (gm.state === 'playing') stopPreview();
  gm.state = 'idle';
}
async function hearGm() {
  if (gm.state !== 'idle') { stopGm(); return; }
  const tr = editingTrack();
  if (!tr) return;
  stop(); // the synth preview
  const ctrl = (gmAbort = new AbortController());
  gm.state = 'loading';
  gm.error = '';
  try {
    const secs = await previewGmProgram(tr, p.value.gm, material.value.notes, { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    gm.state = 'playing';
    gmTimer = setTimeout(() => { gm.state = 'idle'; }, secs * 1000);
  } catch {
    if (ctrl.signal.aborted) return;
    gm.state = 'idle';
    gm.error = 'Couldn’t load the GM sound. Check your internet connection.';
  }
}
watch(() => p.value?.gm, () => { stopGm(); gm.error = ''; });
onUnmounted(stopGm);

const close = () => { stop(); stopGm(); closeSynthEditor(); };
const apply = () => { applySynth(); close(); };
function onPreset(e) {
  if (e.target.value) loadPreset(e.target.value);
  e.target.value = '';
}
</script>

<template>
  <BaseModal :open="m.open && !!m.patch" :title="title" :subtitle="subtitle" :width="640"
    @close="close" @apply="apply" @preview="preview">
    <div v-if="p" class="synth">
      <div class="top">
        <nav class="tabs" role="tablist" aria-label="Synth sections">
          <button role="tab" :aria-selected="tab === 'sound'" :class="{ current: tab === 'sound' }" @click="tab = 'sound'">Sound</button>
          <button role="tab" :aria-selected="tab === 'filters'" :class="{ current: tab === 'filters' }" @click="tab = 'filters'">
            Filters <span class="count">{{ enabledCount }}</span>
          </button>
          <button role="tab" :aria-selected="tab === 'effects'" :class="{ current: tab === 'effects' }" @click="tab = 'effects'">
            Effects <span v-if="effectCount" class="count" :title="`${effectCount} effect${effectCount === 1 ? '' : 's'} on`">{{ effectCount }}</span>
          </button>
        </nav>
        <div class="presets">
        <label>Preset
          <select @change="onPreset">
            <option value="">Load a preset…</option>
            <optgroup v-for="[group, names] in PRESET_GROUPS" :key="group" :label="group">
              <option v-for="name in names" :key="name" :value="name">{{ name }}</option>
            </optgroup>
          </select>
        </label>
        </div>
      </div>

      <template v-if="tab === 'sound'">
      <fieldset>
        <legend>Oscillator 1</legend>
        <div class="waves" role="radiogroup" aria-label="Oscillator 1 waveform">
          <button v-for="w in WAVES" :key="w" role="radio" :aria-checked="p.wave === w" :class="{ on: p.wave === w }"
            :title="w" @click="p.wave = w"><span class="icon">{{ WAVE_ICONS[w] }}</span>{{ w }}</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Oscillator 2 <small>(level 0 = off)</small></legend>
        <div class="waves" role="radiogroup" aria-label="Oscillator 2 waveform">
          <button v-for="w in WAVES" :key="w" role="radio" :aria-checked="p.osc2Wave === w" :class="{ on: p.osc2Wave === w }"
            :disabled="p.osc2Level === 0" :title="w" @click="p.osc2Wave = w"><span class="icon">{{ WAVE_ICONS[w] }}</span>{{ w }}</button>
        </div>
        <div class="grid">
          <label>Level <b>{{ Math.round(p.osc2Level * 100) }}%</b>
            <input v-model.number="p.osc2Level" type="range" :min="L.osc2Level[0]" :max="L.osc2Level[1]" step="0.01"></label>
          <label>Octave <b>{{ p.osc2Octave > 0 ? '+' : '' }}{{ p.osc2Octave }}</b>
            <input v-model.number="p.osc2Octave" type="range" :min="L.osc2Octave[0]" :max="L.osc2Octave[1]" step="1"></label>
          <label>Detune <b>{{ p.osc2Detune > 0 ? '+' : '' }}{{ p.osc2Detune }}¢</b>
            <input v-model.number="p.osc2Detune" type="range" :min="L.osc2Detune[0]" :max="L.osc2Detune[1]" step="1"></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Envelope</legend>
        <AdsrGraph :attack="p.attack" :decay="p.decay" :sustain="p.sustain" :release="p.release" />
        <div class="grid four">
          <label>Attack <b>{{ fmtS(p.attack) }}</b>
            <input v-model.number="p.attack" type="range" :min="L.attack[0]" :max="L.attack[1]" step="0.001"></label>
          <label>Decay <b>{{ fmtS(p.decay) }}</b>
            <input v-model.number="p.decay" type="range" :min="L.decay[0]" :max="L.decay[1]" step="0.01"></label>
          <label>Sustain <b>{{ Math.round(p.sustain * 100) }}%</b>
            <input v-model.number="p.sustain" type="range" :min="L.sustain[0]" :max="L.sustain[1]" step="0.01"></label>
          <label>Release <b>{{ fmtS(p.release) }}</b>
            <input v-model.number="p.release" type="range" :min="L.release[0]" :max="L.release[1]" step="0.01"></label>
        </div>
      </fieldset>


      <fieldset>
        <legend>Vibrato &amp; output</legend>
        <div class="grid">
          <label>Vibrato depth <b>{{ p.vibDepth }}¢</b>
            <input v-model.number="p.vibDepth" type="range" :min="L.vibDepth[0]" :max="L.vibDepth[1]" step="1"></label>
          <label>Vibrato rate <b>{{ p.vibRate.toFixed(1) }} Hz</b>
            <input v-model.number="p.vibRate" type="range" :min="L.vibRate[0]" :max="L.vibRate[1]" step="0.1" :disabled="!p.vibDepth"></label>
          <label>Volume <b>{{ Math.round(p.volume * 100) }}%</b>
            <input v-model.number="p.volume" type="range" :min="L.volume[0]" :max="L.volume[1]" step="0.01"></label>
        </div>
        <div class="gm">
          <label title="MIDI has no way to carry this sound; the exported file names this General MIDI instrument instead">
            MIDI export instrument
            <select v-model.number="p.gm">
              <option v-for="(name, i) in GM_PROGRAMS" :key="i" :value="i + 1">{{ i + 1 }}. {{ name }}</option>
            </select>
          </label>
          <button class="hear" :class="{ on: gm.state === 'playing' }" :aria-busy="gm.state === 'loading'"
            :title="`Hear ${GM_PROGRAMS[p.gm - 1]} as a General MIDI player would play it`" @click="hearGm">
            {{ gm.state === 'loading' ? 'Loading…' : gm.state === 'playing' ? '■ Stop' : '▶ Hear' }}
          </button>
        </div>
        <p v-if="gm.error" class="gm-error" role="alert">{{ gm.error }}</p>
        <p v-else class="gm-note">Plays FluidR3 GM samples, downloaded the first time. Other players and DAWs may use a different GM sound set.</p>
      </fieldset>
      </template>

      <template v-else-if="tab === 'filters'">
        <FilterGraph :filters="p.filters" :colors="FILTER_COLORS" />
        <div class="add">
          <select :disabled="!canAddFilter()" aria-label="Add a filter" @change="onAddFilter">
            <option value="">{{ canAddFilter() ? '+ Add filter…' : `Maximum ${MAX_FILTERS} filters` }}</option>
            <option v-for="t in FILTER_TYPES" :key="t" :value="t">{{ FILTER_LABELS[t] }}</option>
          </select>
          <span class="hint">Filters run in order, top to bottom. Each one can have its own envelope.</span>
        </div>
        <FilterCard v-for="(f, i) in p.filters" :key="f.id" :filter="f" :index="i"
          :color="FILTER_COLORS[i % FILTER_COLORS.length]" @remove="removeFilter(f.id)" />
        <p v-if="!p.filters.length" class="hint">No filters yet. Add one above; try a Frequency Amplifier to boost a range of frequencies.</p>
      </template>

      <template v-else>
        <div class="add">
          <select :disabled="!canAddEffect()" aria-label="Add an effect" @change="onAddEffect">
            <option value="">{{ canAddEffect() ? '+ Add effect…' : `Maximum ${MAX_EFFECTS} effects` }}</option>
            <option v-for="t in FX_TYPES" :key="t" :value="t">{{ FX[t].label }}</option>
          </select>
          <span class="hint">Effects run in order, top to bottom, then the reverb.</span>
        </div>
        <EffectCard v-for="(e, i) in p.effects" :key="e.id" :effect="e" :index="i" :count="p.effects.length"
          @remove="removeEffect(e.id)" @move="(d) => moveEffect(e.id, d)" />
        <fieldset>
          <legend>Reverb <small>(amount 0 = off)</small></legend>
          <svg class="tail" viewBox="0 0 220 40" role="img" :aria-label="`Reverb tail: ${fmtS(p.reverb.decay)}`">
            <path :d="tailPath" :style="{ fill: 'var(--accent)', opacity: 0.15 + p.reverb.amount * 0.6 }" />
          </svg>
          <div class="grid four">
            <label title="How much reverb is added to the sound">Amount <b>{{ Math.round(p.reverb.amount * 100) }}%</b>
              <input v-model.number="p.reverb.amount" type="range" :min="RL.amount[0]" :max="RL.amount[1]" step="0.01"></label>
            <label title="Room size: how long the reverb takes to die away">Decay <b>{{ fmtS(p.reverb.decay) }}</b>
              <input v-model.number="p.reverb.decay" type="range" :min="RL.decay[0]" :max="RL.decay[1]" step="0.1"></label>
            <label title="Dark (soft, damped walls) to bright (hard, reflective walls)">Tone <b>{{ toneLabel(p.reverb.tone) }}</b>
              <input v-model.number="p.reverb.tone" type="range" :min="RL.tone[0]" :max="RL.tone[1]" step="0.01"></label>
            <label title="Gap before the reverb starts: larger feels like a bigger room">Pre-delay <b>{{ Math.round(p.reverb.preDelay * 1000) }} ms</b>
              <input v-model.number="p.reverb.preDelay" type="range" :min="RL.preDelay[0]" :max="RL.preDelay[1]" step="0.005"></label>
          </div>
        </fieldset>
        <p class="hint">Effects run once per layer (not per note), so echoes and reverb tails ring across notes. MIDI export sends reverb and chorus amounts as CC91 / CC93.</p>
      </template>
    </div>

    <template #actions>
      <button :class="{ on: playing }" title="Play with these settings (Space)" @click="preview">
        {{ playing ? '■ Stop' : '▶ Preview' }}
      </button>
      <span class="spacer"></span>
      <button @click="close">Cancel</button>
      <button class="primary" title="Use this sound for the layer (Enter)" @click="apply">Apply</button>
    </template>
  </BaseModal>
</template>

<style scoped>
.synth { display: grid; gap: 8px; margin-bottom: 10px; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--line); }
.tabs { display: flex; align-self: stretch; }
.tabs button { border: 0; border-radius: 0; background: none; color: var(--dim); padding: 6px 12px; border-bottom: 2px solid transparent; font-weight: 600; }
.tabs button.current { color: var(--text); border-bottom-color: var(--accent); }
.tabs .count { display: inline-block; min-width: 16px; padding: 0 4px; border-radius: 8px; background: var(--panel2); font-size: 11px; color: var(--dim); }
.presets { padding-bottom: 4px; }
.add { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hint { color: var(--dim); font-size: 11px; margin: 0; }
.tail { width: 100%; height: 40px; display: block; margin: 2px 0 8px; background: var(--panel2); border-radius: 4px; }
fieldset { border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px 10px; margin: 0; }
legend { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; padding: 0 4px; }
legend small { text-transform: none; letter-spacing: 0; }
.waves { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 6px; }
.waves button { display: flex; flex-direction: column; align-items: center; gap: 0; padding: 3px 4px; font-size: 11px; }
.waves .icon { font-size: 18px; line-height: 1.1; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 12px; }
.grid.four { grid-template-columns: repeat(4, 1fr); }
.grid label { display: flex; flex-direction: column; align-items: stretch; gap: 2px; color: var(--text); font-size: 12px; }
.grid b { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--dim); }
.grid input[type=range] { width: 100%; }
.gm { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.gm label { color: var(--text); }
.gm select { max-width: 260px; }
.hear { min-width: 78px; }
.gm-note, .gm-error { margin: 4px 0 0; font-size: 11px; color: var(--dim); }
.gm-error { color: var(--warn); }
@media (max-width: 560px) { .grid, .grid.four { grid-template-columns: 1fr 1fr; } }
</style>
