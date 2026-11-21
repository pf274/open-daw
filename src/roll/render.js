/**
 * Canvas renderer for the piano roll. Reads state through toRaw() for speed —
 * rendering never mutates anything except view.KEYW.
 */
import { toRaw } from 'vue';
import { noteName, isBlack, mod12, clamp } from '../core/music.js';
import { DRUMS, DRUM_BANKS, keyLabel } from '../audio/drums.js';
import { slideLinks } from '../core/slides.js';
import { barBeats, countBeats, onBarLine } from '../core/meter.js';
import { hasTremor } from '../core/tremor.js';
import { project, curTrack, isDrum, audible } from '../stores/project.js';
import { ui } from '../stores/ui.js';
import { view, bx, xb, py, yp, fy, RULER, KEYW_NORMAL, KEYW_DRUMS } from '../stores/view.js';
import { transport, tp, currentBeat } from '../engine/transport.js';
import { rec } from '../engine/recorder.js';
import { pick, pickNote, PIANO_KEYS } from '../engine/pick.js';
import { live, isMicOn } from '../engine/mic.js';

const KEY_LABEL = Object.fromEntries(Object.entries(PIANO_KEYS).map(([c, o]) => [o, keyLabel(c)]));
export const pitchLabel = (tr, p) => (isDrum(tr) ? (DRUMS[p] ? DRUMS[p].name : String(p)) : noteName(p));

/** Canvas colours per theme (the CSS tokens in style.css, plus roll-only shades). */
const PALETTES = {
  dark: {
    keySep: '#15171c', bg: '#15171c', rowWhite: '#1d2028', rowBlack: '#181b21', octave: '#2c3140',
    sub: '#22262f', beat: '#2a2f3a', bar: '#3a4050', ruler: '#1d2027', rulerLine: '#323745',
    keyWhite: '#d9dce3', keyBlack: '#2a2d35', keyTextWhite: '#333', keyTextBlack: '#ccc',
    text: '#8b92a3', accent: '#6aa8ff', accentRgb: '106,168,255', gold: '#ffd95a', goldRgb: '255,217,90', goldDim: '#b07800', rec: '#ff5a5a',
    strong: '#fff', trace: 'rgba(255,255,255,0.55)', ink: '#0b1020', inkRgb: '11,16,32',
    drumActive: '#232835', drumOther: '#1c1f27', drumNone: '#16181d',
    padActive: '#2f3542', padOther: '#252933', padNone: '#1b1e24', padText: '#8b92a3', padNum: '#4a5060',
  },
  light: {
    keySep: '#c9ceda', bg: '#f3f4f7', rowWhite: '#ffffff', rowBlack: '#eef0f4', octave: '#c9ceda',
    sub: '#eceef3', beat: '#dde1e8', bar: '#b8bfcc', ruler: '#ffffff', rulerLine: '#d0d5df',
    keyWhite: '#ffffff', keyBlack: '#3a3f4b', keyTextWhite: '#444', keyTextBlack: '#ddd',
    text: '#5c6476', accent: '#2f6fd6', accentRgb: '47,111,214', gold: '#a86f00', goldRgb: '214,150,0', goldDim: '#a86f00', rec: '#d93636',
    strong: '#1c2130', trace: 'rgba(28,33,48,0.5)', ink: '#0b1020', inkRgb: '11,16,32',
    drumActive: '#ffffff', drumOther: '#f3f4f7', drumNone: '#e9ecf2',
    padActive: '#dfe6f3', padOther: '#e9ecf2', padNone: '#f3f4f7', padText: '#5c6476', padNum: '#a0a7b5',
  },
};
let C = PALETTES.dark;

