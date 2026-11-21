/** Audition a set of notes immediately (e.g. the tremor modal's Preview), outside the transport. */
import { ensureAudio, getCtx } from '../audio/context.js';
import { busFor, silenceAll } from '../audio/mixer.js';
import { loadSample, playSample } from '../audio/gmSamples.js';
import { project, soundPitch, isDrum } from '../stores/project.js';
import { stopTransport } from './transport.js';
import { fxFor } from '../audio/instruments.js';
import { scheduleTrack } from './voices.js';
import { voiceSpans } from '../core/slides.js';

/**
 * Timing of the preview that is playing right now, so the UI can animate along with it
 * (the synth editor's filter graph). Plain object: read it per animation frame.
 *   t0/first/spb: audio time of the first note, its beat, seconds per beat
 *   voices: [{ start, end }] in beats (slide chains count as one voice)
 *   synth: the patch the preview was played with (unsaved edits included), or null
 */
export const previewClock = { active: false, id: 0, t0: 0, first: 0, spb: 0.5, end: 0, voices: [], synth: null };

/**
 * Play `notes` from `tr` right now, with optional per-note overrides
 * (e.g. n => ({ tremor })). Plays even if the layer is muted.
 * @returns duration in seconds
 */
export function previewNotes(tr, notes, override = () => ({})) {
  if (!notes.length) return 0;
  stopTransport();
  const actx = ensureAudio();
  silenceAll(); // cut any previous preview
  const spb = 60 / project.bpm;
  const first = Math.min(...notes.map((n) => n.start));
  const last = Math.max(...notes.map((n) => n.start + n.dur));
  const t0 = actx.currentTime + 0.05;
  const stand = { id: tr.id, inst: tr.inst, synth: tr.synth, notes: notes.map((n) => ({ ...n, ...override(n) })) };
  scheduleTrack(stand, -Infinity, Infinity, (b) => t0 + (b - first) * spb, spb, busFor(tr.id, tr.vol, fxFor(stand)));
  const secs = (last - first) * spb + 0.3;
  Object.assign(previewClock, {
    active: true, id: previewClock.id + 1, t0, first, spb, end: t0 + secs,
    voices: isDrum(stand) ? [] : voiceSpans(stand.notes),
    synth: stand.inst === 'custom' ? stand.synth : null,
  });
  return secs;
}

/**
 * Play `notes` with real samples of a General MIDI program (1-based) — what the exported
 * MIDI will roughly sound like in a GM player. Loads samples first (cached afterwards).
 * Pitches go through the song transpose like everything else.
 * @returns Promise<duration in seconds>; rejects if samples can't be loaded (e.g. offline)
 */
export async function previewGmProgram(tr, program, notes, { signal } = {}) {
  if (!notes.length) return 0;
  stopTransport();
  ensureAudio();
  const pitch = (n) => soundPitch(tr, n.pitch);
  const buffers = new Map();
  await Promise.all([...new Set(notes.map(pitch))].map(async (p) => buffers.set(p, await loadSample(program, p))));
  if (signal?.aborted) return 0; // cancelled while loading: don't start playing
  const actx = ensureAudio();
  silenceAll(); // cut any previous preview
  previewClock.active = false; // GM samples have no synth filters to animate
  const spb = 60 / project.bpm;
  const first = Math.min(...notes.map((n) => n.start));
  const last = Math.max(...notes.map((n) => n.start + n.dur));
  const t0 = actx.currentTime + 0.05;
  const bus = busFor(tr.id, tr.vol);
  for (const n of notes) playSample(bus, buffers.get(pitch(n)), t0 + (n.start - first) * spb, n.dur * spb, n.vel);
  return (last - first) * spb + 0.4;
}

export function stopPreview() {
  previewClock.active = false;
  if (getCtx()) silenceAll();
}

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
