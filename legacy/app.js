'use strict';
/* Whistle → MIDI: recorder, aligner, piano-roll editor, layered synth playback, MIDI export. */
const Core = window.Core;
const $ = (s) => document.querySelector(s);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
const COLORS = ['#6aa8ff', '#ff9f5a', '#5ad19a', '#d77bff', '#ffd95a', '#ff6b9a', '#5ad6e0', '#b7c96a'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ======================= instruments ======================= */
// partials: [type, freq ratio, gain, detune cents]; a=attack, s=sustain level, dt=decay time-constant, r=release
const INSTRUMENTS = {
  piano:    { name: 'Piano', gm: 0, partials: [['triangle', 1, 1], ['sine', 2, 0.35], ['sine', 3, 0.12]], a: 0.004, s: 0, dt: 0.7, r: 0.12, lp: 10 },
  musicbox: { name: 'Music box', gm: 10, partials: [['sine', 1, 1], ['sine', 4, 0.3], ['sine', 7.1, 0.08]], a: 0.002, s: 0, dt: 0.45, r: 0.15 },
  marimba:  { name: 'Marimba', gm: 12, partials: [['sine', 1, 1], ['sine', 4, 0.2]], a: 0.002, s: 0, dt: 0.22, r: 0.08 },
  organ:    { name: 'Organ', gm: 16, partials: [['sine', 1, 1], ['sine', 2, 0.5], ['sine', 3, 0.3], ['sine', 4, 0.15]], a: 0.01, s: 1, dt: 0.02, r: 0.05 },
  guitar:   { name: 'Guitar', gm: 24, partials: [['sawtooth', 1, 1]], a: 0.003, s: 0, dt: 0.55, r: 0.1, lp: 4 },
  bass:     { name: 'Bass', gm: 33, partials: [['sawtooth', 1, 0.7], ['sine', 0.5, 0.5]], a: 0.005, s: 0.5, dt: 0.25, r: 0.07, lp: 3 },
  strings:  { name: 'Strings', gm: 48, partials: [['sawtooth', 1, 0.6, -7], ['sawtooth', 1, 0.6, 7]], a: 0.15, s: 1, dt: 0.1, r: 0.3, lp: 5 },
  brass:    { name: 'Brass', gm: 61, partials: [['sawtooth', 1, 1]], a: 0.05, s: 0.8, dt: 0.12, r: 0.08, lp: 4 },
  flute:    { name: 'Flute', gm: 73, partials: [['sine', 1, 1], ['sine', 2, 0.12]], a: 0.06, s: 1, dt: 0.05, r: 0.1, vib: 6 },
  whistle:  { name: 'Whistle', gm: 78, partials: [['sine', 1, 1]], a: 0.03, s: 1, dt: 0.05, r: 0.08, vib: 10 },
  square:   { name: 'Square lead', gm: 80, partials: [['square', 1, 0.6]], a: 0.008, s: 1, dt: 0.05, r: 0.06, lp: 6 },
  saw:      { name: 'Saw lead', gm: 81, partials: [['sawtooth', 1, 0.6]], a: 0.008, s: 1, dt: 0.05, r: 0.06, lp: 7 },
  drums:    { name: 'Drum kit', gm: 0, drums: true },
};
const isDrum = (tr) => !!(tr && INSTRUMENTS[tr.inst] && INSTRUMENTS[tr.inst].drums);

/* ---------- drum kit: GM percussion notes, computer-key pads ---------- */
const DRUMS = {
  36: { name: 'Kick', key: 'KeyA' },
  38: { name: 'Snare', key: 'KeyS' },
  42: { name: 'Hat', key: 'KeyD' },
  46: { name: 'Open hat', key: 'KeyF' },
  39: { name: 'Clap', key: 'KeyG' },
  45: { name: 'Tom low', key: 'KeyH' },
  47: { name: 'Tom mid', key: 'KeyJ' },
  50: { name: 'Tom high', key: 'KeyK' },
  49: { name: 'Crash', key: 'KeyL' },
  51: { name: 'Ride', key: 'Semicolon' },
  37: { name: 'Rim', key: 'KeyW' },
  44: { name: 'Pedal hat', key: 'KeyE' },
  41: { name: 'Floor tom', key: 'KeyT' },
  56: { name: 'Cowbell', key: 'KeyY' },
  54: { name: 'Tambourine', key: 'KeyU' },
};
const DRUM_KEYS = Object.fromEntries(Object.entries(DRUMS).map(([p, d]) => [d.key, +p]));
DRUM_KEYS.Space = 36; // space also kicks
const keyLabel = (code) => (code === 'Semicolon' ? ';' : code === 'Quote' ? "'" : code.replace(/^Key/, ''));

let noiseBuf = null;
function noise(when, dur) {
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = actx.createBufferSource();
  s.buffer = noiseBuf; s.loop = true;
  s.start(when, Math.random() * 0.5); s.stop(when + dur);
  return s;
}
function filt(type, freq, q) { const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7; return f; }
// exponential-decay envelope; returns the gain node
function envGain(when, peak, decay, dest) {
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  g.connect(dest);
  return g;
}
function noiseHit(dest, when, v, type, freq, q, decay) {
  const n = noise(when, decay + 0.05), f = filt(type, freq, q);
  n.connect(f); f.connect(envGain(when, v, decay, dest));
}
function toneHit(dest, when, v, type, f0, f1, decay) {
  const o = actx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, when);
  o.frequency.exponentialRampToValueAtTime(f1, when + decay * 0.6);
  o.connect(envGain(when, v, decay, dest));
  o.start(when); o.stop(when + decay + 0.05);
}
const TOM_HZ = { 41: 75, 43: 90, 45: 110, 47: 135, 48: 160, 50: 190 };
function playDrum(dest, pitch, when, vel) {
  const v = (vel / 127) * 0.9;
  switch (pitch) {
    case 35: case 36: toneHit(dest, when, v, 'sine', 160, 42, 0.4); toneHit(dest, when, v * 0.3, 'triangle', 600, 100, 0.03); break;
    case 38: case 40: noiseHit(dest, when, v * 0.7, 'highpass', 1200, 0.7, 0.2); toneHit(dest, when, v * 0.5, 'triangle', 220, 160, 0.1); break;
    case 37: toneHit(dest, when, v * 0.6, 'square', 900, 800, 0.03); noiseHit(dest, when, v * 0.3, 'bandpass', 3000, 2, 0.03); break;
    case 39: // clap: three quick bursts and a tail
      for (const dt of [0, 0.012, 0.024]) noiseHit(dest, when + dt, v * 0.6, 'bandpass', 1300, 1.5, 0.03);
      noiseHit(dest, when + 0.03, v * 0.5, 'bandpass', 1300, 1.2, 0.18); break;
    case 42: case 44: noiseHit(dest, when, v * 0.45, 'highpass', 7500, 0.7, pitch === 44 ? 0.07 : 0.05); break;
    case 46: noiseHit(dest, when, v * 0.4, 'highpass', 7000, 0.7, 0.35); break;
    case 49: case 57: noiseHit(dest, when, v * 0.45, 'highpass', 4500, 0.5, 1.4); break;
    case 51: case 59: noiseHit(dest, when, v * 0.25, 'bandpass', 7000, 1, 0.6); toneHit(dest, when, v * 0.08, 'square', 480, 470, 0.5); break;
    case 54: noiseHit(dest, when, v * 0.4, 'bandpass', 9000, 1.5, 0.18); break;
    case 56: { const bp = filt('bandpass', 800, 2); bp.connect(envGain(when, v * 0.5, 0.3, dest));
      for (const f of [540, 800]) { const o = actx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(bp); o.start(when); o.stop(when + 0.35); } break; }
    default:
      if (TOM_HZ[pitch]) { const f = TOM_HZ[pitch]; toneHit(dest, when, v, 'sine', f * 1.6, f, 0.35); }
      else noiseHit(dest, when, v * 0.4, 'bandpass', 2000 + (pitch % 12) * 400, 2, 0.08); // unmapped: short click
  }
}

let actx = null, master = null;
const trackBus = new Map(); // track id -> GainNode

function ensureAudio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    master = actx.createGain();
    master.gain.value = ui.masterVol;
    master.connect(comp); comp.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function busFor(tr) {
  let g = trackBus.get(tr.id);
  if (!g) {
    g = actx.createGain();
    g.connect(master);
    trackBus.set(tr.id, g);
  }
  g.gain.value = audible(tr) ? tr.vol : 0;
  return g;
}
function audible(tr) {
  const anySolo = project.tracks.some((t) => t.solo);
  return !tr.mute && (!anySolo || tr.solo);
}
function applyMix() {
  if (!actx) return;
  for (const tr of project.tracks) busFor(tr);
}
function silenceAll() {
  for (const g of trackBus.values()) {
    try { g.gain.cancelScheduledValues(0); g.gain.value = 0; g.disconnect(); } catch (e) { /* ignore */ }
  }
  trackBus.clear();
}

