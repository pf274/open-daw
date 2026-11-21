/** MIDI + audio export and project save/load. */
import { reactive } from 'vue';
import { writeMidi } from '../core/midi.js';
import { encodeWav } from '../core/wav.js';
import { keyName } from '../core/music.js';
import { gmProgramFor, reverbFor, fxFor } from '../audio/instruments.js';
import { createFxChain, fxTail } from '../audio/fxChain.js';
import { loadWorklets } from '../audio/worklets.js';
import { AUTOMATION_EFFECTS } from '../audio/effects.js';
import {
  project, audible, isDrum, soundPitch, serialize, loadProjectData, resetProject, songEnd, songLength,
  patternById, clipLength, clipTrim, songTrackById, songTrackAudible, barLen,
} from '../stores/project.js';
import { ui, status } from '../stores/ui.js';
import { pushUndo } from '../stores/history.js';
import { silenceAll } from '../audio/mixer.js';
import { getCtx, withContext, buildMasterChain } from '../audio/context.js';
import { stopTransport } from './transport.js';
import { exitPick } from './pick.js';
import { scheduleTrack } from './voices.js';
import { ensurePianoSamples, pianoNotesFor } from './samples.js';
import { buildSongGraph } from './automation.js';
import { pianoSamplesEnabled } from '../audio/piano.js';
import { scheduleSoundClips, soundBuffer } from '../audio/soundBank.js';
import { soundDataForSave, storeEmbeddedSounds } from './sounds.js';

/** What an export covers: the Song view exports the arrangement, the Pattern view the pattern. */
export const exportScope = () => (ui.view === 'song' ? 'song' : 'pattern');

/**
 * Every layer that sounds in `scope`, with where it plays:
 *   [{ layer, offset (beats), from / len (pattern beats; only notes starting in [from, len) play) }]
 * Song scope = one entry per (clip × layer) on audible song tracks.
 */
export function playedLayers(scope = exportScope()) {
  if (scope === 'pattern') {
    return project.tracks.filter((t) => audible(t) && t.notes.length).map((layer) => ({ layer, offset: 0, from: -Infinity, len: Infinity }));
  }
  const out = [];
  for (const c of project.song.clips) {
    if (c.soundId != null) continue; // imported sounds: audio only (see renderSong)
    const st = songTrackById(c.trackId), p = patternById(c.patternId);
    if (!st || !p || !songTrackAudible(st)) continue;
    const trim = clipTrim(c), end = trim + clipLength(c); // truncated clips play part of their pattern
    for (const layer of p.layers) if (audible(layer) && layer.notes.length) out.push({ layer, offset: c.start - trim, from: trim, len: end, songTrack: st });
  }
  return out;
}

/**
 * The song for MIDI, transposed (drums untouched). Slides and tremor are dropped —
 * MIDI has no portable equivalent, so connected notes export as plain notes.
 *  - pattern scope: one MIDI track per layer
 *  - song scope: one MIDI track per instrument (layers sharing a GM program are merged, all
 *    drums share channel 10) so a song with many patterns still fits MIDI's 16 channels
 */
export function buildSong(scope = exportScope()) {
  const groups = new Map();
  for (const { layer, offset, from, len } of playedLayers(scope)) {
    const drums = isDrum(layer), program = gmProgramFor(layer);
    const key = scope === 'pattern' ? `layer-${layer.id}` : drums ? 'drums' : `gm-${program}`;
    if (!groups.has(key)) groups.set(key, { name: scope === 'song' && drums ? 'Drums' : layer.name, program, drums, volume: layer.vol, reverb: reverbFor(layer)?.amount ?? 0, chorus: fxFor(layer)?.effects.find((e) => e.type === 'chorus')?.mix ?? 0, notes: [] });
    const g = groups.get(key);
    for (const n of layer.notes) {
      if (n.start < from || n.start >= len) continue;
      g.notes.push({ start: n.start + offset, dur: n.dur, vel: n.vel, pitch: soundPitch(layer, n.pitch) });
    }
  }
  const tracks = [...groups.values()].filter((g) => g.notes.length);
  for (const t of tracks) t.notes.sort((a, b) => a.start - b.start);
  return { bpm: project.bpm, timeSig: { ...project.timeSig }, tracks };
}

export function exportFileName(scope = exportScope()) {
  const tr = project.transpose || 0;
  const root = +project.settings.scaleRoot || 0;
  const base = scope === 'song' ? 'whistle-song' : 'whistle-melody';
  return tr ? `${base}-${keyName(root + tr).replace('♭', 'b')}.mid` : `${base}.mid`;
}

export function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const nothing = (scope) => (scope === 'song' ? 'Nothing to export — the song has no clips with audible notes.' : 'Nothing to export — no audible layers with notes.');

export function exportMidi() {
  const scope = exportScope(), song = buildSong(scope);
  if (!song.tracks.length) { status(nothing(scope), true); return; }
  const file = exportFileName(scope);
  const tr = project.transpose || 0;
  download(file, writeMidi(song), 'audio/midi');
  status(`Exported the ${scope} (${song.tracks.length} MIDI track${song.tracks.length === 1 ? '' : 's'}) to ${file}` + (tr ? ` (transposed ${tr > 0 ? '+' : ''}${tr} semitones).` : '.'));
}

