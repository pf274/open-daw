<script setup>
import { computed } from 'vue';
import { SCALES } from '../core/scales.js';
import { NOTE_NAMES, clamp, transposeLabel, noteName } from '../core/music.js';
import { project, curTrack } from '../stores/project.js';
import { ui, status } from '../stores/ui.js';
import { pushUndo } from '../stores/history.js';
import { SNAP_OPTIONS } from '../stores/options.js';
import { applyTake } from '../engine/recorder.js';
import { enableMic, disableMic, live } from '../engine/mic.js';
import { transport } from '../engine/transport.js';
import { useFrameValue } from '../composables/useFrameValue.js';
import { setSongTranspose, setTimeSig } from '../engine/editing.js';
import { SONG_SNAPS } from '../engine/song.js';
import { pianoSamples } from '../engine/samples.js';
import { THEMES, setTheme } from '../stores/theme.js';
import { install, promptInstall, isIOS } from '../stores/install.js';
import { TIME_SIG_PRESETS, DENOMINATORS, formatTimeSig, parseTimeSig } from '../core/meter.js';

const UNIT_NAMES = { 2: 'half', 4: 'quarter', 8: 'eighth', 16: 'sixteenth' };
const tsPreset = computed(() => (TIME_SIG_PRESETS.includes(formatTimeSig(project.timeSig)) ? formatTimeSig(project.timeSig) : 'custom'));
function onPreset(e) {
  if (e.target.value !== 'custom') setTimeSig(parseTimeSig(e.target.value));
}

// project.settings is replaced on load, so always go through it (never cache it)
const SCALE_NAMES = Object.keys(SCALES);
const transposeOptions = computed(() => {
  const root = +project.settings.scaleRoot || 0;
  return Array.from({ length: 25 }, (_, i) => i - 12).map((t) => ({ value: t, label: t === 0 ? '0 (off)' : transposeLabel(t, root) }));
});

// [settings key, label, tooltip, input attrs]
const ALIGN_FIELDS = [
  ['fixedBeats', 'Fixed length (beats)', 'Note length in "fixed" mode', { step: 0.125, min: 0.0625 }],
  ['gapMs', 'Legato gap (ms)', 'Gap left before the next note in "until next tap" mode', { step: 5, min: 0 }],
  ['winStart', 'Pitch window start (ms)', 'Pitch window starts this far from the tap (negative = before)', { step: 10 }],
  ['winLen', 'Pitch window length (ms)', 'How long after the tap to sample the whistled pitch', { step: 10, min: 20 }],
  ['tapShift', 'Tap offset (ms)', 'Shift all tap times (compensates for keyboard/output latency)', { step: 5 }],
  ['transpose', 'Whistle transpose', 'Applied when turning whistling into notes; −12 drops it an octave', { step: 1 }],
  ['minClarity', 'Min pitch clarity', 'Pitch frames below this confidence are ignored', { step: 0.05, min: 0, max: 1 }],
];

/* tempo: one undo step per change; locked while playing */
function onBpm(e) {
  const v = clamp(Math.round(+e.target.value) || 100, 30, 300);
  if (v !== project.bpm) { pushUndo(); project.bpm = v; }
  e.target.value = v;
}

/* microphone: on/off, level meter and the note it hears (recording switches it on by itself) */
const toggleMic = () => (ui.mic.on ? (disableMic(), status('Mic off.')) : enableMic());
const meter = useFrameValue(() => (ui.mic.on ? clamp(live.rms * 6, 0, 1) : 0));
const liveNote = useFrameValue(() => {
  if (!ui.mic.on) return { text: '', active: false };
  const s = project.settings;
  if (!(live.midi > 0 && live.clarity >= s.minClarity)) return { text: '·', active: false };
  const r = Math.round(live.midi), cents = Math.round((live.midi - r) * 100);
  return { text: `${noteName(r)} ${cents >= 0 ? '+' : ''}${cents}¢ → ${noteName(Math.round(live.midi + s.transpose))}`, active: true };
});

function onCountIn(e) { ui.countIn = clamp(Math.round(+e.target.value) || 0, 0, 16); e.target.value = ui.countIn; }
const onDevice = () => { if (ui.mic.on) enableMic(); };

function realign() {
  const tr = curTrack();
  if (!tr.take) { status('This layer has no recorded take to re-align.', true); return; }
  pushUndo();
  const res = applyTake(tr, tr.take);
  status(`Re-aligned: ${res.notes.length} notes` + (res.skipped ? `, ${res.skipped} tap(s) without pitch` : '') + '.');
}
</script>