function playVoice(dest, instKey, midi, when, dur, vel) {
  const spec = INSTRUMENTS[instKey] || INSTRUMENTS.piano;
  if (spec.drums) { playDrum(dest, midi, when, vel); return; }
  const freq = Core.midiToFreq(midi);
  const env = actx.createGain();
  let out = env;
  if (spec.lp) {
    const f = actx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.min(18000, freq * spec.lp + 300);
    f.Q.value = 0.7;
    env.connect(f);
    out = f;
  }
  out.connect(dest);
  const total = spec.partials.reduce((s, p) => s + p[2], 0);
  const peak = (vel / 127) * 0.35 / Math.max(1, total * 0.8);
  const g = env.gain;
  g.setValueAtTime(0, when);
  g.linearRampToValueAtTime(peak, when + spec.a);
  g.setTargetAtTime(peak * spec.s, when + spec.a, spec.dt);
  const off = when + Math.max(dur, spec.a + 0.01);
  g.setTargetAtTime(0, off, spec.r / 3);
  const stop = off + spec.r * 2 + 0.05;
  let lfo = null;
  if (spec.vib) {
    lfo = actx.createOscillator();
    const lg = actx.createGain();
    lfo.frequency.value = 5.2;
    lg.gain.value = spec.vib;
    lfo.connect(lg);
    lfo._g = lg;
    lfo.start(when); lfo.stop(stop);
  }
  for (const [type, ratio, gain, det] of spec.partials) {
    const o = actx.createOscillator();
    const og = actx.createGain();
    o.type = type;
    o.frequency.value = freq * ratio;
    if (det) o.detune.value = det;
    if (lfo) lfo._g.connect(o.detune);
    og.gain.value = gain;
    o.connect(og); og.connect(env);
    o.start(when); o.stop(stop);
  }
}

function click(when, accent) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.frequency.value = accent ? 1760 : 1100;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g); g.connect(master);
  o.start(when); o.stop(when + 0.06);
}

// Global transpose: notes stay written; what you hear and what's exported is shifted. Drums never move.
const soundPitch = (tr, p) => (isDrum(tr) ? p : clamp(p + (project.transpose || 0), 0, 127));
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const keyName = (pc) => FLAT_NAMES[((pc % 12) + 12) % 12];
const trLabel = (t) => {
  const root = +project.settings.scaleRoot || 0;
  return `${t > 0 ? '+' : ''}${t}  (${keyName(root)} → ${keyName(root + t)})`;
};

function audition(tr, pitch, vel) {
  ensureAudio();
  playVoice(busFor(tr), tr.inst, soundPitch(tr, pitch), actx.currentTime + 0.01, 0.25, vel || 96);
}

/* ======================= state ======================= */
let uid = 1;
const nid = () => uid++;
const DEFAULT_SETTINGS = {
  durMode: 'legato', fixedBeats: 0.5, gapMs: 20, winStart: -50, winLen: 300, tapShift: 0,
  transpose: -12, scaleRoot: 0, scale: 'chromatic', minClarity: 0.7, vel: 96, holdMs: 750, livePads: false,
};
let project = null;
newProject();
const ui = {
  snap: 0.25, metronome: true, countIn: 4, loop: false, loopStart: 0, loopEnd: 8,
  showTrace: true, ppb: 80, row: 14, scrollX: 0, topPitch: 88, playhead: 0, masterVol: 0.8,
  sel: new Set(), clipboard: null,
};

function newTrack(name, inst) {
  const i = project ? project.tracks.length : 0;
  return { id: nid(), name: name || `Layer ${i + 1}`, inst: inst || 'piano', vol: 0.8, mute: false, solo: false, color: COLORS[i % COLORS.length], notes: [], take: null };
}
function newProject() {
  const p = { bpm: 100, transpose: 0, tracks: [], sel: null, settings: { ...DEFAULT_SETTINGS } };
  project = p;
  const t = newTrack('Melody', 'flute');
  p.tracks.push(t);
  p.sel = t.id;
  return p;
}
const curTrack = () => project.tracks.find((t) => t.id === project.sel) || project.tracks[0];
const selNotes = () => curTrack().notes.filter((n) => ui.sel.has(n.id));

/* ---------- undo ---------- */
const undoStack = [], redoStack = [];
function snapshot() {
  return {
    bpm: project.bpm, transpose: project.transpose, sel: project.sel,
    tracks: project.tracks.map((t) => ({ ...t, notes: t.notes.map((n) => ({ ...n })) })),
  };
}
function restore(s) {
  project.bpm = s.bpm; project.transpose = s.transpose || 0; project.sel = s.sel;
  project.tracks = s.tracks.map((t) => ({ ...t, notes: t.notes.map((n) => ({ ...n })) }));
  ui.sel.clear();
  applyMix(); renderTracks(); syncControls(); autosave(); draw();
}
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
function undo() { if (undoStack.length) { redoStack.push(snapshot()); restore(undoStack.pop()); status('Undo'); } }
function redo() { if (redoStack.length) { undoStack.push(snapshot()); restore(redoStack.pop()); status('Redo'); } }

/* ---------- persistence ---------- */
let saveTimer = null;
function serialize() { return JSON.stringify({ version: 1, ...project, uid }); }
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('open-daw-project', serialize()); }
    catch (e) {
      try { // quota: retry without raw takes
        const p = JSON.parse(serialize());
        p.tracks.forEach((t) => (t.take = null));
        localStorage.setItem('open-daw-project', JSON.stringify(p));
      } catch (e2) { /* storage unavailable */ }
    }
  }, 400);
}
function loadProjectData(d) {
  if (!d || !Array.isArray(d.tracks) || !d.tracks.length) throw new Error('Not a project file');
  project = { bpm: d.bpm || 100, transpose: clamp(Math.round(+d.transpose || 0), -12, 12), tracks: d.tracks, sel: d.sel, settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } };
  let maxId = d.uid || 1;
  for (const t of project.tracks) {
    maxId = Math.max(maxId, t.id + 1);
    for (const n of t.notes) maxId = Math.max(maxId, n.id + 1);
  }
  uid = maxId;
  if (!project.tracks.find((t) => t.id === project.sel)) project.sel = project.tracks[0].id;
  ui.sel.clear();
}

/* ======================= transport ======================= */
const tp = { playing: false, recording: false, anchors: [], ptr: 0, timer: null, startBeat: 0, target: null };
const outLat = () => (actx ? actx.outputLatency || actx.baseLatency || 0 : 0);

function perfAtCtx(t) {
  if (actx.getOutputTimestamp) {
    const ts = actx.getOutputTimestamp();
    if (ts && ts.performanceTime) return ts.performanceTime + (t - ts.contextTime) * 1000;
  }
  return performance.now() + (t - actx.currentTime) * 1000;
}

function songEnd() {
  let e = 0;
  for (const t of project.tracks) for (const n of t.notes) e = Math.max(e, n.start + n.dur);
  return e;
}

function startTransport(fromBeat, record, rhythmOnly, stopAt) {
  ensureAudio();
  if (tp.playing) stopTransport();
  tp.rhythmOnly = !!(record && rhythmOnly);
  tp.stopAt = stopAt == null ? null : stopAt;
  applyMix();
  const spb = 60 / project.bpm;
  const countIn = record ? ui.countIn : 0;
  const b0 = fromBeat - countIn;
  const t0 = actx.currentTime + 0.15;
  tp.anchors = [{ t: t0, beat: b0 }];
  tp.ptr = b0;
  tp.playing = true;
  tp.recording = record;
  tp.startBeat = fromBeat;
  tp.countInEnd = fromBeat;
  if (record) {
    tp.target = curTrack();
    rec.frames = []; rec.taps = []; rec.open.clear();
    // performance.now() at which the user *hears* beat `fromBeat`
    rec.t0 = perfAtCtx(t0 + countIn * spb) + outLat() * 1000;
    rec.bpm = project.bpm;
    if (document.activeElement) document.activeElement.blur();
  }
  tp.timer = setInterval(schedule, 25);
  schedule();
  updateTransportUI();
}

function schedule() {
  if (!tp.playing) return;
  const spb = 60 / project.bpm;
  const horizon = actx.currentTime + 0.2;
  const loopOn = ui.loop && (!tp.recording || drumOverdub()) && ui.loopEnd > ui.loopStart + 0.01;
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
  // metronome: always during count-in, otherwise if enabled
  for (let b = Math.ceil(b0 - 1e-9); b < b1; b++) {
    const inCount = tp.recording && b < tp.countInEnd;
    if (inCount || ui.metronome) click(at(b), ((b % 4) + 4) % 4 === 0);
  }
  for (const tr of project.tracks) {
    if (tp.recording && tr === tp.target && !drumOverdub()) continue; // being replaced
    if (!audible(tr)) continue;
    const bus = busFor(tr);
    for (const n of tr.notes) {
      if (n.start >= b0 && n.start < b1) playVoice(bus, tr.inst, soundPitch(tr, n.pitch), at(n.start), n.dur * spb, n.vel);
    }
  }
}

function beatAtCtx(t) {
  let a = tp.anchors[0];
  for (const x of tp.anchors) if (x.t <= t) a = x;
  return a.beat + (t - a.t) * project.bpm / 60;
}
function ctxAtPerf(p) {
  if (actx.getOutputTimestamp) {
    const ts = actx.getOutputTimestamp();
    if (ts && ts.performanceTime) return ts.contextTime + (p - ts.performanceTime) / 1000;
  }
  return actx.currentTime + (p - performance.now()) / 1000;
}
// beat the user was *hearing* at performance time p (handles loop wraps)
const beatAtPerf = (p) => beatAtCtx(ctxAtPerf(p - outLat() * 1000));
function currentBeat() {
  if (!tp.playing) return ui.playhead;
  return beatAtCtx(actx.currentTime - outLat());
}

function stopTransport() {
  if (!tp.playing) return;
  clearInterval(tp.timer);
  const wasRec = tp.recording;
  tp.playing = false;
  tp.recording = false;
  silenceAll();
  ui.playhead = Math.max(0, tp.startBeat);
  if (wasRec) finishRecording();
  updateTransportUI();
  draw();
}

