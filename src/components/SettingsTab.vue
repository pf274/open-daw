<script setup>
import { computed } from 'vue';
import { SCALES, CUSTOM_SCALE, scaleNotes } from '../core/scales.js';
import { INPUT_MODES, transposeKey } from '../core/voice.js';
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

/*
 * Turning taps into notes (● Rec and 🥁 Tap rhythm) and reading the pitch (● Rec only).
 * [settings key, label, help (shown under the field on touch screens, as a tooltip with a mouse), input attrs, shown when]
 */
const TAP_FIELDS = [
  ['fixedBeats', 'Fixed length', 'Every note gets this many beats.', { step: 0.125, min: 0.0625 }, (st) => st.durMode === 'fixed', 'beats'],
  ['gapMs', 'Gap before next note', 'Silence left before the following tap.', { step: 5, min: 0 }, (st) => st.durMode === 'legato', 'ms'],
  ['tapShift', 'Tap offset', 'Moves every tap later (+) or earlier (−) to make up for keyboard or audio delay. Try it if recorded notes land consistently early or late.', { step: 5 }, () => true, 'ms'],
];
const PITCH_FIELDS = [
  ['winStart', 'Pitch window start', 'Where, relative to each tap, the pitch starts being measured (negative = before the tap).', { step: 10 }, 'ms'],
  ['winLen', 'Pitch window length', 'How long after that the pitch is measured. Shorten it for fast melodies.', { step: 10, min: 20 }, 'ms'],
  ['minClarity', 'Min pitch clarity', 'How clear a sound must be to count as a pitch (0–1). Raise it if breath or noise gives wrong notes; lower it if notes are missed.', { step: 0.05, min: 0, max: 1 }, ''],
];

/* key & scale: a named scale in a key, or notes picked one by one */
const NOTE_LABELS = NOTE_NAMES;
const custom = computed(() => project.settings.scale === CUSTOM_SCALE);
function onScale(e) {
  const v = e.target.value, st = project.settings;
  if (v === CUSTOM_SCALE && st.scale !== CUSTOM_SCALE) st.customNotes = scaleNotes(st).slice(); // start from the scale it was on
  st.scale = v;
}
const hasNote = (pc) => (project.settings.customNotes || []).includes(pc);
function toggleNote(pc) {
  const st = project.settings, cur = new Set(st.customNotes || []);
  cur.has(pc) ? cur.delete(pc) : cur.add(pc);
  st.customNotes = [...cur].sort((a, b) => a - b);
}
const scaleSummary = computed(() => scaleNotes(project.settings).map((pc) => NOTE_NAMES[pc]).join(' '));

