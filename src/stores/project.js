/**
 * The document. Everything that gets saved, undone and exported lives here.
 *
 *   patterns  [{ id, name, layers: [layer], sel }]     a pattern = what the pattern editor shows
 *     layer   { id, name, inst, synth?, vol, mute, solo, color, notes: [note], take }
 *   song      { tracks: [{ id, name, color, mute, solo }],          rows in the Song view
 *               clips:  [{ id, trackId, patternId | soundId, start, trim?, len? }], a pattern (or sound) placed at `start` (beats);
 *                       `trim` beats cut off its beginning, `len` = beats it plays for (absent: to the end)
 *               sections: [{ id, name, color, start, end }],  labelled spans (intro, verse…) shown above the tracks
 *               automation: [{ id, name, color, effect, enabled, targets: [song track id], points: [{ beat, value, ease }] }],
 *               order: ['t:<track id>' | 'a:<automation id>', …] }   display order of all rows
 *
 *   sounds    [{ id, key, name, duration (s), vol, mime, size }]   imported audio; bytes live in IndexedDB under `key`
 *             (unique across projects — ids aren't) — see stores/soundStore.js
 *
 * Naming note: in code, `project.tracks` means **the layers of the pattern being edited**
 * (it predates the song view and the whole pattern editor reads it). It is an accessor onto
 * `curPattern().layers`. Song rows are `project.song.tracks`.
 *
 * Mutate through `project` (the reactive proxy) so autosave/redraw watchers fire.
 * Raw takes (thousands of pitch frames) are markRaw'd to keep reactivity cheap.
 */
import { reactive, markRaw, toRaw } from 'vue';
import { INSTRUMENTS } from '../audio/instruments.js';
import { normalizePatch } from '../audio/customSynth.js';
import { clamp } from '../core/music.js';
import { DEFAULT_TIME_SIG, normalizeTimeSig, barBeats, countBeats } from '../core/meter.js';
import { normalizePoints } from '../core/automation.js';
import { AUTOMATION_EFFECTS } from '../audio/effects.js';

export const DEFAULT_SETTINGS = {
  durMode: 'legato',   // legato | hold | fixed
  fixedBeats: 0.5,
  gapMs: 20,
  winStart: -50,       // pitch window start relative to tap (ms)
  winLen: 300,         // pitch window length (ms)
  tapShift: 0,         // latency compensation (ms)
  transpose: -12,      // applied to whistled pitch when aligning
  scaleRoot: 0,
  scale: 'chromatic',
  minClarity: 0.7,
  vel: 96,
  holdMs: 750,         // pick mode: hold this long to confirm
  livePads: false,     // drum layers: play pads live while tapping
  sampledPiano: true,  // piano layers use recorded samples (downloaded per note)
};

export const COLORS = ['#6aa8ff', '#ff9f5a', '#5ad19a', '#d77bff', '#ffd95a', '#ff6b9a', '#5ad6e0', '#b7c96a'];
/** Quarter-note beats per bar / per counted beat, from the project's time signature. */
export const barLen = () => barBeats(project.timeSig);
export const beatLen = () => countBeats(project.timeSig);

let uid = 1;
export const nid = () => uid++;
export const getUid = () => uid;

const findPattern = (self) => self.patterns.find((p) => p.id === self.curPattern) || self.patterns[0];

export const project = reactive({
  bpm: 100,
  transpose: 0,        // global playback/export transpose (semitones)
  timeSig: { ...DEFAULT_TIME_SIG }, // { num, den } — groups beats into bars (positions stay in quarter-note beats)
  sel: null,           // selected layer id (in the current pattern)
  settings: { ...DEFAULT_SETTINGS },
  patterns: [],
  curPattern: null,    // id of the pattern open in the pattern editor
  song: { tracks: [], clips: [], automation: [], order: [], sections: [] },
  sounds: [],          // imported sound effects (metadata only)
  /** The layers of the pattern being edited (see the naming note above). */
  get tracks() { return findPattern(this)?.layers ?? []; },
  set tracks(v) { const p = findPattern(this); if (p) p.layers = v; },
});

/* ---------------- layers (in the current pattern) ---------------- */
export function makeTrack(name, inst) {
  const i = project.tracks.length;
  return {
    id: nid(), name: name || `Layer ${i + 1}`, inst: inst || 'piano',
    vol: 0.8, mute: false, solo: false, color: COLORS[i % COLORS.length],
    notes: [], take: null,
  };
}

export function addTrack(name, inst) {
  const t = makeTrack(name, inst);
  project.tracks.push(t);
  project.sel = t.id;
  return project.tracks[project.tracks.length - 1];
}

export const curTrack = () => project.tracks.find((t) => t.id === project.sel) || project.tracks[0];
export const isDrum = (tr) => !!(tr && INSTRUMENTS[tr.inst] && INSTRUMENTS[tr.inst].drums);