/* ======================= microphone & pitch ======================= */
let micStream = null, micSource = null, analyser = null, abuf = null, pollTimer = null;
const live = { midi: 0, clarity: 0, rms: 0 };
const rec = { frames: [], taps: [], open: new Map(), t0: 0, bpm: 100 };

async function enableMic() {
  ensureAudio();
  const deviceId = $('#micSel').value;
  try {
    disableMic();
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
    });
  } catch (e) {
    status('Microphone unavailable: ' + e.message, true);
    return false;
  }
  micSource = actx.createMediaStreamSource(micStream);
  analyser = actx.createAnalyser();
  analyser.fftSize = 2048;
  abuf = new Float32Array(analyser.fftSize);
  micSource.connect(analyser);
  pollTimer = setInterval(pollPitch, 10);
  $('#micBtn').classList.add('on');
  listDevices();
  status('Mic on — whistle to test the pitch readout.');
  return true;
}
function disableMic() {
  clearInterval(pollTimer);
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = null; analyser = null;
  $('#micBtn').classList.remove('on');
}
async function listDevices() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const sel = $('#micSel'), cur = sel.value;
    sel.innerHTML = '<option value="">default input</option>' +
      devs.map((d) => `<option value="${d.deviceId}">${escapeHtml(d.label || 'Input ' + d.deviceId.slice(0, 5))}</option>`).join('');
    sel.value = cur;
  } catch (e) { /* ignore */ }
}

function pollPitch() {
  if (!analyser) return;
  analyser.getFloatTimeDomainData(abuf);
  const r = Core.detectPitch(abuf, actx.sampleRate);
  live.rms = r.rms;
  live.clarity = r.clarity;
  live.midi = r.freq ? Core.freqToMidi(r.freq) : 0;
  if (tp.recording) {
    // timestamp the centre of the analysis window
    const t = (performance.now() - (abuf.length / 2 / actx.sampleRate) * 1000 - rec.t0) / 1000;
    if (t > -0.5) rec.frames.push({ t: +t.toFixed(4), midi: +live.midi.toFixed(3), c: +r.clarity.toFixed(3) });
  }
}

/* ---------- taps ---------- */
const IGNORE_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape', 'OS', 'Fn']);
// tapping rhythm on a drum layer: keys are drum pads and each pass adds to the layer
const drumOverdub = () => tp.recording && tp.rhythmOnly && isDrum(tp.target);
function onTapDown(e) {
  if (IGNORE_KEYS.has(e.key) || e.repeat) return;
  const t = ((e.timeStamp || performance.now()) - rec.t0) / 1000;
  let pitch = null;
  if (drumOverdub() && project.settings.livePads) { // optional: keys are drum pads, played live
    pitch = DRUM_KEYS[e.code];
    if (pitch == null) return; // not a pad
    playVoice(busFor(tp.target), 'drums', pitch, actx.currentTime, 0.1, +project.settings.vel || 96); // drums: never transposed
  }
  if (t < -0.15) return; // still in count-in
  const tap = { down: +t.toFixed(4), up: null };
  if (drumOverdub()) { // beat from the transport clock, so loop wraps land correctly
    tap.beat = beatAtPerf(e.timeStamp || performance.now());
    if (pitch != null) tap.pitch = pitch;
  }
  rec.taps.push(tap);
  rec.open.set(e.code || e.key, tap);
  flashTap = performance.now();
}
function onTapUp(e) {
  const tap = rec.open.get(e.code || e.key);
  if (!tap) return;
  tap.up = +(((e.timeStamp || performance.now()) - rec.t0) / 1000).toFixed(4);
  rec.open.delete(e.code || e.key);
}
let flashTap = 0;

function finishRecording() {
  const endT = (performance.now() - rec.t0) / 1000;
  for (const tap of rec.open.values()) tap.up = endT;
  rec.open.clear();
  const tr = tp.target;
  if (!tr || !project.tracks.includes(tr)) return;
  if (!rec.taps.length) { status('Recording stopped — no taps captured (tap any key on each note).', true); return; }
  const take = { bpm: rec.bpm, startBeat: tp.startBeat, endT: Math.max(0, endT), frames: rec.frames, taps: rec.taps };
  pushUndo();
  if (tp.rhythmOnly && isDrum(tr)) {
    // drums add to the existing pattern (so passes can be layered, even while looping)
    const made = take.taps.filter((tap) => tap.beat != null).map((tap) => ({
      id: nid(),
      start: Math.max(0, tap.beat + ((project.settings.tapShift || 0) / 1000) * take.bpm / 60),
      dur: 0.25, pitch: tap.pitch != null ? tap.pitch : 36, vel: +project.settings.vel || 96,
    }));
    tr.notes.push(...made);
    tr.notes.sort((a, b) => a.start - b.start);
    autosave();
    if (project.settings.livePads) { // drums were chosen while tapping
      ui.sel = new Set(made.map((n) => n.id));
      draw();
      status(`Added ${made.length} drum hits to "${tr.name}" (selected — press Q to quantize, Ctrl+Z to undo).`);
    } else {
      // second part: pick each hit's drum on the pad keys
      enterPick(made.map((n) => n.id), 36, false);
    }
    return;
  }
  if (tp.rhythmOnly) {
    // rhythm pass: create pitch-less slots, then step through them on the keyboard piano
    const slots = Core.rhythmFromTaps(take, project.settings);
    const endBeat = take.startBeat + (take.endT * take.bpm) / 60;
    const prev = tr.notes.filter((n) => n.start < take.startBeat - 1e-6).pop();
    const placeholder = prev ? prev.pitch : 60;
    tr.notes = tr.notes.filter((n) => n.start < take.startBeat - 1e-6 || n.start >= endBeat);
    const made = slots.map((sl) => ({ id: nid(), ...sl, pitch: placeholder, vel: +project.settings.vel || 96 }));
    tr.notes.push(...made);
    tr.notes.sort((a, b) => a.start - b.start);
    tr.take = null; // no pitch data — re-align would wipe these notes
    autosave();
    enterPick(made.map((n) => n.id), placeholder, false);
    return;
  }
  const res = applyTake(tr, take);
  status(`Recorded ${res.notes.length} notes into "${tr.name}"` + (res.skipped ? ` — ${res.skipped} tap(s) had no detectable pitch` : '') + '.');
}

function applyTake(tr, take) {
  const res = Core.alignTake(take, project.settings);
  const endBeat = take.startBeat + (take.endT * take.bpm) / 60;
  tr.notes = tr.notes.filter((n) => n.start < take.startBeat - 1e-6 || n.start >= endBeat);
  for (const n of res.notes) tr.notes.push({ id: nid(), ...n });
  tr.notes.sort((a, b) => a.start - b.start);
  tr.take = take;
  ui.sel.clear();
  autosave(); draw();
  return res;
}

/* ======================= pitch-pick mode (keyboard as piano) ======================= */
// Layout-independent physical keys: home row = white keys, row above = black keys.
const PIANO_KEYS = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};
const KEY_LABEL = Object.fromEntries(Object.entries(PIANO_KEYS).map(([c, o]) => [o, c === 'Semicolon' ? ';' : c === 'Quote' ? "'" : c.slice(3)]));
const pick = { active: false, ids: [], i: 0, base: 60, done: new Set(), hold: null, flash: 0 };

function enterPick(ids, nearPitch, withUndo) {
  const tr = curTrack();
  ids = ids.filter((id) => tr.notes.some((n) => n.id === id));
  if (!ids.length) { status('No notes to pick pitches for.', true); return; }
  if (withUndo) pushUndo();
  const byId = new Map(tr.notes.map((n) => [n.id, n]));
  ids.sort((a, b) => byId.get(a).start - byId.get(b).start);
  Object.assign(pick, { active: true, ids, i: 0, done: new Set(), hold: null });
  pick.base = clamp(Math.floor((nearPitch == null ? 60 : nearPitch) / 12) * 12, 12, 108);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  focusPick();
  $('#pickOverlay').style.display = 'block';
  status(`Pick mode: ${ids.length} notes. Hold a key ${project.settings.holdMs} ms to confirm each.`);
}

function exitPick(msg) {
  if (!pick.active) return;
  if (pick.hold) clearTimeout(pick.hold.timer);
  pick.active = false; pick.hold = null;
  $('#pickOverlay').style.display = 'none';
  ui.sel.clear();
  if (tp.playing) stopTransport();
  autosave(); renderTracks(); draw();
  status(msg || `Pick mode finished — ${pick.done.size}/${pick.ids.length} notes confirmed.`);
}

const pickNote = () => curTrack().notes.find((n) => n.id === pick.ids[pick.i]);

function focusPick() {
  const n = pickNote();
  if (!n) return;
  ui.sel = new Set([n.id]);
  ui.playhead = n.start;
  // keep the current note and the active octave in view
  if (bx(n.start) < KEYW + 40 || bx(n.start + n.dur) > W - 40) ui.scrollX = Math.max(0, n.start - 2);
  const visRows = (H - RULER) / ui.row;
  const [kLo, kHi] = isDrum(curTrack()) ? [36, 56] : [pick.base, pick.base + 17];
  const lo = Math.min(n.pitch, kLo), hi = Math.max(n.pitch, kHi);
  if (hi + 1 > ui.topPitch || lo < ui.topPitch - visRows) ui.topPitch = (lo + hi) / 2 + visRows / 2;
  clampView();
  updatePickOverlay();
  draw();
}

