/**
 * Recording: collects pitch frames + key taps during a take, then turns them into notes.
 *  - whistle mode:  taps give rhythm, pitch frames give pitch (core/align.js)
 *  - rhythm mode:   taps give empty slots, then pick mode chooses pitches; added to the layer (its
 *                   notes stay and play along), and taps already count during the count-in (pickups)
 *  - drum layers:   rhythm passes add to the pattern and can loop
 */
import { getCtx } from '../audio/context.js';
import { playVoice } from '../audio/synth.js';
import { padPitch, shiftDrumBank, BANK_KEYS, bankLabel, padHelp } from './drumPads.js';
import { alignTake, rhythmFromTaps } from '../core/align.js';
import { project, curTrack, isDrum, nid, setTake } from '../stores/project.js';
import { ui, status } from '../stores/ui.js';
import { pushUndo } from '../stores/history.js';
import { transport, transportHooks, tp, startTransport, stopTransport, drumOverdub, beatAtPerf } from './transport.js';
import { setPitchSink, isMicOn, enableMic } from './mic.js';
import { trackBus } from './mix.js';
import { pick, enterPick, exitPick } from './pick.js';

/** Live take buffer (read by the renderer to draw the trace while recording). */
export const rec = { frames: [], taps: [], open: new Map(), t0: 0, bpm: 100, flashTap: 0 };

const IGNORE_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape', 'OS', 'Fn']);

transportHooks.onRecordStart = ({ t0Perf, bpm }) => {
  rec.frames = [];
  rec.taps = [];
  rec.open.clear();
  rec.t0 = t0Perf;
  rec.bpm = bpm;
};

setPitchSink(({ midi, clarity }, perfCentre) => {
  if (!transport.recording) return;
  const t = (perfCentre - rec.t0) / 1000;
  if (t > -0.5) rec.frames.push({ t: +t.toFixed(4), midi: +midi.toFixed(3), c: +clarity.toFixed(3) });
});

export function onTapDown(e) {
  if (IGNORE_KEYS.has(e.key) || e.repeat) return;
  const stamp = e.timeStamp || performance.now();
  const t = (stamp - rec.t0) / 1000;
  let pitch = null;
  if (drumOverdub() && project.settings.livePads) { // optional: keys are drum pads, played live
    if (e.code in BANK_KEYS) { shiftDrumBank(BANK_KEYS[e.code]); return; } // Z / X switch pad banks
    pitch = padPitch(e.code);
    if (pitch == null) return;
    playVoice(trackBus(tp.target), 'drums', pitch, getCtx().currentTime, 0.1, +project.settings.vel || 96);
  }
  if (t < -0.15 && !transport.rhythmOnly) return; // still in the count-in (tapping rhythm counts it: pickup notes)
  const tap = { down: +t.toFixed(4), up: null };
  if (drumOverdub()) { // beat from the transport clock so loop wraps land correctly
    tap.beat = beatAtPerf(stamp);
    if (pitch != null) tap.pitch = pitch;
  }
  rec.taps.push(tap);
  rec.open.set(e.code || e.key, tap);
  rec.flashTap = performance.now();
}

export function onTapUp(e) {
  const tap = rec.open.get(e.code || e.key);
  if (!tap) return;
  tap.up = +(((e.timeStamp || performance.now()) - rec.t0) / 1000).toFixed(4);
  rec.open.delete(e.code || e.key);
}

transportHooks.onRecordStop = ({ target: tr, startBeat, rhythmOnly }) => {
  const endT = (performance.now() - rec.t0) / 1000;
  for (const tap of rec.open.values()) tap.up = endT;
  rec.open.clear();
  if (!tr || !project.tracks.includes(tr)) return;
  if (!rec.taps.length) { status('Recording stopped — no taps captured (tap any key on each note).', true); return; }
  const take = { bpm: rec.bpm, startBeat, endT: Math.max(0, endT), frames: rec.frames, taps: rec.taps };
  pushUndo();
  if (rhythmOnly && isDrum(tr)) finishDrumTake(tr, take);
  else if (rhythmOnly) finishRhythmTake(tr, take);
  else {
    const res = applyTake(tr, take);
    status(`Recorded ${res.notes.length} notes into "${tr.name}"` + (res.skipped ? ` — ${res.skipped} tap(s) had no detectable pitch` : '') + '.');
  }
};