/* ---------- audio (WAV) export: renders the same synths offline, slides included ---------- */
export const exportState = reactive({ rendering: false });
const TAIL_S = 2;     // let releases/cymbals ring out
const LEAD_S = 0.05;

/** Seconds of audio a render will produce. */
/** Longest reverb that can ring after the last note (synth reverbs, and Reverb automation in the song). */
function reverbTail(scope) {
  let t = 0;
  for (const { layer } of playedLayers(scope)) t = Math.max(t, fxTail(fxFor(layer)));
  const live = scope === 'song' ? project.song.automation.filter((a) => a.enabled !== false) : [];
  for (const a of live) if (a.effect === 'reverb' && a.points.some((p) => p.value > 0)) t = Math.max(t, a.options?.decay ?? 0);
  for (const a of live) t = Math.max(t, AUTOMATION_EFFECTS[a.effect]?.tail?.(a.options) ?? 0);
  return t;
}
export const renderLength = (scope = exportScope()) => (scope === 'song' ? songLength() : songEnd()) * (60 / project.bpm) + LEAD_S + Math.max(TAIL_S, reverbTail(scope) + 0.3);

export async function renderSong(sampleRate = 44100, scope = exportScope()) {
  if (pianoSamplesEnabled()) await ensurePianoSamples(pianoNotesFor(playedLayers(scope))); // render the real piano
  const spb = 60 / project.bpm;
  const off = new OfflineAudioContext(2, Math.ceil(renderLength(scope) * sampleRate), sampleRate);
  const master = buildMasterChain(off, ui.masterVol);
  await loadWorklets(off); // so the bitcrusher renders at full quality
  withContext(off, master, () => {
    const at = (b) => LEAD_S + b * spb;
    const graph = scope === 'song' ? buildSongGraph(off, master, { fromBeat: 0, endBeat: songLength() + barLen(), at }) : null;
    const buses = new Map(); // pattern scope: one bus per layer, at the layer's volume
    for (const { layer, offset, from, len, songTrack } of playedLayers(scope)) {
      if (graph) { scheduleTrack(layer, from, len, (b) => at(b + offset), spb, graph.destFor(songTrack, layer), from); continue; }
      if (!buses.has(layer.id)) {
        const bus = off.createGain();
        bus.gain.value = layer.vol;
        const fx = fxFor(layer);
        if (fx) { const c = createFxChain(off, fx); bus.connect(c.input); c.output.connect(master); } else bus.connect(master);
        buses.set(layer.id, bus);
      }
      scheduleTrack(layer, -Infinity, len, (b) => LEAD_S + (b + offset) * spb, spb, buses.get(layer.id));
    }
    if (graph) scheduleSoundClips(off, graph, -Infinity, Infinity, at, spb);
  });
  return off.startRendering();
}

export async function exportWav() {
  if (exportState.rendering) return;
  const scope = exportScope();
  if (!buildSong(scope).tracks.length && !(scope === 'song' && playableSoundClips())) { status(nothing(scope), true); return; }
  exportState.rendering = true;
  status(`Rendering the ${scope}…`);
  try {
    const buf = await renderSong(44100, scope);
    const file = exportFileName(scope).replace(/\.mid$/, '.wav');
    download(file, encodeWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate), 'audio/wav');
    status(`Exported ${file} (${buf.duration.toFixed(1)} s, slides included).`);
  } catch (err) {
    status('Audio export failed: ' + err.message, true);
  } finally {
    exportState.rendering = false;
  }
}

/** Song clips of imported sounds whose audio is loaded (they export as audio, not MIDI). */
const playableSoundClips = () => project.song.clips.some((c) => c.soundId != null && soundBuffer(c.soundId) && songTrackById(c.trackId) && songTrackAudible(songTrackById(c.trackId)));

/** Download the project as JSON, with imported sounds' audio embedded (base64) so the file is self-contained. */
export async function saveProject() {
  let text = serialize();
  if (project.sounds.length) {
    const data = JSON.parse(text);
    data.soundData = await soundDataForSave();
    text = JSON.stringify(data);
  }
  download('whistle-project.json', text, 'application/json');
}

function stopEverything() {
  exitPick();
  stopTransport();
  if (getCtx()) silenceAll();
  ui.sel.clear();
  ui.songSel.clear();
}

export async function loadProjectFile(file) {
  try {
    const data = JSON.parse(await file.text());
    stopEverything();
    pushUndo();
    loadProjectData(data);
    if (project.sounds.length) {
      await storeEmbeddedSounds(data.soundData);
      const missing = project.sounds.filter((s) => !soundBuffer(s.id)).length;
      if (missing) { status(`Loaded ${file.name}, but ${missing} sound${missing === 1 ? '’s' : 's’'} audio is missing.`, true); return; }
    }
    status(`Loaded ${file.name}.`);
  } catch (err) {
    status('Could not load: ' + err.message, true);
  }
}

export function newProject() {
  stopEverything();
  pushUndo();
  resetProject({ keepSettings: true });
  ui.playhead = 0;
  ui.songPlayhead = 0;
  status('New project. (Undo brings the previous one back.)');
}
