/**
 * Transport: play / record / loop with a look-ahead scheduler.
 *
 * Beat↔time mapping is a list of anchors {t (ctx seconds), beat}; a new anchor is
 * pushed at each loop wrap so positions stay exact across loops.
 * Recording is delegated through `transportHooks` (set by recorder.js) to avoid
 * an import cycle.
 *
 * Two modes: 'pattern' plays the layers of the pattern being edited; 'song' plays the
 * arrangement (every clip's pattern, offset to the clip's position). Each has its own playhead.
 */
import { reactive } from 'vue';
import { ensureAudio, getCtx, getMaster, outLat, perfAtCtx, ctxAtPerf } from '../audio/context.js';
import { buildSongGraph } from './automation.js';
import { click } from '../audio/synth.js';
import { silenceAll } from '../audio/mixer.js';
import {
  project, audible, isDrum, curTrack, songEnd, songLength, patternById, clipLength, clipTrim, songTrackById, songTrackAudible, beatLen, barLen,
} from '../stores/project.js';
import { onBarLine } from '../core/meter.js';
import { ui } from '../stores/ui.js';
import { trackBus, applyMix } from './mix.js';
import { scheduleTrack } from './voices.js';
import { onFrame } from './frame.js';
import { scheduleSoundClips } from '../audio/soundBank.js';

export const transport = reactive({ playing: false, recording: false, rhythmOnly: false, mode: 'pattern' });

/** Internal scheduler state (non-reactive). */
export const tp = {
  anchors: [], ptr: 0, timer: null, startBeat: 0, countInEnd: 0,
  bpm: 100,       // tempo of this play: the song's, or the recording tempo while recording
  target: null,   // track being recorded into
  stopAt: null,   // auto-stop beat (phrase preview)
  onStop: null,
  graph: null,    // song mode: automation audio graph for this play
};

/** Layer volume/mute changes while the song plays. */
export const refreshSongMix = () => tp.graph?.updateMix();

export const transportHooks = {
  onRecordStart: null, // ({ t0Perf, bpm }) => void
  onRecordStop: null,  // ({ target, startBeat, rhythmOnly }) => void
};

/** Tapping rhythm on a drum layer: passes add up and may loop. */
export const drumOverdub = () => transport.recording && transport.rhythmOnly && isDrum(tp.target);

/**
 * Tempo while recording (● Rec and 🥁 Tap rhythm): settings.recTempo when set (e.g. slower, for fast
 * passages), else the song's. Takes are timed in beats at this tempo, so the notes land in place at any tempo.
 */
export const recordingBpm = () => {
  const t = +project.settings.recTempo;
  return t >= 30 && t <= 300 ? t : project.bpm;
};

/** @param opts.song  play the arrangement instead of the current pattern (default: the Song view is open) */
export function startTransport(fromBeat, { record = false, rhythmOnly = false, stopAt = null, onStop = null, song = ui.view === 'song' } = {}) {
  const actx = ensureAudio();
  if (transport.playing) stopTransport();
  if (song) record = false; // recording happens in the pattern editor
  transport.mode = song ? 'song' : 'pattern';
  applyMix();
  tp.bpm = record ? recordingBpm() : project.bpm;
  const spb = 60 / tp.bpm;
  const countIn = record ? ui.countIn * beatLen() : 0; // count-in is in counted beats (eighths in 6/8)
  const b0 = fromBeat - countIn;
  const t0 = actx.currentTime + 0.15;
  Object.assign(tp, {
    anchors: [{ t: t0, beat: b0 }], ptr: b0, startBeat: fromBeat, countInEnd: fromBeat,
    stopAt, onStop, target: record ? curTrack() : null,
  });
  if (song) { // song tracks play through their automation chains
    tp.graph = buildSongGraph(actx, getMaster(), { fromBeat, endBeat: songLength() + barLen(), at: (b) => t0 + (b - b0) * spb });
  }
  transport.playing = true;
  transport.recording = record;
  transport.rhythmOnly = record && rhythmOnly;
  if (record) {
    // performance.now() at which the user *hears* beat `fromBeat`
    transportHooks.onRecordStart?.({ t0Perf: perfAtCtx(t0 + countIn * spb) + outLat() * 1000, bpm: tp.bpm }); // the take is timed at this tempo
    if (typeof document !== 'undefined') document.activeElement?.blur?.();
  }
  tp.timer = setInterval(schedule, 25);
  schedule();
}

export function stopTransport() {
  if (!transport.playing) return;
  clearInterval(tp.timer);
  const wasRec = transport.recording;
  const rhythmOnly = transport.rhythmOnly;
  transport.playing = false;
  transport.recording = false;
  transport.rhythmOnly = false;
  silenceAll();
  tp.graph?.dispose();
  tp.graph = null;
  if (transport.mode === 'song') ui.songPlayhead = Math.max(0, tp.startBeat);
  else ui.playhead = Math.max(0, tp.startBeat);
  if (wasRec) transportHooks.onRecordStop?.({ target: tp.target, startBeat: tp.startBeat, rhythmOnly });
  const cb = tp.onStop;
  tp.onStop = null;
  cb?.();
}