/* ---------------- patterns ---------------- */
export const curPattern = () => findPattern(project);
export const patternById = (id) => project.patterns.find((p) => p.id === id);
/** The pattern a layer belongs to (null for stand-ins such as previews). */
export const patternOfLayer = (layer) => project.patterns.find((p) => p.layers.includes(layer)) || null;

export function makePattern(name, layers = []) {
  return { id: nid(), name: name || `Pattern ${project.patterns.length + 1}`, layers, sel: layers[0]?.id ?? null };
}

/** Switch the pattern editor to another pattern (remembers each pattern's selected layer). */
export function setCurPattern(id) {
  const next = patternById(id);
  if (!next || next.id === project.curPattern) return;
  const prev = curPattern();
  if (prev) prev.sel = project.sel;
  project.curPattern = next.id;
  project.sel = next.layers.some((l) => l.id === next.sel) ? next.sel : next.layers[0]?.id ?? null;
}

/** Length of a pattern in beats: its notes rounded up to whole bars of the time signature (at least one bar). */
export function patternLength(p) {
  let end = 0;
  for (const l of p.layers) for (const n of l.notes) end = Math.max(end, n.start + n.dur);
  const bar = barLen();
  return Math.max(bar, Math.ceil(end / bar - 1e-9) * bar);
}

