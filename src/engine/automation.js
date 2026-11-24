/**
 * Automation tracks: editing actions, and the audio graph that applies them during song
 * playback and song WAV export.
 *
 *   layer voices → [clip layer gain: layer volume/mute] → song track chain → master
 *   song track chain = one effect node per automation track targeting that song track, chained in
 *                      display order (top row first), its parameter driven by the automation curve.
 */
import { valueAt, sampleCurve, DEFAULT_EASE } from '../core/automation.js';
import { AUTOMATION_EFFECTS } from '../audio/effects.js';
import { createFxChain } from '../audio/fxChain.js';
import { fxFor } from '../audio/instruments.js';
import { project, makeAutomation, audible, normalizeOrder, songRows, songTrackById, songTrackVol } from '../stores/project.js';
import { ui, status } from '../stores/ui.js';
import { pushUndo } from '../stores/history.js';

const fx = (a) => AUTOMATION_EFFECTS[a.effect] || AUTOMATION_EFFECTS.volume;
/** Automation tracks in display order: a track's effects are chained in this order, top to bottom. */
export const automationInOrder = () => songRows().filter((r) => r.kind === 'auto').map((r) => r.item);
export const automationById = (id) => project.song.automation.find((a) => a.id === id);

/* ---------------- editing ---------------- */
/** New automation track (targets the first song track by default so it does something). */
export function addAutomation(effect = 'volume') {
  pushUndo();
  const first = project.song.tracks[0];
  const a = makeAutomation(effect, first ? [first.id] : []);
  project.song.automation.push(a);
  normalizeOrder(project.song); // appended at the bottom
  status(`Added "${a.name}". Choose its tracks, then double-click in its row to add points.`);
  return project.song.automation[project.song.automation.length - 1];
}

export function removeAutomation(id) {
  pushUndo();
  project.song.automation = project.song.automation.filter((a) => a.id !== id);
  normalizeOrder(project.song);
  if (ui.autoSel?.id === id) ui.autoSel = null;
}

/** Switch an automation track on/off: off keeps its curve but stops applying the effect. */
export function setAutomationEnabled(a, on) {
  if (a.enabled === on) return;
  pushUndo();
  a.enabled = on;
  status(`${a.name} ${on ? 'on' : 'off'}${on ? '' : ' (its curve is kept)'}.`);
}

export function setEffect(a, effect) {
  if (!AUTOMATION_EFFECTS[effect] || a.effect === effect) return;
  pushUndo();
  a.effect = effect;
  a.options = effectOptions(effect, a.options);
}

/** Default (or cleaned-up) per-track options for an effect; null when it has none. */
export function effectOptions(effect, o) {
  const spec = AUTOMATION_EFFECTS[effect]?.options;
  return spec ? spec.normalize({ ...spec.defaults, ...(o || {}) }) : null;
}

export function toggleTarget(a, trackId) {
  pushUndo();
  a.targets = a.targets.includes(trackId) ? a.targets.filter((t) => t !== trackId) : [...a.targets, trackId];
}

/** Add a point (replacing one at the same beat); returns its index. */
export function addPoint(a, beat, value) {
  pushUndo();
  const p = { beat: Math.max(0, beat), value: Math.max(0, Math.min(1, value)), ease: DEFAULT_EASE };
  const same = a.points.findIndex((q) => Math.abs(q.beat - p.beat) < 1e-6);
  if (same >= 0) { a.points[same].value = p.value; return same; }
  const i = a.points.findIndex((q) => q.beat > p.beat);
  const at = i < 0 ? a.points.length : i;
  a.points.splice(at, 0, p);
  return at;
}

export function deletePoint(a, index) {
  if (!a.points[index]) return;
  pushUndo();
  a.points.splice(index, 1);
  ui.autoSel = null;
}

export function deleteSelectedPoint() {
  const a = ui.autoSel && automationById(ui.autoSel.id);
  if (a) deletePoint(a, ui.autoSel.index);
}

/* ---------------- audio ---------------- */
const CURVE_RATE = 50; // automation samples per second

/** Drive `param` with automation `a` from `fromBeat` to `endBeat`; `at(beat)` → context time. */
export function scheduleAutomation(param, a, { fromBeat, endBeat, at }) {
  const e = fx(a);
  const start = e.toParam(valueAt(a.points, fromBeat, e.default));
  param.value = start;
  const t0 = at(fromBeat), t1 = at(endBeat);
  param.setValueAtTime(start, t0);
  if (a.points.length < 2 || t1 <= t0) return; // a flat line: one value is enough
  const n = Math.max(2, Math.ceil((t1 - t0) * CURVE_RATE));
  const values = sampleCurve(a.points, fromBeat, endBeat, n, e.default).map(e.toParam);
  param.setValueCurveAtTime(values, t0, t1 - t0);
}