/**
 * Restart (button / Home): put the playhead of the open view back at the beginning and scroll there.
 * While playing, playback carries on from the start. Not while recording.
 */
export function restartTransport() {
  if (transport.recording) return;
  const song = ui.view === 'song';
  if (song) ui.songPlayhead = 0;
  else { ui.playhead = 0; ui.scrollX = 0; }
  if (transport.playing) startTransport(0, { song });
}

export function schedule() {
  if (!transport.playing) return;
  const actx = getCtx();
  const spb = 60 / tp.bpm;
  const horizon = actx.currentTime + 0.2;
  const loopOn = transport.mode === 'pattern' && ui.loop && (!transport.recording || drumOverdub()) && ui.loopEnd > ui.loopStart + 0.01;
  for (let guard = 0; guard < 64; guard++) {
    const a = tp.anchors[tp.anchors.length - 1];
    let end = a.beat + (horizon - a.t) / spb;
    let wrap = false;
    if (loopOn && tp.ptr < ui.loopEnd && end >= ui.loopEnd) { end = ui.loopEnd; wrap = true; }
    if (end > tp.ptr) { scheduleRange(tp.ptr, end, a, spb); tp.ptr = end; }
    if (!wrap) break;
    tp.anchors.push({ t: a.t + (ui.loopEnd - a.beat) * spb, beat: ui.loopStart });
    tp.ptr = ui.loopStart;
  }
}

function scheduleRange(b0, b1, a, spb) {
  const at = (beat) => a.t + (beat - a.beat) * spb;
  const step = beatLen(); // a click per counted beat, accented on bar lines
  // each click belongs to exactly one range: ranges meet at a beat that can be off by a rounding error,
  // so both ends use the same tolerance (otherwise a click on the seam is scheduled twice)
  for (let k = Math.ceil(b0 / step - 1e-9); k * step < b1 - 1e-9; k++) {
    const b = k * step;
    const inCount = transport.recording && b < tp.countInEnd - 1e-9;
    if (inCount || ui.metronome) click(at(b), onBarLine(b, project.timeSig));
  }
  if (transport.mode === 'song') { scheduleSongRange(b0, b1, at, spb, a.beat); return; }
  for (const tr of project.tracks) {
    if (transport.recording && tr === tp.target && !transport.rhythmOnly) continue; // being replaced by the whistled take (tapped rhythm adds to it: keep playing)
    if (!audible(tr)) continue;
    scheduleTrack(tr, b0, b1, at, spb, trackBus(tr), a.beat);
  }
}

/** Song mode: each clip plays its pattern's layers (or its sound), shifted to the clip's start (minus what's truncated off its beginning). */
function scheduleSongRange(b0, b1, at, spb, segStart) {
  scheduleSoundClips(getCtx(), tp.graph, b0, b1, at, spb, segStart);
  for (const clip of project.song.clips) {
    if (clip.soundId != null) continue;
    const st = songTrackById(clip.trackId), p = patternById(clip.patternId);
    if (!st || !p || !songTrackAudible(st)) continue;
    const trim = clipTrim(clip), len = clipLength(clip);
    if (clip.start >= b1 || clip.start + len <= b0) continue;
    const o = clip.start - trim; // where the pattern's beat 0 falls in the song
    const shifted = (b) => at(b + o);
    for (const layer of p.layers) {
      if (!audible(layer)) continue;
      // notes starting in the visible part only; a slide into it from a cut-off note still sounds
      scheduleTrack(layer, Math.max(b0 - o, trim), Math.min(b1 - o, trim + len), shifted, spb, tp.graph.destFor(st, layer), Math.max(segStart - o, trim));
    }
  }
}

export function beatAtCtx(t) {
  let a = tp.anchors[0];
  for (const x of tp.anchors) if (x.t <= t) a = x;
  return a.beat + ((t - a.t) * tp.bpm) / 60;
}

/** Beat the user was *hearing* at performance time p (handles loop wraps). */
export const beatAtPerf = (p) => beatAtCtx(ctxAtPerf(p - outLat() * 1000));

export function currentBeat() {
  if (!transport.playing) return ui.view === 'song' ? ui.songPlayhead : ui.playhead;
  return beatAtCtx(getCtx().currentTime - outLat());
}

// auto-stop: phrase previews and the end of the song
onFrame(() => {
  if (!transport.playing || transport.recording) return;
  const b = currentBeat();
  if (tp.stopAt != null) { if (b >= tp.stopAt + 0.25) stopTransport(); }
  else if (transport.mode === 'song') { if (b > songLength() + 1) stopTransport(); }
  else if (!ui.loop && b > songEnd() + 1) stopTransport();
});

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