<template>
  <div class="settings">
    <fieldset>
      <legend>Time</legend>
      <label title="Tempo in beats per minute (can't change while playing)">BPM
        <input type="number" min="30" max="300" step="1" :value="project.bpm" :disabled="transport.playing" aria-label="BPM" @change="onBpm"></label>
      <label title="Common time signatures">Time signature
        <select :value="tsPreset" aria-label="Time signature preset" @change="onPreset">
          <option v-for="p in TIME_SIG_PRESETS" :key="p" :value="p">{{ p }}</option>
          <option v-if="tsPreset === 'custom'" value="custom">{{ formatTimeSig(project.timeSig) }}</option>
        </select>
      </label>
      <label title="Beats per measure (the top number)">Beats per bar
        <input type="number" min="1" max="16" :value="project.timeSig.num" aria-label="Beats per bar"
          @change="setTimeSig({ ...project.timeSig, num: +$event.target.value })"></label>
      <label title="Which note value counts as one beat (the bottom number)">Beat unit
        <select :value="project.timeSig.den" aria-label="Beat unit" @change="setTimeSig({ ...project.timeSig, den: +$event.target.value })">
          <option v-for="d in DENOMINATORS" :key="d" :value="d">{{ d }} ({{ UNIT_NAMES[d] }})</option>
        </select>
      </label>
    </fieldset>

    <fieldset>
      <legend>Playback</legend>
      <label>Song transpose
        <select :value="project.transpose" :class="{ on: project.transpose }"
          title="Playback and export are shifted; notes stay as written. Drums are never transposed."
          @change="setSongTranspose(+$event.target.value)">
          <option v-for="o in transposeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <label>Count-in <input type="number" min="0" max="16" step="1" :value="ui.countIn" @change="onCountIn"> beats</label>
      <label>Volume <input v-model.number="ui.masterVol" type="range" min="0" max="1" step="0.01"></label>
      <label title="Piano layers play recordings of a real grand piano (the free FluidR3 GM set, ~25 KB per note, downloaded as needed). Off, or when offline, a modelled piano is used.">
        <input v-model="project.settings.sampledPiano" type="checkbox"> Recorded piano
        <small v-if="project.settings.sampledPiano && pianoSamples.loading" class="note">loading…</small>
        <small v-else-if="project.settings.sampledPiano && pianoSamples.failed" class="note warn">offline: using the modelled piano</small>
      </label>
    </fieldset>

    <fieldset>
      <legend>Editing</legend>
      <label title="Note grid in the pattern editor">Note snap
        <select v-model.number="ui.snap">
          <option v-for="o in SNAP_OPTIONS" :key="o.label" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <label title="Where clips and automation points can be placed in the Song view: a whole bar, or beats of the time signature">Song snap
        <select v-model="ui.songSnap">
          <option v-for="o in SONG_SNAPS" :key="o.label" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <label title="Velocity for new notes">New-note velocity <input v-model.number="project.settings.vel" type="number" min="1" max="127"></label>
      <label>Key
        <select v-model.number="project.settings.scaleRoot">
          <option v-for="(n, i) in NOTE_NAMES" :key="n" :value="i">{{ n }}</option>
        </select>
      </label>
      <label title="Snaps whistled pitches (and 'Snap to scale') to this scale">Scale
        <select v-model="project.settings.scale">
          <option v-for="n in SCALE_NAMES" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
    </fieldset>

    <fieldset class="wide">
      <legend>Whistle alignment</legend>
      <label title="How a note's length is decided">Note length
        <select v-model="project.settings.durMode">
          <option value="legato">until next tap</option>
          <option value="hold">key hold time</option>
          <option value="fixed">fixed</option>
        </select>
      </label>
      <label v-for="[key, label, tip, attrs] in ALIGN_FIELDS" :key="key" :title="tip">
        {{ label }} <input v-model.number="project.settings[key]" type="number" v-bind="attrs">
      </label>
      <label><input v-model="ui.showTrace" type="checkbox"> Show whistle trace &amp; taps</label>
      <button title="Rebuild the selected layer's notes from its last take using these settings (replaces notes in the take's range; undoable)" @click="realign">Re-align last take</button>
    </fieldset>

    <fieldset>
      <legend>Appearance</legend>
      <label title="Light or dark colours. System follows your computer's setting and switches with it.">Theme
        <select :value="ui.theme" aria-label="Theme" @change="setTheme($event.target.value)">
          <option v-for="t in THEMES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </label>
    </fieldset>

    <fieldset v-if="!install.installed && (install.canPrompt || isIOS())">
      <legend>App</legend>
      <button v-if="install.canPrompt" title="Add OpenDAW to your home screen or app list; it opens in its own window and works offline" @click="promptInstall">Install app</button>
      <p v-else class="help">To install: tap Share, then <b>Add to Home Screen</b>.</p>
    </fieldset>

    <fieldset>
      <legend>Input &amp; pick mode</legend>
      <span class="mic">
        <button :class="{ on: ui.mic.on }" :aria-pressed="ui.mic.on" title="Switch the microphone on to see the note you whistle (● Rec switches it on by itself)" @click="toggleMic">🎤 Mic</button>
        <span v-if="ui.mic.on" class="meter" role="meter" aria-label="Mic level" :aria-valuenow="Math.round(meter * 100)" aria-valuemin="0" aria-valuemax="100"><span class="meter-fill" :style="{ width: (meter * 100).toFixed(0) + '%' }"></span></span>
        <span v-if="ui.mic.on" class="live-note" :class="{ active: liveNote.active }">{{ liveNote.text }}</span>
      </span>
      <label>Mic input
        <select v-model="ui.mic.deviceId" @change="onDevice">
          <option value="">default</option>
          <option v-for="d in ui.mic.devices" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>
      </label>
      <label title="Pick mode: hold a key this long to confirm the note and advance">Confirm hold
        <input v-model.number="project.settings.holdMs" type="number" step="50" min="100"> ms</label>
      <label title="On drum layers, Tap rhythm plays and records each drum live instead of tapping first and picking drums afterwards">
        <input v-model="project.settings.livePads" type="checkbox"> Live drum pads (one pass)</label>
    </fieldset>
  </div>
</template>

<style scoped>
.settings { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
fieldset { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px 8px; margin: 0; min-width: 0; }
fieldset.wide { flex: 1 1 520px; }
legend { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; padding: 0 4px; }
select { max-width: 170px; }
.note { color: var(--dim); }
.mic { display: inline-flex; align-items: center; gap: 6px; }
.meter { display: inline-block; width: 60px; height: 8px; background: var(--panel); border-radius: 4px; overflow: hidden; }
.meter-fill { display: block; height: 100%; background: var(--ok); }
.live-note { min-width: 86px; font-variant-numeric: tabular-nums; color: var(--dim); }
.live-note.active { color: var(--text); }
.note.warn { color: var(--warn); }
</style>