/** Whistle take → notes, replacing notes inside the take's time range. */
export function applyTake(tr, take) {
  const res = alignTake(take, project.settings);
  const endBeat = take.startBeat + (take.endT * take.bpm) / 60;
  tr.notes = tr.notes.filter((n) => n.start < take.startBeat - 1e-6 || n.start >= endBeat);
  for (const n of res.notes) tr.notes.push({ id: nid(), ...n });
  tr.notes.sort((a, b) => a.start - b.start);
  setTake(tr, take);
  ui.sel.clear();
  return res;
}

/** Taps in the count-in that fell before the start of the pattern (beat 0) can't become notes. */
const tooEarly = (n) => (n ? ` ${n} tap${n === 1 ? '' : 's'} before the start of the pattern ${n === 1 ? 'was' : 'were'} left out (start recording later in the pattern for pickup notes).` : '');

/** Tapped rhythm → new notes, added to the layer (existing notes are kept); then pick mode chooses their pitches. */
function finishRhythmTake(tr, take) {
  const all = rhythmFromTaps(take, project.settings);
  const slots = all.filter((sl) => sl.start > -0.05).map((sl) => ({ ...sl, start: Math.max(0, sl.start) }));
  const early = all.length - slots.length;
  if (!slots.length) { status('No notes added —' + tooEarly(early), true); return; }
  const prev = tr.notes.filter((n) => n.start < slots[0].start - 1e-6).pop();
  const placeholder = prev ? prev.pitch : 60;
  const made = slots.map((sl) => ({ id: nid(), ...sl, pitch: placeholder, vel: +project.settings.vel || 96 }));
  tr.notes.push(...made);
  tr.notes.sort((a, b) => a.start - b.start);
  setTake(tr, null); // no pitch data — re-align would wipe these notes
  enterPick(made.map((n) => n.id), placeholder, false);
  if (early) status(tooEarly(early).trim(), true);
}

function finishDrumTake(tr, take) {
  // drums add to the existing pattern so passes can be layered, even while looping
  const shiftBeats = ((project.settings.tapShift || 0) / 1000) * take.bpm / 60;
  const hits = take.taps.filter((tap) => tap.beat != null && tap.beat + shiftBeats > -0.05); // count-in taps before beat 0: nowhere to go
  const early = take.taps.length - hits.length;
  const made = hits.map((tap) => ({
    id: nid(),
    start: Math.max(0, tap.beat + shiftBeats),
    dur: 0.25,
    pitch: tap.pitch != null ? tap.pitch : 36,
    vel: +project.settings.vel || 96,
  }));
  tr.notes.push(...made);
  tr.notes.sort((a, b) => a.start - b.start);
  if (project.settings.livePads) {
    ui.sel = new Set(made.map((n) => n.id));
    status(`Added ${made.length} drum hits to "${tr.name}" (selected — press Q to quantize, Ctrl+Z to undo).` + tooEarly(early));
  } else {
    if (made.length) enterPick(made.map((n) => n.id), 36, false); // second part: choose each hit's drum
    if (early) status(tooEarly(early).trim(), true);
  }
}

export async function startRecording(rhythmOnly) {
  if (transport.recording) { stopTransport(); return; }
  if (ui.view === 'song') { status('Recording goes into a pattern: open one with Edit (or the Pattern view) first.', true); return; }
  if (pick.active) exitPick();
  if (!rhythmOnly && !isMicOn() && !(await enableMic())) return;
  const tr = curTrack();
  startTransport(ui.playhead, { record: true, rhythmOnly });
  status(
    rhythmOnly && isDrum(tr) && project.settings.livePads
      ? `Live drum pads (${bankLabel()}, Z/X switch banks): ${padHelp()} · Space kick. Esc when done.`
      : rhythmOnly && isDrum(tr)
      ? `Tapping drum rhythm into "${tr.name}" — tap any key on each hit, Esc when done. Then pick each drum.`
      : rhythmOnly
      ? `Tapping rhythm into "${tr.name}" — tap any key on each note, Esc when done. Then pick pitches.`
      : `Recording into "${tr.name}" — whistle and tap any key on each note. Esc to stop.`,
  );
}

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
