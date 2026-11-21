/**
 * Decoded audio of imported sounds (id → AudioBuffer) plus waveform peaks, and scheduling
 * sound clips of the song. Kept apart from engine/sounds.js (import/delete/storage) so the
 * transport and the WAV renderer can use it without an import cycle.
 */
import { reactive } from 'vue';
import { project, soundById, songTrackById, songTrackAudible, clipLength, clipTrim } from '../stores/project.js';

const PEAK_BINS = 400;

/** Which sounds are decoded (reactive, for the UI); buffers/peaks live in plain maps. */
export const soundState = reactive({ ready: {}, missing: {}, importing: 0 });
const buffers = new Map(); // id → AudioBuffer
const peaks = new Map();   // id → Float32Array of 0–1 peak levels across the sound

export const soundBuffer = (id) => buffers.get(id) || null;
export const soundPeaks = (id) => (soundState.ready[id] ? peaks.get(id) : null);

/** Peak level per bin (max |sample| across channels), normalised to 0–1, for drawing waveforms. */
export function computePeaks(buffer, bins = PEAK_BINS) {
  const out = new Float32Array(bins);
  const len = buffer.length, chans = buffer.numberOfChannels;
  for (let c = 0; c < chans; c++) {
    const d = buffer.getChannelData(c);
    for (let b = 0; b < bins; b++) {
      const from = Math.floor((b * len) / bins), to = Math.max(from + 1, Math.floor(((b + 1) * len) / bins));
      let m = out[b];
      for (let i = from; i < to && i < len; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
      out[b] = m;
    }
  }
  let top = 0;
  for (const v of out) top = Math.max(top, v);
  if (top > 0) for (let b = 0; b < bins; b++) out[b] /= top;
  return out;
}

export function cacheSound(id, buffer) {
  buffers.set(id, buffer);
  peaks.set(id, computePeaks(buffer));
  soundState.ready[id] = true;
  delete soundState.missing[id];
}
export function forgetSound(id) {
  buffers.delete(id);
  peaks.delete(id);
  delete soundState.ready[id];
}

/**
 * Start the sound clips that begin in beats [b0, b1) — plus, when playback starts (or loops)
 * at `segStart` part-way through a clip, that clip from the matching point.
 * @param at    beat → context time
 * @param spb   seconds per beat
 * @param graph song graph (see engine/automation.js buildSongGraph) providing soundDest()
 * @returns the started source nodes
 */
export function scheduleSoundClips(ctx, graph, b0, b1, at, spb, segStart = null) {
  const started = [];
  for (const clip of project.song.clips) {
    if (clip.soundId == null) continue;
    const s = soundById(clip.soundId), buf = buffers.get(clip.soundId), st = songTrackById(clip.trackId);
    if (!s || !buf || !st || !songTrackAudible(st)) continue;
    const o = clip.start, len = clipLength(clip), trim = clipTrim(clip); // truncated: play [trim, trim + len) of the sound
    let when, into = 0;
    if (o >= b0 && o < b1) when = at(o);
    else if (segStart != null && segStart >= b0 && segStart < b1 && o < segStart && segStart < o + len) {
      when = at(segStart);
      into = segStart - o;
    } else continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(graph.soundDest(st, s));
    src.start(when, (trim + into) * spb, (len - into) * spb);
    started.push(src);
  }
  return started;
}