/* whistle or hum: each has its own transpose */
const tKey = computed(() => transposeKey(project.settings));
const humming = computed(() => project.settings.inputMode === 'hum');

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
  return { text: `${noteName(r)} ${cents >= 0 ? '+' : ''}${cents}¢ → ${noteName(Math.round(live.midi + (+s[transposeKey(s)] || 0)))}`, active: true };
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
      <p class="hint">Tempo and meter of the whole project.</p>
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
      <p class="hint">How everything sounds when you play it, and in WAV export.</p>
      <label>Song transpose
        <select :value="project.transpose" :class="{ on: project.transpose }"
          title="Playback and export are shifted; notes stay as written. Drums are never transposed."
          @change="setSongTranspose(+$event.target.value)">
          <option v-for="o in transposeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <label>Volume <input v-model.number="ui.masterVol" type="range" min="0" max="1" step="0.01"></label>
      <label title="Piano layers play recordings of a real grand piano (the free FluidR3 GM set, ~25 KB per note, downloaded as needed). Off, or when offline, a modelled piano is used.">
        <input v-model="project.settings.sampledPiano" type="checkbox"> Recorded piano
        <small v-if="project.settings.sampledPiano && pianoSamples.loading" class="note">loading…</small>
        <small v-else-if="project.settings.sampledPiano && pianoSamples.failed" class="note warn">offline: using the modelled piano</small>
      </label>
    </fieldset>

    <fieldset>
      <legend>Editing</legend>
      <p class="hint">Grids for placing notes and clips, and how loud new notes are.</p>
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
      <label title="Velocity (loudness, 1–127) of notes you add or record">New-note velocity <input v-model.number="project.settings.vel" type="number" min="1" max="127"></label>
    </fieldset>

    <fieldset class="wide">
      <legend>Key &amp; scale</legend>
      <p class="hint">Recorded notes (● Rec) snap to the nearest of these notes, and so does <b>Snap to scale</b> in the note menu. The key also names transposed keys. <b>Chromatic</b> means no snapping.</p>
      <label v-if="!custom">Key
        <select v-model.number="project.settings.scaleRoot" aria-label="Key">
          <option v-for="(n, i) in NOTE_NAMES" :key="n" :value="i">{{ n }}</option>
        </select>
      </label>
      <label>Scale
        <select :value="project.settings.scale" aria-label="Scale" @change="onScale">
          <option v-for="n in SCALE_NAMES" :key="n" :value="n">{{ n }}</option>
          <option :value="CUSTOM_SCALE">custom (pick notes)</option>
        </select>
      </label>
      <span v-if="custom" class="notes" role="group" aria-label="Notes to snap to">
        <button v-for="(n, pc) in NOTE_LABELS" :key="n" class="small note-btn" :class="{ on: hasNote(pc), black: n.length > 1 }"
          :aria-pressed="hasNote(pc)" :title="`${hasNote(pc) ? 'Remove' : 'Add'} ${n}`" @click="toggleNote(pc)">{{ n }}</button>
      </span>
      <small v-if="custom && !(project.settings.customNotes || []).length" class="note warn">No notes picked: recordings aren't snapped.</small>
      <small v-else-if="project.settings.scale !== 'chromatic'" class="note">Notes: {{ scaleSummary }}</small>
    </fieldset>

    <fieldset class="wide">
      <legend>Recording</legend>
      <p class="hint"><b>● Rec</b> turns what you whistle or hum into notes, one per tap. <b>🥁 Tap rhythm</b> uses the count-in and the note-length settings, but not the mic.</p>
      <label title="What ● Rec listens for. Humming and singing are lower than whistling, so the pitch detector listens to a lower range.">I'll be
        <select v-model="project.settings.inputMode" aria-label="Recording input">
          <option v-for="(m, k) in INPUT_MODES" :key="k" :value="k">{{ m.label.toLowerCase() }}</option>
        </select>
      </label>
      <span class="mic">
        <button :class="{ on: ui.mic.on }" :aria-pressed="ui.mic.on" :title="`Switch the microphone on to check the note you ${humming ? 'hum' : 'whistle'} (● Rec switches it on by itself)`" @click="toggleMic">🎤 Mic</button>
        <span v-if="ui.mic.on" class="meter" role="meter" aria-label="Mic level" :aria-valuenow="Math.round(meter * 100)" aria-valuemin="0" aria-valuemax="100"><span class="meter-fill" :style="{ width: (meter * 100).toFixed(0) + '%' }"></span></span>
        <span v-if="ui.mic.on" class="live-note" :class="{ active: liveNote.active }" title="The pitch heard → the note it becomes">{{ liveNote.text }}</span>
      </span>
      <label>Mic input
        <select v-model="ui.mic.deviceId" @change="onDevice">
          <option value="">default</option>
          <option v-for="d in ui.mic.devices" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>
      </label>
      <label :title="humming ? 'Semitones added to hummed pitches. 0 keeps them where you sing them; +12 raises them an octave.' : 'Semitones added to whistled pitches. Whistling sounds about an octave above the note you mean, so −12 brings it down.'">
        {{ humming ? 'Hum transpose' : 'Whistle transpose' }}
        <input v-model.number="project.settings[tKey]" type="number" step="1" min="-36" max="36" :aria-label="humming ? 'Hum transpose' : 'Whistle transpose'"> semitones</label>
      <label title="Clicks played before recording starts (● Rec and 🥁 Tap rhythm); tapping rhythm already counts taps during it">Count-in
        <input type="number" min="0" max="16" step="1" :value="ui.countIn" aria-label="Count-in" @change="onCountIn"> beats</label>

      <div class="sub">
        <h4>Taps → notes <span>(● Rec and 🥁 Tap rhythm)</span></h4>
        <label title="How long each recorded note lasts">Note length
          <select v-model="project.settings.durMode" aria-label="Note length">
            <option value="legato">until the next tap</option>
            <option value="hold">as long as the key is held</option>
            <option value="fixed">fixed</option>
          </select>
        </label>
        <label v-for="[key, label, tip, attrs, show, unit] in TAP_FIELDS" v-show="show(project.settings)" :key="key" :title="tip">
          {{ label }} <input v-model.number="project.settings[key]" type="number" v-bind="attrs" :aria-label="label"> {{ unit }}
          <small class="help-text">{{ tip }}</small>
        </label>
      </div>

      <div class="sub">
        <h4>Reading the pitch <span>(● Rec only)</span></h4>
        <label v-for="[key, label, tip, attrs, unit] in PITCH_FIELDS" :key="key" :title="tip">
          {{ label }} <input v-model.number="project.settings[key]" type="number" v-bind="attrs" :aria-label="label"> {{ unit }}
          <small class="help-text">{{ tip }}</small>
        </label>
        <label title="Draw the recorded pitch and taps over the selected layer in the piano roll"><input v-model="ui.showTrace" type="checkbox"> Show pitch trace &amp; taps</label>
        <button title="Rebuild the selected layer's notes from its last ● Rec take using these settings (replaces notes in the take's range; undoable)" @click="realign">Re-align last take</button>
        <small class="help-text">Changed a setting here? <b>Re-align last take</b> rebuilds the selected layer's last recording with it.</small>
      </div>
    </fieldset>

    <fieldset>
      <legend>Pick mode &amp; drums</legend>
      <p class="hint">After 🥁 Tap rhythm, pick mode steps through the new notes so you can choose each one's pitch (or drum) on the keyboard.</p>
      <label title="In pick mode, hold a key this long to confirm the note and move to the next (a short press just previews it)">Confirm hold
        <input v-model.number="project.settings.holdMs" type="number" step="50" min="100" aria-label="Confirm hold"> ms</label>
      <label title="On drum layers, 🥁 Tap rhythm plays and records each drum live from the pad keys instead of tapping first and picking drums afterwards">
        <input v-model="project.settings.livePads" type="checkbox"> Live drum pads (one pass)</label>
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
.hint { flex-basis: 100%; margin: 0 0 2px; color: var(--dim); font-size: 12px; line-height: 1.4; }
.sub { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; border-top: 1px solid var(--line); padding-top: 6px; margin-top: 2px; }
.sub h4 { flex-basis: 100%; margin: 0; font-size: 12px; font-weight: 600; }
.sub h4 span { color: var(--dim); font-weight: normal; }
.notes { display: inline-flex; flex-wrap: wrap; gap: 3px; }
.note-btn { min-width: 34px; }
.note-btn.black:not(.on) { background: var(--panel); }
/* the help under a field: on touch screens (no tooltips); with a mouse it's the tooltip */
.help-text { display: none; flex-basis: 100%; color: var(--dim); font-size: 11px; line-height: 1.35; }
.sub > .help-text { display: block; }
@media (pointer: coarse) { label .help-text { display: block; } label:has(.help-text) { flex-wrap: wrap; } }
</style>