function updatePickOverlay() {
  const n = pickNote(), tr = curTrack(), drum = isDrum(tr);
  const range = drum ? 'drum pads (see keyboard strip)' : `keys A…' = ${noteName(pick.base)}–${noteName(pick.base + 17)}`;
  $('#pickTitle').textContent = n
    ? `Note ${pick.i + 1} / ${pick.ids.length}  ·  ${pick.done.has(n.id) ? '✓ ' : ''}${pitchLabel(tr, n.pitch)}  ·  ${range}  ·  ${pick.done.size} confirmed`
    : '';
  $('#pickHelp').innerHTML = drum
    ? `<b>A</b> kick · <b>S</b> snare · <b>D</b> hat · <b>F</b> open hat · <b>G</b> clap · <b>H J K</b> toms · <b>L</b> crash · <b>;</b> ride · <b>W</b> rim · <b>E</b> pedal hat · <b>T</b> floor tom · <b>Y</b> cowbell · <b>U</b> tambourine<br>
       short press previews · <b>hold</b> to confirm &amp; advance · <b>← / →</b> move · <b>Enter</b> confirm · <b>Space</b> hear the phrase · <b>Esc</b> finish`
    : `<b>A W S E D F T G Y H U J K O L P ; '</b> = piano keys · short press previews · <b>hold</b> to confirm &amp; advance<br>
       <b>Z / X</b> octave · <b>← / →</b> or <b>Backspace</b> move between notes · <b>Enter</b> confirm current · <b>Space</b> hear the phrase · <b>Esc</b> finish`;
}

function pickMove(d) {
  if (pick.hold) { clearTimeout(pick.hold.timer); pick.hold = null; }
  pick.i = clamp(pick.i + d, 0, pick.ids.length - 1);
  focusPick();
}

function pickConfirm() {
  const n = pickNote();
  if (!n) return;
  pick.done.add(n.id);
  pick.flash = performance.now();
  pick.hold = null;
  autosave();
  if (pick.i >= pick.ids.length - 1) { exitPick(`All ${pick.ids.length} notes picked.`); return; }
  pick.i++;
  focusPick();
}

function pickKeyDown(e) {
  e.preventDefault();
  if (e.repeat) return;
  const n = pickNote();
  const code = e.code;
  const drumMode = isDrum(curTrack());
  const isPad = drumMode ? code !== 'Space' && DRUM_KEYS[code] != null : code in PIANO_KEYS;
  if (isPad && !e.ctrlKey && !e.metaKey) {
    if (!n) return;
    const midi = drumMode ? DRUM_KEYS[code] : clamp(pick.base + PIANO_KEYS[code], 0, 127);
    if (pick.hold) clearTimeout(pick.hold.timer); // latest key wins
    n.pitch = midi;
    audition(curTrack(), midi, n.vel);
    const holdMs = Math.max(100, +project.settings.holdMs || 750);
    pick.hold = { code, t0: performance.now(), ms: holdMs, timer: setTimeout(() => { if (pick.hold && pick.hold.code === code) pickConfirm(); }, holdMs) };
    updatePickOverlay(); draw();
    return;
  }
  switch (e.key) {
    case 'z': case 'Z': pick.base = Math.max(0, pick.base - 12); focusPick(); break;
    case 'x': case 'X': pick.base = Math.min(108, pick.base + 12); focusPick(); break;
    case 'ArrowLeft': case 'Backspace': pickMove(-1); break;
    case 'ArrowRight': pickMove(1); break;
    case 'ArrowUp': if (n) { n.pitch = clamp(n.pitch + 1, 0, 127); audition(curTrack(), n.pitch, n.vel); updatePickOverlay(); draw(); } break;
    case 'ArrowDown': if (n) { n.pitch = clamp(n.pitch - 1, 0, 127); audition(curTrack(), n.pitch, n.vel); updatePickOverlay(); draw(); } break;
    case 'Enter': pickConfirm(); break;
    case ' ': { // hear the phrase leading into (and including) the current note
      if (tp.playing) { stopTransport(); focusPick(); break; }
      if (!n) break;
      startTransport(Math.max(0, n.start - 4), false, false, n.start + n.dur);
      break;
    }
    case 'Escape': exitPick(); break;
  }
}
function pickKeyUp(e) {
  if (pick.hold && pick.hold.code === e.code) { clearTimeout(pick.hold.timer); pick.hold = null; }
}

/* ======================= editing ops ======================= */
function edit(fn, msg) {
  const notes = selNotes();
  if (!notes.length) { status('Select some notes first (drag a box, Ctrl+A, or the selection buttons).', true); return; }
  pushUndo();
  fn(notes, curTrack());
  curTrack().notes.sort((a, b) => a.start - b.start);
  autosave(); draw();
  if (msg) status(msg);
}
const grid = () => ui.snap || 0.25;
const snapBeat = (b) => (ui.snap ? Math.round(b / ui.snap) * ui.snap : b);

const ACTIONS = {
  selAll: () => { curTrack().notes.forEach((n) => ui.sel.add(n.id)); draw(); },
  selNone: () => { ui.sel.clear(); draw(); },
  selLoop: () => { ui.sel.clear(); curTrack().notes.forEach((n) => { if (n.start >= ui.loopStart && n.start < ui.loopEnd) ui.sel.add(n.id); }); draw(); },
  selAfter: () => { ui.sel.clear(); curTrack().notes.forEach((n) => { if (n.start >= ui.playhead - 1e-6) ui.sel.add(n.id); }); draw(); },
  'tr-12': () => transpose(-12), 'tr-1': () => transpose(-1), tr1: () => transpose(1), tr12: () => transpose(12),
  nudgeL: () => edit((ns) => { const d = Math.min(grid(), ...ns.map((n) => n.start)); ns.forEach((n) => (n.start -= d)); }),
  nudgeR: () => edit((ns) => ns.forEach((n) => (n.start += grid()))),
  quantize: () => edit((ns) => Core.quantizeNotes(ns, grid(), clamp(+$('#qStrength').value || 0, 0, 100) / 100, $('#qLen').checked), 'Quantized.'),
  lenGrid: () => edit((ns) => ns.forEach((n) => (n.dur = grid()))),
  legato: () => edit((ns, tr) => {
    for (const n of ns) {
      const next = tr.notes.filter((m) => m.start > n.start + 1e-6).reduce((b, m) => Math.min(b, m.start), Infinity);
      if (next < Infinity) n.dur = next - n.start;
    }
  }),
  half: () => stretch(0.5), double: () => stretch(2),
  setVel: () => { const v = clamp(+$('#velVal').value || 96, 1, 127); edit((ns) => ns.forEach((n) => (n.vel = v)), 'Velocity set.'); },
  scaleSnap: () => edit((ns) => ns.forEach((n) => (n.pitch = Core.snapToScale(n.pitch, +project.settings.scaleRoot, project.settings.scale))), 'Snapped to scale.'),
  dup: () => edit((ns, tr) => {
    const s = Math.min(...ns.map((n) => n.start)), e = Math.max(...ns.map((n) => n.start + n.dur));
    const len = ui.snap ? Math.ceil((e - s) / ui.snap - 1e-6) * ui.snap : e - s;
    ui.sel.clear();
    for (const n of ns) { const c = { ...n, id: nid(), start: n.start + len }; tr.notes.push(c); ui.sel.add(c.id); }
  }, 'Duplicated.'),
  del: () => edit((ns, tr) => { tr.notes = tr.notes.filter((n) => !ui.sel.has(n.id)); ui.sel.clear(); }),
  pick: () => {
    if (pick.active) { exitPick(); return; }
    if (tp.playing) stopTransport();
    let ns = selNotes();
    if (!ns.length) ns = curTrack().notes.filter((n) => n.start >= ui.playhead - 1e-6);
    enterPick(ns.map((n) => n.id), ns.length ? ns[0].pitch : 60, true);
  },
};
function transpose(d) { edit((ns) => ns.forEach((n) => (n.pitch = clamp(n.pitch + d, 0, 127)))); const n = selNotes()[0]; if (n) audition(curTrack(), n.pitch, n.vel); }
function stretch(f) {
  edit((ns) => { const s = Math.min(...ns.map((n) => n.start)); ns.forEach((n) => { n.start = s + (n.start - s) * f; n.dur *= f; }); });
}
function copySel() {
  const ns = selNotes();
  if (!ns.length) return;
  const s = Math.min(...ns.map((n) => n.start));
  ui.clipboard = ns.map((n) => ({ ...n, start: n.start - s }));
  status(`Copied ${ns.length} notes.`);
}
function paste(at) {
  if (!ui.clipboard) { status('Clipboard is empty.', true); return; }
  const where = at == null ? ui.playhead : at;
  pushUndo();
  const tr = curTrack();
  ui.sel.clear();
  for (const n of ui.clipboard) { const c = { ...n, id: nid(), start: n.start + where }; tr.notes.push(c); ui.sel.add(c.id); }
  tr.notes.sort((a, b) => a.start - b.start);
  autosave(); draw();
  status(at == null ? 'Pasted at playhead.' : 'Pasted.');
}

/* ---------- right-click context menu ---------- */
const ctxMenu = $('#ctxMenu');
let ctxBeat = 0;
function openCtxMenu(clientX, clientY, beat) {
  ctxBeat = beat;
  const n = ui.sel.size;
  $('#ctxHead').textContent = n ? `${n} note${n > 1 ? 's' : ''} selected` : 'No selection';
  ctxMenu.querySelectorAll('[data-ctx]').forEach((b) => {
    b.disabled = b.dataset.ctx === 'paste' ? !ui.clipboard : !n;
  });
  ctxMenu.style.display = 'block';
  const r = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.min(clientX, window.innerWidth - r.width - 4) + 'px';
  ctxMenu.style.top = Math.min(clientY, window.innerHeight - r.height - 4) + 'px';
}
function closeCtxMenu() { ctxMenu.style.display = 'none'; }
const ctxOpen = () => ctxMenu.style.display === 'block';