export function renderRoll(g) {
  const { W, H } = view;
  if (!W) return;
  const P = toRaw(project), U = toRaw(ui), s = P.settings;
  C = PALETTES[U.themeResolved] || PALETTES.dark;
  const tr = toRaw(curTrack());
  const drumView = isDrum(tr);
  view.KEYW = drumView ? KEYW_DRUMS : KEYW_NORMAL;
  const KEYW = view.KEYW;

  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);

  /* rows */
  const pTop = Math.ceil(U.topPitch), pBot = yp(H) - 1;
  for (let p = pTop; p >= pBot; p--) {
    const y = py(p);
    g.fillStyle = drumView ? (DRUMS[p] ? (DRUMS[p].bank === U.drumBank ? C.drumActive : C.drumOther) : C.drumNone) : isBlack(p) ? C.rowBlack : C.rowWhite;
    g.fillRect(KEYW, y, W - KEYW, U.row);
    if (!drumView && mod12(p) === 0) { g.fillStyle = C.octave; g.fillRect(KEYW, y + U.row - 1, W - KEYW, 1); }
  }

  /* grid */
  const b0 = Math.floor(U.scrollX), b1 = xb(W);
  const sub = U.snap && U.snap * U.ppb >= 6 ? U.snap : null;
  if (sub) {
    g.fillStyle = C.sub;
    for (let b = Math.ceil(U.scrollX / sub) * sub; b < b1; b += sub) g.fillRect(Math.round(bx(b)), RULER, 1, H);
  }
  const ts = P.timeSig, step = countBeats(ts); // a line per counted beat, stronger on bar lines
  for (let b = Math.floor(b0 / step) * step; b < b1; b += step) {
    g.fillStyle = onBarLine(b, ts) ? C.bar : C.beat;
    g.fillRect(Math.round(bx(b)), RULER, 1, H);
  }
  if (U.loop) {
    g.fillStyle = `rgba(${C.accentRgb},0.06)`;
    g.fillRect(bx(U.loopStart), RULER, (U.loopEnd - U.loopStart) * U.ppb, H);
  }

  /* other layers, ghosted */
  for (const t of P.tracks) {
    if (t === tr) continue;
    const alpha = audible(t) ? 0.28 : 0.12;
    g.globalAlpha = alpha;
    g.fillStyle = t.color;
    for (const n of t.notes) {
      const x = bx(n.start), w = n.dur * U.ppb;
      if (x > W || x + w < KEYW) continue;
      g.fillRect(x, py(n.pitch) + 2, Math.max(2, w), U.row - 4);
    }
    if (!isDrum(t)) drawSlides(g, t, alpha, 1.5);
  }
  g.globalAlpha = 1;

  /* whistle trace (selected layer's take, or the live recording) */
  const traceTake = transport.recording && toRaw(tp.target) === tr
    ? { startBeat: tp.startBeat, bpm: rec.bpm, frames: rec.frames, taps: rec.taps }
    : tr.take;
  if (U.showTrace && traceTake) {
    const spb = 60 / traceTake.bpm;
    g.fillStyle = C.trace;
    for (const f of traceTake.frames) {
      if (!(f.midi > 0) || f.c < s.minClarity) continue;
      const x = bx(traceTake.startBeat + f.t / spb);
      if (x < KEYW || x > W) continue;
      g.fillRect(x - 1, fy(f.midi + s.transpose) - 1, 2, 2);
    }
  }

  /* pick mode highlights */
  const curPick = pick.active ? toRaw(pickNote()) : null;
  if (curPick) {
    g.fillStyle = `rgba(${C.goldRgb},0.08)`;
    g.fillRect(bx(curPick.start), RULER, Math.max(3, curPick.dur * U.ppb), H);
    if (!drumView) {
      g.fillStyle = `rgba(${C.goldRgb},0.05)`;
      g.fillRect(KEYW, py(pick.base + 17), W - KEYW, 18 * U.row);
    }
  }

  /* current layer's notes */
  const pickIds = pick.active ? new Set(pick.ids) : null;
  for (const n of tr.notes) {
    const x = bx(n.start), w = Math.max(3, n.dur * U.ppb), y = py(n.pitch);
    if (x > W || x + w < KEYW) continue;
    const pending = pickIds && pickIds.has(n.id) && !pick.done.has(n.id) && n !== curPick;
    g.globalAlpha = pending ? 0.25 : 0.45 + (n.vel / 127) * 0.55;
    g.fillStyle = tr.color;
    g.fillRect(x, y + 1, w, U.row - 2);
    g.globalAlpha = 1;
    if (pending) {
      g.setLineDash([3, 3]); g.strokeStyle = tr.color; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 1.5, w - 1, U.row - 3);
      g.setLineDash([]);
    }
    if (n === curPick) {
      if (pick.hold) { // hold-to-confirm progress
        const p = clamp((performance.now() - pick.hold.t0) / pick.hold.ms, 0, 1);
        g.fillStyle = `rgba(${C.goldRgb},0.85)`;
        g.fillRect(x, y + 1, w * p, U.row - 2);
      }
      g.strokeStyle = C.gold; g.lineWidth = 2;
      g.strokeRect(x + 1, y + 2, w - 2, U.row - 4);
    } else if (U.sel.has(n.id)) {
      g.strokeStyle = C.strong; g.lineWidth = 1.5;
      g.strokeRect(x + 0.75, y + 1.75, w - 1.5, U.row - 3.5);
    }
    if (hasTremor(n)) drawTremor(g, n, x, w, y, U, 60 / P.bpm);
    if (w > 28 && U.row >= 11) {
      g.save();
      g.beginPath(); g.rect(x, y, w, U.row); g.clip();
      g.fillStyle = C.ink; g.font = '10px system-ui'; g.textBaseline = 'middle';
      g.fillText(pitchLabel(tr, n.pitch), x + 3, y + U.row / 2 + 0.5);
      g.restore();
    }
  }

  if (!drumView) drawSlides(g, tr, 1, 2.5);

  /* rubber band */
  const d = view.drag;
  if (d && d.mode === 'box') {
    const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
    g.fillStyle = `rgba(${C.accentRgb},0.12)`; g.fillRect(x, y, w, h);
    g.strokeStyle = C.accent; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w, h);
  }

  drawKeys(g, { pTop, pBot, drumView, U, s });
  drawRuler(g, { b0, b1, U, s, traceTake });

  /* playhead */
  const ph = bx(currentBeat());
  if (ph >= KEYW) {
    g.fillStyle = transport.recording ? C.rec : C.strong;
    g.fillRect(Math.round(ph), 0, 1.5, H);
  }
}