/* ---------------- song ---------------- */
export function makeSongTrack(name) {
  const i = project.song.tracks.length;
  return { id: nid(), name: name || `Track ${i + 1}`, color: COLORS[i % COLORS.length], mute: false, solo: false };
}
export const songTrackById = (id) => project.song.tracks.find((t) => t.id === id);
export function songTrackAudible(st) {
  const anySolo = project.song.tracks.some((t) => t.solo);
  return !st.mute && (!anySolo || st.solo);
}
/* ---------------- sounds ---------------- */
export const soundById = (id) => project.sounds.find((s) => s.id === id);
/** A fresh storage key for a sound's audio. */
export const newSoundKey = () => `snd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
/** A sound's length in beats at the current tempo. */
export const soundBeats = (s) => (s.duration * project.bpm) / 60;
/** Does this clip point at something that exists? */
export const clipTarget = (c) => (c.soundId != null ? soundById(c.soundId) : patternById(c.patternId)) || null;
/** The untrimmed length of what a clip plays, in beats: its pattern's length, or its sound's duration at the current tempo. */
export function fullClipLength(c) {
  if (c.soundId != null) { const s = soundById(c.soundId); return s ? soundBeats(s) : 0; }
  const p = patternById(c.patternId);
  return p ? patternLength(p) : 0;
}
/** Beats cut off the beginning of a clip (never past its end, should the pattern have shrunk since). */
export const clipTrim = (c) => Math.max(0, Math.min(+c.trim || 0, fullClipLength(c) - MIN_CLIP));
/** Shortest a clip can be truncated to (beats). */
export const MIN_CLIP = 1 / 16;
/** A clip's length in beats on the timeline: what's left of its pattern/sound after truncating either end. */
export function clipLength(c) {
  const full = fullClipLength(c);
  if (!full) return 0;
  const rest = full - clipTrim(c);
  return c.len > 0 ? Math.min(c.len, rest) : rest;
}

/** End of the last clip, in beats. */
export function songLength() {
  let end = 0;
  for (const c of project.song.clips) if (clipTarget(c)) end = Math.max(end, c.start + clipLength(c));
  return end;
}

export function makeAutomation(effect = 'volume', targets = []) {
  const i = project.song.automation.length;
  const spec = AUTOMATION_EFFECTS[effect].options;
  return {
    id: nid(), name: `${AUTOMATION_EFFECTS[effect].label} ${i + 1}`, color: COLORS[(i + 4) % COLORS.length], effect,
    enabled: true, targets: [...targets], points: [], options: spec ? spec.normalize(spec.defaults) : null,
  };
}

/* ---------------- song sections ---------------- */
/** Suggested names for new sections, in the order they usually come. */
export const SECTION_NAMES = ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Bridge', 'Chorus', 'Outro'];
export const SECTION_COLORS = ['#6aa8ff', '#5ad19a', '#ff9f5a', '#5ad19a', '#ff9f5a', '#d77bff', '#ff9f5a', '#5ad6e0'];
const sectionColorFor = (name, i) => {
  const at = SECTION_NAMES.findIndex((n) => n.toLowerCase() === String(name).toLowerCase());
  return SECTION_COLORS[at >= 0 ? at : i % SECTION_COLORS.length];
};
export function makeSection(start, end, name) {
  const i = project.song.sections.length;
  const n = name || SECTION_NAMES[i % SECTION_NAMES.length];
  return { id: nid(), name: n, color: sectionColorFor(n, i), start, end };
}
/** Sections sorted by start. */
export const sortedSections = () => [...(project.song.sections || [])].sort((a, b) => a.start - b.start);

/* ---------------- row order (pattern tracks + automation tracks) ---------------- */
export const rowKey = (kind, id) => `${kind === 'auto' ? 'a' : 't'}:${id}`;

/** The row order listing every track and automation track exactly once (pure: keeps the stored order, appends the rest). */
export function orderKeys(song) {
  const valid = new Set([...song.tracks.map((t) => rowKey('track', t.id)), ...song.automation.map((a) => rowKey('auto', a.id))]);
  const seen = new Set();
  const order = (song.order || []).filter((k) => valid.has(k) && !seen.has(k) && seen.add(k));
  for (const t of song.tracks) { const k = rowKey('track', t.id); if (!seen.has(k)) { order.push(k); seen.add(k); } }
  for (const a of song.automation) { const k = rowKey('auto', a.id); if (!seen.has(k)) { order.push(k); seen.add(k); } }
  return order;
}
/** Store the normalized order (actions only — never call from a render). */
export function normalizeOrder(song) {
  song.order = orderKeys(song);
  return song.order;
}

/** All rows in display order: [{ kind: 'track' | 'auto', key, item }]. */
export function songRows() {
  const tracks = new Map(project.song.tracks.map((t) => [rowKey('track', t.id), t]));
  const autos = new Map(project.song.automation.map((a) => [rowKey('auto', a.id), a]));
  return orderKeys(project.song).map((key) => (tracks.has(key) ? { kind: 'track', key, item: tracks.get(key) } : { kind: 'auto', key, item: autos.get(key) }));
}
/** Pattern tracks in display order. */
export const orderedTracks = () => songRows().filter((r) => r.kind === 'track').map((r) => r.item);

/* ---------------- whole project ---------------- */
export function resetProject({ keepSettings = false } = {}) {
  const settings = keepSettings ? { ...project.settings } : { ...DEFAULT_SETTINGS };
  project.bpm = 100;
  project.transpose = 0;
  project.timeSig = { ...DEFAULT_TIME_SIG };
  project.settings = settings;
  project.patterns = [];
  project.sounds = [];
  project.song = { tracks: [], clips: [], automation: [], order: [], sections: [] };
  const p = makePattern('Pattern 1');
  project.patterns.push(p);
  project.curPattern = p.id;
  addTrack('Melody', 'flute');
  for (let i = 0; i < 4; i++) project.song.tracks.push(makeSongTrack());
  project.song.clips.push({ id: nid(), trackId: project.song.tracks[0].id, patternId: p.id, start: 0 });
  normalizeOrder(project.song);
}

/** Layer volume/mute/solo, judged within its own pattern. */
export function audible(tr) {
  const layers = patternOfLayer(tr)?.layers ?? project.tracks;
  const anySolo = layers.some((t) => t.solo);
  return !tr.mute && (!anySolo || tr.solo);
}

/** What actually sounds / gets exported: written pitch + global transpose (drums never move). */
export const soundPitch = (tr, p) => (isDrum(tr) ? p : clamp(p + (project.transpose || 0), 0, 127));

export function setTake(tr, take) {
  tr.take = take ? markRaw(take) : null;
}

/** End of the last note in the pattern being edited (beats). */
export function songEnd() {
  let e = 0;
  for (const t of project.tracks) for (const n of t.notes) e = Math.max(e, n.start + n.dur);
  return e;
}

/* ---------- (de)serialization ---------- */
export function serialize({ withTakes = true } = {}) {
  const p = toRaw(project);
  const patterns = withTakes ? p.patterns : p.patterns.map((pt) => ({ ...pt, layers: pt.layers.map((l) => ({ ...l, take: null })) }));
  return JSON.stringify({
    version: 3, bpm: p.bpm, transpose: p.transpose, timeSig: p.timeSig, sel: p.sel, settings: p.settings,
    patterns, curPattern: p.curPattern, song: p.song, sounds: p.sounds, uid,
  });
}

function loadLayer(t) {
  return {
    ...t,
    take: t.take ? markRaw(t.take) : null,
    ...(t.inst === 'custom' ? { synth: normalizePatch(t.synth) } : {}),
  };
}

/** Accepts v3 (patterns + song) and older single-pattern files (top-level `tracks`). */
export function loadProjectData(d) {
  const legacy = d && !Array.isArray(d.patterns) && Array.isArray(d.tracks);
  if (!d || (!legacy && !(Array.isArray(d.patterns) && d.patterns.length))) throw new Error('Not a project file');
  const pats = legacy
    ? [{ id: null, name: 'Pattern 1', layers: d.tracks, sel: d.sel }]
    : d.patterns;
  if (!pats.some((p) => p.layers?.length)) throw new Error('Not a project file');

  // ids: never reuse anything already in the file
  let maxId = d.uid || 1;
  const see = (id) => { if (Number.isInteger(id)) maxId = Math.max(maxId, id + 1); };
  for (const p of pats) { see(p.id); for (const l of p.layers || []) { see(l.id); for (const n of l.notes) see(n.id); } }
  for (const t of d.song?.tracks || []) see(t.id);
  for (const c of d.song?.clips || []) see(c.id);
  for (const s of d.sounds || []) see(s.id);
  for (const a of d.song?.automation || []) see(a.id);
  for (const x of d.song?.sections || []) see(x.id);
  uid = maxId;

  project.bpm = d.bpm || 100;
  project.transpose = clamp(Math.round(+d.transpose || 0), -12, 12);
  project.timeSig = normalizeTimeSig(d.timeSig);
  project.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  project.patterns = pats.map((p) => ({
    id: Number.isInteger(p.id) ? p.id : nid(),
    name: p.name || 'Pattern',
    layers: (p.layers || []).map(loadLayer),
    sel: p.sel ?? null,
  }));
  project.sounds = (d.sounds || []).filter((s) => Number.isInteger(s.id)).map((s) => ({
    id: s.id, key: typeof s.key === 'string' && s.key ? s.key : `sound-${s.id}`, name: s.name || 'Sound', duration: Math.max(0, +s.duration || 0), vol: Number.isFinite(+s.vol) ? clamp(+s.vol, 0, 1) : 0.8,
    mime: s.mime || '', size: +s.size || 0,
  }));
  const soundIds = new Set(project.sounds.map((s) => s.id));
  const ids = new Set(project.patterns.map((p) => p.id));
  project.curPattern = ids.has(d.curPattern) ? d.curPattern : project.patterns[0].id;

  if (legacy || !d.song) { // older files: put the pattern at bar 1 of a fresh song
    project.song = { tracks: [], clips: [], automation: [], order: [], sections: [] };
    for (let i = 0; i < 4; i++) project.song.tracks.push(makeSongTrack());
    project.song.clips.push({ id: nid(), trackId: project.song.tracks[0].id, patternId: project.patterns[0].id, start: 0 });
    normalizeOrder(project.song);
  } else {
    const tracks = (d.song.tracks || []).map((t, i) => ({
      id: Number.isInteger(t.id) ? t.id : nid(), name: t.name || `Track ${i + 1}`,
      color: t.color || COLORS[i % COLORS.length], mute: !!t.mute, solo: !!t.solo,
    }));
    const trackIds = new Set(tracks.map((t) => t.id));
    const clips = (d.song.clips || [])
      .filter((c) => trackIds.has(c.trackId) && (c.soundId != null ? soundIds.has(c.soundId) : ids.has(c.patternId)))
      .map((c) => ({
        id: Number.isInteger(c.id) ? c.id : nid(), trackId: c.trackId, ...(c.soundId != null ? { soundId: c.soundId } : { patternId: c.patternId }), start: Math.max(0, +c.start || 0),
        ...(+c.trim > 0 ? { trim: +c.trim } : {}), ...(+c.len > 0 ? { len: +c.len } : {}),
      }));
    const automation = (d.song.automation || []).map((a, i) => ({
      id: Number.isInteger(a.id) ? a.id : nid(),
      name: a.name || `Automation ${i + 1}`,
      color: a.color || COLORS[(i + 4) % COLORS.length],
      effect: AUTOMATION_EFFECTS[a.effect] ? a.effect : 'volume',
      targets: (a.targets || []).filter((t) => trackIds.has(t)),
      enabled: a.enabled !== false,
      points: normalizePoints(a.points),
      options: (() => { const spec = AUTOMATION_EFFECTS[a.effect]?.options; return spec ? spec.normalize({ ...spec.defaults, ...(a.options || {}) }) : null; })(),
    }));
    const sections = (d.song.sections || [])
      .filter((x) => Number.isFinite(+x.start) && Number.isFinite(+x.end) && +x.end > +x.start)
      .map((x, i) => ({ id: Number.isInteger(x.id) ? x.id : nid(), name: String(x.name ?? `Section ${i + 1}`), color: x.color || SECTION_COLORS[i % SECTION_COLORS.length], start: Math.max(0, +x.start), end: +x.end }));
    project.song = { tracks, clips, automation, order: Array.isArray(d.song.order) ? [...d.song.order] : [], sections };
    normalizeOrder(project.song); // older files: tracks first, then automation
  }
  const cur = curPattern();
  project.sel = cur.layers.some((l) => l.id === d.sel) ? d.sel : cur.layers.some((l) => l.id === cur.sel) ? cur.sel : cur.layers[0]?.id ?? null;
}

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