$('#roll').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (tp.recording || pick.active) return;
  const { x, y } = pos(e);
  if (y < RULER || x < KEYW) return;
  // right-clicking an unselected note selects just that note
  const hit = hitNote(x, y);
  if (hit && !ui.sel.has(hit.note.id)) { ui.sel = new Set([hit.note.id]); draw(); }
  if (!ui.sel.size && !ui.clipboard) return;
  openCtxMenu(e.clientX, e.clientY, Math.max(0, ui.snap ? Math.floor(xb(x) / ui.snap) * ui.snap : xb(x)));
});
ctxMenu.addEventListener('contextmenu', (e) => e.preventDefault());
ctxMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ctx]');
  if (!b || b.disabled) return;
  closeCtxMenu();
  switch (b.dataset.ctx) {
    case 'copy': copySel(); break;
    case 'cut': copySel(); ACTIONS.del(); break;
    case 'paste': paste(ctxBeat); break;
    case 'dup': ACTIONS.dup(); break;
    case 'del': ACTIONS.del(); break;
    case 'change': ACTIONS.pick(); break;
    case 'tr12': transpose(12); break;
    case 'tr-12': transpose(-12); break;
    case 'quantize': ACTIONS.quantize(); break;
  }
});
window.addEventListener('mousedown', (e) => { if (ctxOpen() && !ctxMenu.contains(e.target)) closeCtxMenu(); }, true);
window.addEventListener('blur', closeCtxMenu);
$('#roll').addEventListener('wheel', closeCtxMenu, { passive: true });

/* ======================= piano roll ======================= */
const cv = $('#roll'), g = cv.getContext('2d');
let KEYW = 46; // widened for drum names on drum layers
const RULER = 24;
const pitchLabel = (tr, p) => (isDrum(tr) ? (DRUMS[p] ? DRUMS[p].name : String(p)) : noteName(p));
function viewDrums() { ui.topPitch = 60; clampView(); }
let W = 0, H = 0;
const PITCH_MIN = 12, PITCH_MAX = 120;

function resize() {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  W = r.width; H = r.height;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  clampView();
  draw();
}
const bx = (b) => KEYW + (b - ui.scrollX) * ui.ppb;
const xb = (x) => (x - KEYW) / ui.ppb + ui.scrollX;
const py = (p) => RULER + (ui.topPitch - (p + 1)) * ui.row; // top of pitch row
const yp = (y) => Math.floor(ui.topPitch - (y - RULER) / ui.row);
const fy = (m) => RULER + (ui.topPitch - m - 0.5) * ui.row; // centre for fractional midi

function clampView() {
  const visRows = (H - RULER) / ui.row;
  ui.topPitch = clamp(ui.topPitch, PITCH_MIN + visRows, PITCH_MAX + 1);
  ui.scrollX = Math.max(0, ui.scrollX);
}

function draw() {
  if (!W) return;
  const bpm = project.bpm, tr = curTrack(), s = project.settings;
  const drumView = isDrum(tr);
  KEYW = drumView ? 96 : 46;
  g.fillStyle = '#15171c'; g.fillRect(0, 0, W, H);

  // pitch rows
  const pTop = Math.ceil(ui.topPitch), pBot = yp(H) - 1;
  for (let p = pTop; p >= pBot; p--) {
    const y = py(p);
    g.fillStyle = drumView ? (DRUMS[p] ? '#1f232c' : '#16181d') : isBlack(p) ? '#181b21' : '#1d2028';
    g.fillRect(KEYW, y, W - KEYW, ui.row);
    if (((p % 12) + 12) % 12 === 0) { g.fillStyle = '#2c3140'; g.fillRect(KEYW, y + ui.row - 1, W - KEYW, 1); }
  }
  // grid
  const b0 = Math.floor(ui.scrollX), b1 = xb(W);
  const sub = ui.snap && ui.snap * ui.ppb >= 6 ? ui.snap : null;
  if (sub) {
    g.fillStyle = '#22262f';
    for (let b = Math.ceil(ui.scrollX / sub) * sub; b < b1; b += sub) g.fillRect(Math.round(bx(b)), RULER, 1, H);
  }
  for (let b = b0; b < b1; b++) {
    g.fillStyle = b % 4 === 0 ? '#3a4050' : '#2a2f3a';
    g.fillRect(Math.round(bx(b)), RULER, 1, H);
  }
  // loop region shade
  if (ui.loop) {
    g.fillStyle = 'rgba(106,168,255,0.06)';
    g.fillRect(bx(ui.loopStart), RULER, (ui.loopEnd - ui.loopStart) * ui.ppb, H);
  }

  // other layers (ghosted)
  for (const t of project.tracks) {
    if (t === tr) continue;
    g.globalAlpha = audible(t) ? 0.28 : 0.12;
    g.fillStyle = t.color;
    for (const n of t.notes) {
      const x = bx(n.start), w = n.dur * ui.ppb;
      if (x > W || x + w < KEYW) continue;
      g.fillRect(x, py(n.pitch) + 2, Math.max(2, w), ui.row - 4);
    }
  }
  g.globalAlpha = 1;

  // whistle trace (selected track's take, or live recording)
  const traceTake = tp.recording && tp.target === tr ? { startBeat: tp.startBeat, bpm: rec.bpm, frames: rec.frames, taps: rec.taps } : tr.take;
  if (ui.showTrace && traceTake) {
    const spb = 60 / traceTake.bpm;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (const f of traceTake.frames) {
      if (!(f.midi > 0) || f.c < s.minClarity) continue;
      const x = bx(traceTake.startBeat + f.t / spb);
      if (x < KEYW || x > W) continue;
      g.fillRect(x - 1, fy(f.midi + s.transpose) - 1, 2, 2);
    }
  }

  // pick mode: highlight the current note's column and the playable key range
  const curPick = pick.active ? pickNote() : null;
  if (curPick) {
    g.fillStyle = 'rgba(255,217,90,0.08)';
    g.fillRect(bx(curPick.start), RULER, Math.max(3, curPick.dur * ui.ppb), H);
    if (!drumView) {
      g.fillStyle = 'rgba(255,217,90,0.05)';
      g.fillRect(KEYW, py(pick.base + 17), W - KEYW, 18 * ui.row);
    }
  }

  // current track notes
  for (const n of tr.notes) {
    const x = bx(n.start), w = Math.max(3, n.dur * ui.ppb), y = py(n.pitch);
    if (x > W || x + w < KEYW) continue;
    const sel = ui.sel.has(n.id);
    const pending = pick.active && pick.ids.includes(n.id) && !pick.done.has(n.id) && n !== curPick;
    g.globalAlpha = pending ? 0.25 : 0.45 + (n.vel / 127) * 0.55;
    g.fillStyle = tr.color;
    g.fillRect(x, y + 1, w, ui.row - 2);
    g.globalAlpha = 1;
    if (pending) { g.setLineDash([3, 3]); g.strokeStyle = tr.color; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 1.5, w - 1, ui.row - 3); g.setLineDash([]); }
    if (n === curPick) {
      if (pick.hold) { // hold-to-confirm progress
        const p = clamp((performance.now() - pick.hold.t0) / pick.hold.ms, 0, 1);
        g.fillStyle = 'rgba(255,217,90,0.85)'; g.fillRect(x, y + 1, w * p, ui.row - 2);
      }
      g.strokeStyle = '#ffd95a'; g.lineWidth = 2; g.strokeRect(x + 1, y + 2, w - 2, ui.row - 4);
    } else if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(x + 0.75, y + 1.75, w - 1.5, ui.row - 3.5); }
    if (w > 28 && ui.row >= 11) {
      g.fillStyle = '#0b1020'; g.font = '10px system-ui'; g.textBaseline = 'middle';
      g.save(); g.beginPath(); g.rect(x, y, w, ui.row); g.clip();
      g.fillText(pitchLabel(tr, n.pitch), x + 3, y + ui.row / 2 + 0.5);
      g.restore();
    }
  }

  // rubber band
  if (drag && drag.mode === 'box') {
    g.strokeStyle = '#6aa8ff'; g.fillStyle = 'rgba(106,168,255,0.12)'; g.lineWidth = 1;
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    g.fillRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
    g.strokeRect(x + 0.5, y + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
  }

  // keys
  for (let p = pTop; p >= pBot; p--) {
    const y = py(p);
    if (drumView) { // drum names + pad key
      const d = DRUMS[p];
      g.fillStyle = d ? '#2b303b' : '#1b1e24';
      g.fillRect(0, y, KEYW, ui.row);
      g.fillStyle = '#15171c'; g.fillRect(0, y + ui.row - 1, KEYW, 1);
      g.font = '10px system-ui'; g.textBaseline = 'middle';
      if (d) {
        g.fillStyle = '#d9dce3'; g.fillText(d.name, 4, y + ui.row / 2 + 0.5);
        g.fillStyle = '#ffd95a'; g.textAlign = 'right';
        g.fillText(keyLabel(d.key), KEYW - 4, y + ui.row / 2 + 0.5);
        g.textAlign = 'left';
      } else if (ui.row >= 12) { g.fillStyle = '#4a5060'; g.fillText(String(p), 4, y + ui.row / 2 + 0.5); }
      continue;
    }
    g.fillStyle = isBlack(p) ? '#2a2d35' : '#d9dce3';
    g.fillRect(0, y, KEYW, ui.row);
    g.fillStyle = '#15171c'; g.fillRect(0, y + ui.row - 1, KEYW, 1);
    if (((p % 12) + 12) % 12 === 0 || ui.row >= 16) {
      g.fillStyle = isBlack(p) ? '#ccc' : '#333'; g.font = '10px system-ui'; g.textBaseline = 'middle';
      g.fillText(noteName(p), 4, y + ui.row / 2 + 0.5);
    }
  }
  // pick mode: computer-key letters on the piano keys
  if (pick.active && !drumView) {
    g.font = 'bold 10px system-ui'; g.textBaseline = 'middle'; g.textAlign = 'right';
    for (let o = 0; o <= 17; o++) {
      const p = pick.base + o;
      if (p > pTop || p < pBot) continue;
      g.fillStyle = isBlack(p) ? '#ffd95a' : '#b07800';
      g.fillText(KEY_LABEL[o], KEYW - 3, py(p) + ui.row / 2 + 0.5);
    }
    g.textAlign = 'left';
  }
  // live pitch marker on the keyboard
  if (!drumView && analyser && live.midi > 0 && live.clarity >= s.minClarity) {
    const m = live.midi + s.transpose;
    g.fillStyle = '#ff5a5a';
    g.beginPath(); g.arc(KEYW - 7, fy(m), 4, 0, Math.PI * 2); g.fill();
  }

  // ruler
  g.fillStyle = '#1d2027'; g.fillRect(0, 0, W, RULER);
  if (ui.loop || drag?.mode === 'loop') {
    g.fillStyle = 'rgba(106,168,255,0.35)';
    g.fillRect(bx(ui.loopStart), 0, (ui.loopEnd - ui.loopStart) * ui.ppb, RULER);
  }
  g.font = '11px system-ui'; g.textBaseline = 'middle';
  const labelEvery = ui.ppb * 4 < 40 ? 4 : 1;
  for (let b = Math.floor(b0 / 4) * 4; b < b1; b += 4) {
    if ((b / 4) % labelEvery) continue;
    const x = bx(b);
    if (x < KEYW - 1) continue;
    g.fillStyle = '#3a4050'; g.fillRect(Math.round(x), 0, 1, RULER);
    g.fillStyle = '#8b92a3'; g.fillText(String(b / 4 + 1), x + 4, RULER / 2);
  }
  // tap ticks
  if (ui.showTrace && traceTake) {
    const spb = 60 / traceTake.bpm;
    g.fillStyle = '#ffd95a';
    for (const tap of traceTake.taps) {
      const x = bx(traceTake.startBeat + (tap.down + (tp.recording ? 0 : s.tapShift / 1000)) / spb);
      if (x >= KEYW && x <= W) g.fillRect(x - 1, RULER - 9, 2, 9);
    }
  }
  g.fillStyle = '#323745'; g.fillRect(0, RULER - 1, W, 1);
  g.fillStyle = '#1d2027'; g.fillRect(0, 0, KEYW, RULER);

  // playhead
  const ph = bx(currentBeat());
  if (ph >= KEYW) {
    g.fillStyle = tp.recording ? '#ff5a5a' : '#ffffff';
    g.fillRect(Math.round(ph), 0, 1.5, H);
  }
}