/**
 * Tremor: a horizontal zig-zag through the note. Height follows strength (±100¢ fills the row),
 * spacing follows frequency (one zig-zag per wobble at the current tempo and zoom).
 */
function drawTremor(g, n, x, w, y, U, spb) {
  const cy = y + U.row / 2;
  const amp = Math.max(1.5, (clamp(n.tremor.depth, 0, 100) / 100) * (U.row / 2 - 2));
  const half = Math.max(2, U.ppb / (n.tremor.rate * spb) / 2); // pixels per half-wobble
  g.save();
  g.beginPath(); g.rect(x, y + 1, w, U.row - 2); g.clip();
  g.beginPath();
  g.moveTo(x, cy);
  let up = true;
  for (let px = x + half / 2; px < x + w + half; px += half, up = !up) g.lineTo(px, up ? cy - amp : cy + amp);
  g.strokeStyle = `rgba(${C.inkRgb},0.75)`;
  g.lineWidth = 1.25;
  g.lineJoin = 'miter';
  g.stroke();
  g.restore();
}

/** Slide links: a line from the end of each note into the start of the note it glides to. */
function drawSlides(g, t, alpha, width) {
  const { next } = slideLinks(t.notes);
  if (!next.size) return;
  const half = ui.row / 2, { W, KEYW } = view;
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = t.color;
  g.fillStyle = t.color;
  g.lineWidth = width;
  g.lineCap = 'round';
  for (const a of t.notes) {
    const b = next.get(a.id);
    if (!b) continue;
    let x1 = bx(a.start + a.dur);
    const x2 = bx(b.start);
    if (Math.max(x1, x2) < KEYW || Math.min(x1, x2) > W) continue;
    if (x2 - x1 < 12) x1 = Math.max(bx(a.start) + 2, x2 - 12); // back-to-back: start the line inside the note
    const y1 = py(a.pitch) + half, y2 = py(b.pitch) + half;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    g.beginPath(); g.arc(x1, y1, width * 1.2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x2, y2, width * 1.2, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

function drawKeys(g, { pTop, pBot, drumView, U, s }) {
  const KEYW = view.KEYW;
  g.font = '10px system-ui';
  g.textBaseline = 'middle';
  for (let p = pTop; p >= pBot; p--) {
    const y = py(p), cy = y + U.row / 2 + 0.5;
    if (drumView) {
      const d = DRUMS[p], active = d && d.bank === U.drumBank;
      g.fillStyle = d ? (active ? C.padActive : C.padOther) : C.padNone;
      g.fillRect(0, y, KEYW, U.row);
      g.fillStyle = C.keySep; g.fillRect(0, y + U.row - 1, KEYW, 1);
      if (d) {
        g.fillStyle = active ? C.strong : C.padText; g.fillText(d.name, 4, cy);
        if (active) { g.fillStyle = C.gold; g.textAlign = 'right'; g.fillText(keyLabel(d.key), KEYW - 4, cy); g.textAlign = 'left'; }
      } else if (U.row >= 12) { g.fillStyle = C.padNum; g.fillText(String(p), 4, cy); }
      continue;
    }
    g.fillStyle = isBlack(p) ? C.keyBlack : C.keyWhite;
    g.fillRect(0, y, KEYW, U.row);
    g.fillStyle = C.keySep; g.fillRect(0, y + U.row - 1, KEYW, 1);
    if (mod12(p) === 0 || U.row >= 16) {
      g.fillStyle = isBlack(p) ? C.keyTextBlack : C.keyTextWhite;
      g.fillText(noteName(p), 4, cy);
    }
  }
  // pick mode: computer-key letters on the piano keys
  if (pick.active && !drumView) {
    g.font = 'bold 10px system-ui'; g.textAlign = 'right';
    for (let o = 0; o <= 17; o++) {
      const p = pick.base + o;
      if (p > pTop || p < pBot) continue;
      g.fillStyle = isBlack(p) ? PALETTES.dark.gold : C.goldDim;
      g.fillText(KEY_LABEL[o], KEYW - 3, py(p) + U.row / 2 + 0.5);
    }
    g.textAlign = 'left';
  }
  // live pitch marker
  if (!drumView && isMicOn() && live.midi > 0 && live.clarity >= s.minClarity) {
    g.fillStyle = C.rec;
    g.beginPath(); g.arc(KEYW - 7, fy(live.midi + s.transpose), 4, 0, Math.PI * 2); g.fill();
  }
}

function drawRuler(g, { b0, b1, U, s, traceTake }) {
  const P = toRaw(project);
  const { W } = view, KEYW = view.KEYW;
  g.fillStyle = C.ruler; g.fillRect(0, 0, W, RULER);
  if (U.loop || view.drag?.mode === 'loop') {
    g.fillStyle = `rgba(${C.accentRgb},0.35)`;
    g.fillRect(bx(U.loopStart), 0, (U.loopEnd - U.loopStart) * U.ppb, RULER);
  }
  g.font = '11px system-ui'; g.textBaseline = 'middle';
  const bar = barBeats(P.timeSig);
  const labelEvery = U.ppb * bar < 40 ? 4 : 1; // when zoomed out, label every 4th bar
  for (let i = Math.max(0, Math.floor(b0 / bar)); i * bar < b1; i++) {
    if (i % labelEvery) continue;
    const x = bx(i * bar);
    if (x < KEYW - 1) continue;
    g.fillStyle = C.bar; g.fillRect(Math.round(x), 0, 1, RULER);
    g.fillStyle = C.text; g.fillText(String(i + 1), x + 4, RULER / 2);
  }
  if (U.showTrace && traceTake) { // tap ticks
    const spb = 60 / traceTake.bpm;
    g.fillStyle = C.gold;
    for (const tap of traceTake.taps) {
      const x = bx(traceTake.startBeat + (tap.down + (transport.recording ? 0 : s.tapShift / 1000)) / spb);
      if (x >= KEYW && x <= W) g.fillRect(x - 1, RULER - 9, 2, 9);
    }
  }
  g.fillStyle = C.rulerLine; g.fillRect(0, RULER - 1, W, 1);
  g.fillStyle = C.ruler; g.fillRect(0, 0, KEYW, RULER);
  if (isDrum(toRaw(curTrack()))) { // which pad bank the keys play (Z / X switch it)
    g.fillStyle = C.gold; g.font = 'bold 10px system-ui'; g.textBaseline = 'middle';
    g.fillText(`Bank ${U.drumBank + 1}: ${DRUM_BANKS[U.drumBank].name}`, 4, RULER / 2);
  }
}