/**
 * Per-play audio graph for the song. destFor(songTrack, layer) is where a clip's layer plays into.
 * opts: { fromBeat, endBeat, at(beat) → context time }
 */
export function buildSongGraph(ctx, master, opts) {
  const chains = new Map();     // song track id → chain input
  const layerGains = new Map(); // `${songTrackId}:${layerId}` → { node, layer }
  const soundGains = new Map(); // `${songTrackId}:${soundId}` → { node, sound }
  const nodes = [];
  const disposers = [];

  /**
   * Where a newly built chain's curves start. Normally the play start; but a curve whose start
   * time has already passed would be shifted later by browsers (they clamp the start of a value
   * curve to "now"), so a chain built mid-play starts its curves at the current beat instead.
   */
  function curveStart() {
    const t0 = opts.at(opts.fromBeat), now = ctx.currentTime ?? 0;
    if (!(now > t0)) return opts; // still ahead: start as planned
    const spb = opts.at(opts.fromBeat + 1) - t0;
    const late = now + 0.01 - t0; // a hair ahead of "now", so the browser doesn't clamp it
    return spb > 0 ? { ...opts, fromBeat: Math.min(opts.endBeat, opts.fromBeat + late / spb) } : opts;
  }

  function chainFor(trackId) {
    if (chains.has(trackId)) return chains.get(trackId);
    const input = ctx.createGain(); // the track's volume, before its automation
    input.gain.value = songTrackVol(songTrackById(trackId));
    nodes.push(input);
    let tail = input;
    const from = curveStart();
    for (const a of automationInOrder()) { // top to bottom, as shown in the Song view
      if (!a.targets.includes(trackId) || a.enabled === false) continue; // switched off: bypassed
      const e = fx(a), u = e.create(ctx, a.options);
      scheduleAutomation(u.param, a, from);
      tail.connect(u.input);
      nodes.push(u.input, u.output);
      if (u.dispose) disposers.push(u.dispose); // stops LFOs etc.
      tail = u.output;
    }
    tail.connect(master);
    chains.set(trackId, input);
    return input;
  }

  // Build every automated track's chain now, while the play start is still ahead: a track whose
  // first clip comes later must not get its curves scheduled late (they'd play shifted).
  for (const st of project.song.tracks) {
    if (project.song.automation.some((a) => a.enabled !== false && a.targets.includes(st.id))) chainFor(st.id);
  }

  return {
    destFor(songTrack, layer) {
      const key = `${songTrack.id}:${layer.id}`;
      if (!layerGains.has(key)) {
        const node = ctx.createGain();
        node.gain.value = audible(layer) ? layer.vol : 0;
        const fx = fxFor(layer); // a custom synth's own effects + reverb come before the song track's automation
        if (fx) {
          const c = createFxChain(ctx, fx);
          node.connect(c.input);
          c.output.connect(chainFor(songTrack.id));
          disposers.push(() => c.dispose());
        } else node.connect(chainFor(songTrack.id));
        nodes.push(node);
        layerGains.set(key, { node, layer });
      }
      return layerGains.get(key).node;
    },
    /** Where an imported sound's clips on `songTrack` play: sound volume → the track's automation. */
    soundDest(songTrack, sound) {
      const key = `${songTrack.id}:${sound.id}`;
      if (!soundGains.has(key)) {
        const node = ctx.createGain();
        node.gain.value = sound.vol;
        node.connect(chainFor(songTrack.id));
        nodes.push(node);
        soundGains.set(key, { node, sound });
      }
      return soundGains.get(key).node;
    },
    /** Re-apply track volumes, layer volume/mute/solo and sound volumes while playing. */
    updateMix() {
      for (const [trackId, input] of chains) input.gain.value = songTrackVol(songTrackById(trackId));
      for (const { node, layer } of layerGains.values()) node.gain.value = audible(layer) ? layer.vol : 0;
      for (const { node, sound } of soundGains.values()) node.gain.value = sound.vol;
    },
    /** Stop everything routed through this graph. */
    dispose() {
      for (const d of disposers) d();
      disposers.length = 0;
      for (const n of nodes) { try { n.disconnect(); } catch { /* already gone */ } }
      nodes.length = 0;
      chains.clear();
      layerGains.clear();
      soundGains.clear();
    },
  };
}