/* ---------- mouse ---------- */
let drag = null;
function hitNote(x, y) {
  const tr = curTrack(), p = yp(y);
  for (let i = tr.notes.length - 1; i >= 0; i--) {
    const n = tr.notes[i];
    if (n.pitch !== p) continue;
    const x0 = bx(n.start), x1 = x0 + Math.max(3, n.dur * ui.ppb);
    if (x >= x0 && x <= x1) return { note: n, edge: x >= x1 - Math.min(7, (x1 - x0) / 3) };
  }
  return null;
}
function pos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

cv.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || tp.recording) return;
  const { x, y } = pos(e);
  if (y < RULER) {
    if (e.shiftKey) {
      const b = Math.max(0, snapBeat(xb(x)));
      drag = { mode: 'loop', anchor: b };
      ui.loopStart = b; ui.loopEnd = b;
    } else {
      drag = { mode: 'seek' };
      seek(xb(x));
    }
    return;
  }
  if (x < KEYW) { audition(curTrack(), yp(y)); return; }
  if (pick.active) { // in pick mode, clicking a note jumps to it
    const h = hitNote(x, y), idx = h ? pick.ids.indexOf(h.note.id) : -1;
    if (idx >= 0) { pick.i = idx; if (pick.hold) { clearTimeout(pick.hold.timer); pick.hold = null; } focusPick(); }
    return;
  }
  const tr = curTrack(), hit = hitNote(x, y);
  if (hit) {
    const n = hit.note;
    if (e.shiftKey) { ui.sel.has(n.id) ? ui.sel.delete(n.id) : ui.sel.add(n.id); draw(); return; }
    if (!ui.sel.has(n.id)) { ui.sel.clear(); ui.sel.add(n.id); }
    pushUndo();
    let anchorNote = hit.note, dupIds = null;
    if (e.altKey && !hit.edge) { // alt-drag duplicates; drag the copies
      const copies = selNotes().map((m) => {
        const c = { ...m, id: nid() };
        if (m === hit.note) anchorNote = c;
        return c;
      });
      tr.notes.push(...copies);
      ui.sel = new Set(copies.map((c) => c.id));
      dupIds = ui.sel;
    }
    const ns = selNotes();
    drag = {
      mode: hit.edge ? 'resize' : 'move', x0: x, y0: y, moved: false, anchorNote, dupIds,
      orig: new Map(ns.map((m) => [m.id, { start: m.start, dur: m.dur, pitch: m.pitch }])),
      lastPitch: n.pitch,
    };
    if (!hit.edge) audition(tr, n.pitch, n.vel);
    draw();
    return;
  }
  if (!e.shiftKey) ui.sel.clear();
  drag = { mode: 'box', x0: x, y0: y, x1: x, y1: y, base: new Set(ui.sel) };
  draw();
});

window.addEventListener('mousemove', (e) => {
  const { x, y } = pos(e);
  if (!drag) {
    if (e.target === cv) {
      const h = y >= RULER && x >= KEYW ? hitNote(x, y) : null;
      cv.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : y < RULER ? 'pointer' : 'default';
    }
    return;
  }
  if (drag.mode === 'seek') { seek(xb(x)); return; }
  if (drag.mode === 'loop') {
    const b = Math.max(0, snapBeat(xb(x)));
    ui.loopStart = Math.min(drag.anchor, b); ui.loopEnd = Math.max(drag.anchor, b);
    draw(); return;
  }
  if (drag.mode === 'box') {
    drag.x1 = x; drag.y1 = y;
    const bA = xb(Math.min(drag.x0, x)), bB = xb(Math.max(drag.x0, x));
    const pA = yp(Math.max(drag.y0, y)), pB = yp(Math.min(drag.y0, y));
    ui.sel = new Set(drag.base);
    for (const n of curTrack().notes) {
      if (n.pitch >= pA && n.pitch <= pB && n.start < bB && n.start + n.dur > bA) ui.sel.add(n.id);
    }
    draw(); return;
  }
  const dxBeats = (x - drag.x0) / ui.ppb;
  if (Math.abs(x - drag.x0) > 2 || Math.abs(y - drag.y0) > 2) drag.moved = true;
  const a = drag.orig.get(drag.anchorNote.id);
  if (drag.mode === 'move') {
    const dp = Math.round((drag.y0 - y) / ui.row);
    // snap the anchor note's new start to the grid; move everything by the same delta
    let db = ui.snap && !e.ctrlKey ? snapBeat(a.start + dxBeats) - a.start : dxBeats;
    const minStart = Math.min(...[...drag.orig.values()].map((o) => o.start));
    db = Math.max(db, -minStart);
    for (const n of curTrack().notes) {
      const o = drag.orig.get(n.id);
      if (!o) continue;
      n.start = o.start + db;
      n.pitch = clamp(o.pitch + dp, 0, 127);
    }
    const np = drag.anchorNote.pitch;
    if (np !== drag.lastPitch) { drag.lastPitch = np; audition(curTrack(), np, drag.anchorNote.vel); }
  } else if (drag.mode === 'resize') {
    let newEnd = a.start + a.dur + dxBeats;
    if (ui.snap && !e.ctrlKey) newEnd = snapBeat(newEnd);
    const dd = newEnd - (a.start + a.dur);
    const minLen = ui.snap ? Math.min(ui.snap, 0.0625) : 0.03125;
    for (const n of curTrack().notes) {
      const o = drag.orig.get(n.id);
      if (o) n.dur = Math.max(minLen, o.dur + dd);
    }
  }
  draw();
});

window.addEventListener('mouseup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.mode === 'loop') {
    if (ui.loopEnd - ui.loopStart < 0.01) { ui.loopEnd = ui.loopStart + 4; }
    ui.loop = true; updateTransportUI();
  }
  if ((d.mode === 'move' || d.mode === 'resize')) {
    if (!d.moved) { // nothing changed
      if (d.dupIds) { curTrack().notes = curTrack().notes.filter((n) => !d.dupIds.has(n.id)); ui.sel.clear(); }
      if (undoStack.length) undoStack.pop();
    }
    curTrack().notes.sort((a, b) => a.start - b.start);
    autosave();
  }
  draw();
});

cv.addEventListener('dblclick', (e) => {
  if (tp.recording || pick.active) return;
  const { x, y } = pos(e);
  if (y < RULER || x < KEYW) return;
  const hit = hitNote(x, y), tr = curTrack();
  pushUndo();
  if (hit) { // double-click a note deletes it
    tr.notes = tr.notes.filter((n) => n !== hit.note);
    ui.sel.delete(hit.note.id);
  } else {
    const start = Math.max(0, ui.snap ? Math.floor(xb(x) / ui.snap) * ui.snap : xb(x));
    const n = { id: nid(), start, dur: grid(), pitch: yp(y), vel: +project.settings.vel || 96 };
    tr.notes.push(n);
    tr.notes.sort((a, b) => a.start - b.start);
    ui.sel = new Set([n.id]);
    audition(tr, n.pitch, n.vel);
  }
  autosave(); draw();
});

cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const { x, y } = pos(e);
  if (e.ctrlKey && e.shiftKey) {
    const m = ui.topPitch - (y - RULER) / ui.row;
    ui.row = clamp(ui.row * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 6, 32);
    ui.topPitch = m + (y - RULER) / ui.row;
  } else if (e.ctrlKey) {
    const b = xb(x);
    ui.ppb = clamp(ui.ppb * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 8, 600);
    ui.scrollX = b - (x - KEYW) / ui.ppb;
  } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    ui.scrollX += (e.deltaX || e.deltaY) / ui.ppb;
  } else {
    ui.topPitch -= e.deltaY / ui.row / 2;
  }
  clampView(); draw();
}, { passive: false });

function seek(b) {
  b = Math.max(0, ui.snap ? Math.round(b / ui.snap) * ui.snap : b);
  ui.playhead = b;
  if (tp.playing && !tp.recording) startTransport(b, false);
  draw();
}

/* ======================= keyboard ======================= */
const isField = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
window.addEventListener('keydown', (e) => {
  if (ctxOpen()) { // any key closes the menu; Esc only closes it
    closeCtxMenu();
    if (e.key === 'Escape') { e.preventDefault(); return; }
  }
  if (tp.recording) {
    e.preventDefault();
    if (e.key === 'Escape') { stopTransport(); return; }
    onTapDown(e);
    return;
  }
  if (pick.active) { pickKeyDown(e); return; }
  if (isField(e.target) && e.key !== 'Escape') return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); tp.playing ? stopTransport() : startTransport(ui.playhead, false); }
  else if (k === 'Escape') { if (tp.playing) stopTransport(); else ACTIONS.selNone(); }
  else if ((k === 'r' || k === 'R') && !mod) { e.preventDefault(); startRecording(false); }
  else if ((k === 't' || k === 'T') && !mod) { e.preventDefault(); startRecording(true); }
  else if ((k === 'p' || k === 'P') && !mod) { e.preventDefault(); ACTIONS.pick(); }
  else if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && (k === 'y')) { e.preventDefault(); redo(); }
  else if (mod && (k === 'a')) { e.preventDefault(); ACTIONS.selAll(); }
  else if (mod && (k === 'd')) { e.preventDefault(); ACTIONS.dup(); }
  else if (mod && (k === 'c')) { e.preventDefault(); copySel(); }
  else if (mod && (k === 'x')) { e.preventDefault(); copySel(); ACTIONS.del(); }
  else if (mod && (k === 'v')) { e.preventDefault(); paste(); }
  else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (ui.sel.size) ACTIONS.del(); }
  else if (k === 'ArrowUp') { e.preventDefault(); transpose(e.shiftKey ? 12 : 1); }
  else if (k === 'ArrowDown') { e.preventDefault(); transpose(e.shiftKey ? -12 : -1); }
  else if (k === 'ArrowLeft') { e.preventDefault(); ACTIONS.nudgeL(); }
  else if (k === 'ArrowRight') { e.preventDefault(); ACTIONS.nudgeR(); }
  else if ((k === 'q' || k === 'Q') && !mod) ACTIONS.quantize();
  else if (k === 'Home') { seek(0); ui.scrollX = 0; draw(); }
});
// losing focus mid-hold must not confirm a note
window.addEventListener('blur', () => { if (pick.hold) { clearTimeout(pick.hold.timer); pick.hold = null; } });
window.addEventListener('keyup', (e) => {
  if (tp.recording) { e.preventDefault(); onTapUp(e); }
  else if (pick.active) { e.preventDefault(); pickKeyUp(e); }
});

async function startRecording(rhythmOnly) {
  if (tp.recording) { stopTransport(); return; }
  if (pick.active) exitPick();
  if (!rhythmOnly && !analyser && !(await enableMic())) return;
  startTransport(ui.playhead, true, rhythmOnly);
  status(rhythmOnly && isDrum(curTrack()) && project.settings.livePads
    ? `Live drum pads: A kick · S snare · D hat · F open hat · G clap · H/J/K toms · L crash · ; ride (Space = kick). Esc when done.`
    : rhythmOnly && isDrum(curTrack())
    ? `Tapping drum rhythm into "${curTrack().name}" — tap any key on each hit, Esc when done. Then pick each drum.`
    : rhythmOnly
    ? `Tapping rhythm into "${curTrack().name}" — tap any key on each note, Esc when done. Then pick pitches.`
    : `Recording into "${curTrack().name}" — whistle and tap any key on each note. Esc to stop.`);
}

/* ======================= UI wiring ======================= */
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let statusTimer = null;
function status(msg, warn) {
  const el = $('#status');
  el.textContent = msg;
  el.style.color = warn ? '#ffb35a' : '';
}

function renderTracks() {
  const box = $('#tracks');
  const instOpts = Object.entries(INSTRUMENTS).map(([k, v]) => `<option value="${k}">${v.name} (${v.drums ? 'GM ch 10' : 'GM ' + (v.gm + 1)})</option>`).join('');
  box.innerHTML = project.tracks.map((t) => `
    <div class="track ${t.id === project.sel ? 'sel' : ''}" data-id="${t.id}">
      <div class="row"><span class="dot" style="background:${t.color}"></span>
        <input class="name" value="${escapeHtml(t.name)}" data-f="name">
        <button class="small ${t.mute ? 'on' : ''}" data-f="mute" title="Mute">M</button>
        <button class="small ${t.solo ? 'on' : ''}" data-f="solo" title="Solo">S</button>
        <button class="small" data-f="del" title="Delete layer">✕</button></div>
      <div class="row"><select data-f="inst">${instOpts}</select></div>
      <div class="row"><label style="flex:none">Vol</label><input type="range" min="0" max="1" step="0.01" value="${t.vol}" data-f="vol">
        <span style="color:var(--dim);font-size:11px;min-width:56px;text-align:right">${t.notes.length} notes</span></div>
    </div>`).join('');
  box.querySelectorAll('.track').forEach((el) => {
    const t = project.tracks.find((x) => x.id === +el.dataset.id);
    el.querySelector('select').value = t.inst;
  });
  const mv = $('#moveTo');
  mv.innerHTML = '<option value="">Move to…</option>' + project.tracks.filter((t) => t.id !== project.sel).map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

$('#tracks').addEventListener('click', (e) => {
  const el = e.target.closest('.track');
  if (!el) return;
  const t = project.tracks.find((x) => x.id === +el.dataset.id);
  const f = e.target.dataset.f;
  if (f === 'mute' || f === 'solo') { t[f] = !t[f]; applyMix(); renderTracks(); autosave(); draw(); return; }
  if (f === 'del') {
    if (project.tracks.length === 1) { status('A project needs at least one layer.', true); return; }
    if (t.notes.length && !confirm(`Delete layer "${t.name}" (${t.notes.length} notes)?`)) return;
    pushUndo();
    project.tracks = project.tracks.filter((x) => x !== t);
    if (project.sel === t.id) project.sel = project.tracks[0].id;
    ui.sel.clear(); renderTracks(); autosave(); draw(); return;
  }
  if (project.sel !== t.id && !tp.recording) {
    if (pick.active) exitPick();
    project.sel = t.id; ui.sel.clear();
    if (isDrum(t)) viewDrums();
    const keep = document.activeElement;
    renderTracks(); draw();
    // keep focus on the field the user clicked
    if (isField(e.target)) { const nf = $(`.track[data-id="${t.id}"] [data-f="${e.target.dataset.f}"]`); if (nf) nf.focus(); }
    else if (keep && keep.blur) keep.blur();
  }
});
$('#tracks').addEventListener('input', (e) => {
  const el = e.target.closest('.track'); if (!el) return;
  const t = project.tracks.find((x) => x.id === +el.dataset.id), f = e.target.dataset.f;
  if (f === 'vol') { t.vol = +e.target.value; applyMix(); }
  else if (f === 'name') { t.name = e.target.value; }
  else if (f === 'inst') {
    t.inst = e.target.value;
    if (isDrum(t)) { if (t.id === project.sel) viewDrums(); audition(t, 38); } else audition(t, 72);
    draw();
  }
  autosave();
});
$('#tracks').addEventListener('change', (e) => { if (e.target.dataset.f === 'name') renderTracks(); });

$('#addTrack').onclick = () => {
  pushUndo();
  const t = newTrack(null, ['piano', 'bass', 'strings', 'marimba', 'organ', 'guitar'][project.tracks.length % 6]);
  project.tracks.push(t);
  project.sel = t.id;
  ui.sel.clear(); renderTracks(); autosave(); draw();
};
$('#addDrums').onclick = () => {
  pushUndo();
  const t = newTrack('Drums', 'drums');
  project.tracks.push(t);
  project.sel = t.id;
  ui.sel.clear(); viewDrums(); renderTracks(); autosave(); draw();
  status('Drum layer added. Press 🥁 Tap rhythm (T) and play the pads: A kick · S snare · D hat … Turn on Loop to layer passes.');
};
$('#moveTo').onchange = (e) => {
  const dest = project.tracks.find((t) => t.id === +e.target.value);
  e.target.value = '';
  if (!dest) return;
  edit((ns, tr) => {
    tr.notes = tr.notes.filter((n) => !ui.sel.has(n.id));
    dest.notes.push(...ns); dest.notes.sort((a, b) => a.start - b.start);
    ui.sel.clear();
  }, `Moved to "${dest.name}".`);
  renderTracks();
};

document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => ACTIONS[b.dataset.act]()));
// buttons must not keep focus, or Space would re-trigger them instead of play/stop
document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });

// settings bound to project.settings
$('#scaleSel').innerHTML = Object.keys(Core.SCALES).map((k) => `<option value="${k}">${k}</option>`).join('');
document.querySelectorAll('[data-s]').forEach((el) => {
  el.addEventListener('change', () => {
    const k = el.dataset.s;
    project.settings[k] = el.type === 'number' ? +el.value : el.value;
    if (k === 'scaleRoot') { project.settings[k] = +el.value; renderTransposeOptions(); } // relabel "C → E♭"
    autosave(); draw();
  });
});

function renderTransposeOptions() {
  const sel = $('#globalTr');
  let html = '';
  for (let t = -12; t <= 12; t++) html += `<option value="${t}">${t === 0 ? '0  (off)' : trLabel(t)}</option>`;
  sel.innerHTML = html;
  sel.value = String(project.transpose || 0);
  sel.classList.toggle('on', !!project.transpose);
}
function syncControls() {
  renderTransposeOptions();
  $('#bpm').value = project.bpm;
  $('#countIn').value = ui.countIn;
  $('#snap').value = String(ui.snap);
  if ($('#snap').value === '') $('#snap').value = '0.25';
  $('#masterVol').value = ui.masterVol;
  $('#showTrace').checked = ui.showTrace;
  $('#livePads').checked = !!project.settings.livePads;
  document.querySelectorAll('[data-s]').forEach((el) => { el.value = project.settings[el.dataset.s]; });
}

$('#bpm').onchange = (e) => {
  const v = clamp(Math.round(+e.target.value) || 100, 30, 300);
  if (v !== project.bpm) { pushUndo(); project.bpm = v; autosave(); }
  e.target.value = v;
};
$('#globalTr').onchange = (e) => {
  pushUndo();
  project.transpose = clamp(+e.target.value || 0, -12, 12);
  e.target.classList.toggle('on', !!project.transpose);
  autosave();
  status(project.transpose
    ? `Playback and export transposed ${trLabel(project.transpose)}. Notes in the editor stay as written; drums are unaffected.`
    : 'Transpose off.');
  e.target.blur();
};
$('#countIn').onchange = (e) => { ui.countIn = clamp(Math.round(+e.target.value) || 0, 0, 16); e.target.value = ui.countIn; };
$('#snap').onchange = (e) => { ui.snap = +e.target.value; draw(); };
$('#masterVol').oninput = (e) => { ui.masterVol = +e.target.value; if (master) master.gain.value = ui.masterVol; };
$('#showTrace').onchange = (e) => { ui.showTrace = e.target.checked; draw(); };
$('#livePads').onchange = (e) => { project.settings.livePads = e.target.checked; autosave(); };
$('#metroBtn').onclick = () => { ui.metronome = !ui.metronome; updateTransportUI(); };
$('#loopBtn').onclick = () => {
  ui.loop = !ui.loop;
  if (ui.loop && ui.loopEnd <= ui.loopStart) { ui.loopStart = 0; ui.loopEnd = 8; }
  updateTransportUI(); draw();
};
$('#recBtn').onclick = () => startRecording(false);
$('#rhythmBtn').onclick = () => startRecording(true);
$('#playBtn').onclick = () => startTransport(ui.playhead, false);
$('#stopBtn').onclick = () => stopTransport();
$('#micBtn').onclick = () => (analyser ? (disableMic(), status('Mic off.')) : enableMic());
$('#micSel').onchange = () => { if (analyser) enableMic(); };
$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;

$('#realignBtn').onclick = () => {
  const tr = curTrack();
  if (!tr.take) { status('This layer has no recorded take to re-align.', true); return; }
  pushUndo();
  const res = applyTake(tr, tr.take);
  renderTracks();
  status(`Re-aligned: ${res.notes.length} notes` + (res.skipped ? `, ${res.skipped} tap(s) without pitch` : '') + '.');
};

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$('#exportBtn').onclick = () => {
  const tracks = project.tracks.filter((t) => audible(t) && t.notes.length).map((t) => ({
    name: t.name, program: INSTRUMENTS[t.inst].gm, drums: isDrum(t), volume: t.vol,
    notes: t.notes.map((n) => ({ ...n, pitch: soundPitch(t, n.pitch) })), // export at the transposed key
  }));
  if (!tracks.length) { status('Nothing to export — no audible layers with notes.', true); return; }
  const tr = project.transpose || 0;
  const root = +project.settings.scaleRoot || 0;
  const file = tr ? `whistle-melody-${keyName(root + tr).replace('♭', 'b')}.mid` : 'whistle-melody.mid';
  download(file, Core.writeMidi({ bpm: project.bpm, tracks }), 'audio/midi');
  status(`Exported ${tracks.length} layer(s) to ${file}` + (tr ? ` (transposed ${tr > 0 ? '+' : ''}${tr} semitones).` : '.'));
};
$('#saveBtn').onclick = () => download('whistle-project.json', serialize(), 'application/json');
$('#loadBtn').onclick = () => $('#loadFile').click();
$('#loadFile').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    stopTransport();
    pushUndo();
    loadProjectData(JSON.parse(await f.text()));
    silenceAll(); renderTracks(); syncControls(); autosave(); draw();
    status(`Loaded ${f.name}.`);
  } catch (err) { status('Could not load: ' + err.message, true); }
};
$('#newBtn').onclick = () => {
  if (!confirm('Start a new project? (Undo can bring the current one back.)')) return;
  stopTransport(); pushUndo();
  const keep = project.settings;
  newProject(); project.settings = keep;
  ui.sel.clear(); ui.playhead = 0; silenceAll(); renderTracks(); syncControls(); autosave(); draw();
};

function updateTransportUI() {
  $('#recBtn').classList.toggle('on', tp.recording && !tp.rhythmOnly);
  $('#rhythmBtn').classList.toggle('on', tp.recording && tp.rhythmOnly);
  $('#playBtn').classList.toggle('on', tp.playing && !tp.recording);
  $('#loopBtn').classList.toggle('on', ui.loop);
  $('#metroBtn').classList.toggle('on', ui.metronome);
  $('#bpm').disabled = tp.playing;
  $('#recOverlay').style.display = tp.recording ? 'block' : 'none';
  if (!tp.recording) renderTracks();
}

/* ---------- animation loop ---------- */
function frame() {
  // meter + live note
  const lvl = analyser ? clamp(live.rms * 6, 0, 1) : 0;
  $('#meterFill').style.width = (lvl * 100).toFixed(0) + '%';
  const s = project.settings;
  if (analyser && live.midi > 0 && live.clarity >= s.minClarity) {
    const r = Math.round(live.midi), cents = Math.round((live.midi - r) * 100);
    $('#liveNote').textContent = `${noteName(r)} ${cents >= 0 ? '+' : ''}${cents}¢ → ${noteName(Math.round(live.midi + s.transpose))}`;
    $('#liveNote').style.color = '#e4e7ee';
  } else { $('#liveNote').textContent = analyser ? '·' : '—'; $('#liveNote').style.color = ''; }

  if (tp.playing) {
    const b = currentBeat();
    // follow playhead
    if (bx(b) > W - 60 || bx(b) < KEYW) ui.scrollX = Math.max(0, b - 1);
    if (tp.recording) {
      const inCount = b < tp.startBeat;
      $('#recOverlay').textContent = inCount ? `Count-in ${Math.ceil(tp.startBeat - b)}` : `REC  ·  ${rec.taps.length} taps`;
      $('#recOverlay').style.background = performance.now() - flashTap < 90 ? 'rgba(255,217,90,.95)' : 'rgba(255,90,90,.9)';
    } else if (tp.stopAt != null && b >= tp.stopAt + 0.25) { stopTransport(); if (pick.active) focusPick(); }
    else if (!ui.loop && b > songEnd() + 1) stopTransport();
  }
  if (pick.active) {
    const p = pick.hold ? clamp((performance.now() - pick.hold.t0) / pick.hold.ms, 0, 1) : 0;
    const flashing = performance.now() - pick.flash < 150;
    $('#pickFill').style.width = (flashing ? 100 : p * 100).toFixed(0) + '%';
    $('#pickFill').style.background = flashing ? '#5ad19a' : '#ffd95a';
  }
  const b = currentBeat();
  const bar = Math.floor(b / 4) + 1, beat = Math.floor(((b % 4) + 4) % 4) + 1, tick = Math.floor((b % 1) * 100);
  const trTxt = project.transpose ? `   ·   transposed ${trLabel(project.transpose)}` : '';
  $('#pos').textContent = `${bar}.${beat}.${String(Math.max(0, tick)).padStart(2, '0')}   ·   ${project.bpm} BPM${trTxt}   ·   ${curTrack().name}`;
  if (tp.playing || analyser || pick.active) draw();
  requestAnimationFrame(frame);
}

/* ---------- init ---------- */
try {
  const saved = localStorage.getItem('open-daw-project');
  if (saved) { loadProjectData(JSON.parse(saved)); status('Restored your last session.'); }
} catch (e) { /* fresh project */ }
syncControls();
renderTracks();
updateTransportUI();
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe($('#rollWrap'));
resize();
ui.topPitch = 84;
clampView(); draw();
requestAnimationFrame(frame);
