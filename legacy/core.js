/* Pure logic: pitch detection, take->note alignment, scales, quantize, MIDI writer.
   Works in the browser (window.Core) and in node (module.exports) for tests. */
(function (root) {
  'use strict';
  const Core = {};

  Core.midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  Core.freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

  /* ---------- YIN pitch detection (tuned for whistling: ~400-4500 Hz) ---------- */
  Core.detectPitch = function (buf, sr, opts) {
    opts = opts || {};
    const minF = opts.minFreq || 400, maxF = opts.maxFreq || 4500;
    const thr = opts.threshold || 0.15, minRms = opts.minRms == null ? 0.008 : opts.minRms;
    const N = buf.length, W = N >> 1;
    let s = 0;
    for (let i = 0; i < N; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / N);
    const none = { freq: 0, clarity: 0, rms };
    if (rms < minRms) return none;

    const tauMin = Math.max(2, Math.floor(sr / maxF));
    const tauMax = Math.min(W - 2, Math.ceil(sr / minF));
    const cmnd = new Float32Array(tauMax + 2);
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let d = 0;
      for (let j = 0; j < W; j++) {
        const x = buf[j] - buf[j + tau];
        d += x * x;
      }
      running += d;
      cmnd[tau] = running > 0 ? (d * tau) / running : 1;
    }
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (cmnd[t] < thr) {
        while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return none;
    // parabolic interpolation
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
    const den = a - 2 * b + c;
    const shift = den !== 0 ? (a - c) / (2 * den) : 0;
    const refined = tau + Math.max(-1, Math.min(1, shift));
    return { freq: sr / refined, clarity: 1 - b, rms };
  };

  /* ---------- scales ---------- */
  Core.SCALES = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    'major pentatonic': [0, 2, 4, 7, 9],
    'minor pentatonic': [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
  };

  /** Snap a (fractional) midi value to the nearest in-scale integer note. */
  Core.snapToScale = function (m, root, scaleName) {
    const sc = Core.SCALES[scaleName] || Core.SCALES.chromatic;
    let best = Math.round(m), bestD = Infinity;
    const base = Math.round(m);
    for (let n = base - 7; n <= base + 7; n++) {
      const pc = (((n - root) % 12) + 12) % 12;
      if (sc.indexOf(pc) < 0) continue;
      const d = Math.abs(n - m);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  };

  const median = (arr) => {
    const a = arr.slice().sort((x, y) => x - y);
    const n = a.length;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  };
  Core.median = median;

  /* ---------- alignment ----------
     take: { bpm, startBeat, endT, frames:[{t,midi,c}], taps:[{down,up}] }   (times in seconds, 0 = startBeat)
     returns { notes:[{start,dur,pitch,vel}], skipped } (start/dur in beats) */
  /** Note slots from taps: [{t, end, prevT, nextT}] in seconds (shared by whistle + rhythm modes). */
  Core.tapSlots = function (take, s) {
    const taps = take.taps.slice().sort((a, b) => a.down - b.down);
    const shift = (s.tapShift || 0) / 1000;
    const downs = taps.map((t) => t.down + shift);
    const spb = 60 / take.bpm;
    return taps.map((tap, i) => {
      const t = downs[i];
      const nextT = i + 1 < taps.length ? downs[i + 1] : Infinity;
      const prevT = i > 0 ? downs[i - 1] : -Infinity;
      let end;
      const up = tap.up != null ? tap.up + shift : null;
      if (s.durMode === 'fixed') end = t + s.fixedBeats * spb;
      else if (s.durMode === 'hold') end = up != null ? up : Math.min(nextT, take.endT);
      else end = nextT < Infinity ? nextT - (s.gapMs || 0) / 1000 : (up != null ? up : take.endT);
      end = Math.max(end, t + 0.05);
      if (s.durMode === 'hold' && nextT < Infinity) end = Math.min(end, nextT);
      return { t, end, prevT, nextT };
    });
  };

  /** Rhythm only: [{start, dur}] in beats. */
  Core.rhythmFromTaps = function (take, s) {
    const spb = 60 / take.bpm;
    return Core.tapSlots(take, s).map(({ t, end }) => ({
      start: take.startBeat + t / spb,
      dur: Math.max(0.0625, (end - t) / spb),
    }));
  };

  Core.alignTake = function (take, s) {
    const notes = [];
    let skipped = 0;
    const spb = 60 / take.bpm;
    const voiced = take.frames.filter((f) => f.midi > 0 && f.c >= s.minClarity);

    for (const { t, end, prevT, nextT } of Core.tapSlots(take, s)) {

      // pitch window
      const wStart = Math.max(t + s.winStart / 1000, prevT === -Infinity ? -Infinity : (prevT + t) / 2);
      const wEnd = Math.min(t + s.winLen / 1000, nextT === Infinity ? Infinity : nextT);
      let sel = voiced.filter((f) => f.t >= wStart && f.t <= wEnd);
      if (!sel.length) {
        // fall back to nearest voiced frame within 400 ms
        let best = null, bd = 0.4;
        for (const f of voiced) {
          const d = Math.abs(f.t - t);
          if (d < bd) { bd = d; best = f; }
        }
        if (best) sel = [best];
      }
      if (!sel.length) { skipped++; continue; }
      let m = median(sel.map((f) => f.midi)) + (s.transpose || 0);
      m = Core.snapToScale(m, s.scaleRoot || 0, s.scale || 'chromatic');
      m = Math.max(0, Math.min(127, m));
      notes.push({
        start: take.startBeat + t / spb,
        dur: Math.max(0.0625, (end - t) / spb),
        pitch: m,
        vel: s.vel || 96,
      });
    }
    return { notes, skipped };
  };

  /* ---------- quantize ---------- */
  Core.quantizeNotes = function (notes, grid, strength, lengths) {
    if (!grid) return;
    for (const n of notes) {
      const qs = Math.round(n.start / grid) * grid;
      const end = n.start + n.dur;
      n.start = n.start + (qs - n.start) * strength;
      if (lengths) {
        const qe = Math.round(end / grid) * grid;
        const ne = end + (qe - end) * strength;
        n.dur = Math.max(grid, ne - n.start);
      }
    }
  };

  /* ---------- MIDI writer (SMF format 1) ----------
     song: { bpm, tracks:[{name, program, volume(0-1), notes:[{start,dur,pitch,vel}]}] } */
  const vlq = (n) => {
    const out = [n & 0x7f];
    while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
    return out;
  };
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = (n) => [(n >> 8) & 255, n & 255];
  const str = (s) => Array.from(s).map((c) => c.charCodeAt(0) & 127);

  function chunk(tag, bytes) {
    return [...str(tag), ...u32(bytes.length), ...bytes];
  }
  function trackBytes(events) {
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const out = [];
    let last = 0;
    for (const e of events) {
      out.push(...vlq(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    out.push(0, 0xff, 0x2f, 0);
    return out;
  }

  Core.writeMidi = function (song, ppq) {
    ppq = ppq || 480;
    const meta = [];
    const mpqn = Math.round(60000000 / song.bpm);
    meta.push({ tick: 0, order: 0, bytes: [0xff, 0x51, 3, (mpqn >> 16) & 255, (mpqn >> 8) & 255, mpqn & 255] });
    meta.push({ tick: 0, order: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] });
    const nm = str('Whistle MIDI');
    meta.push({ tick: 0, order: 0, bytes: [0xff, 0x03, nm.length, ...nm] });
    const chunks = [chunk('MTrk', trackBytes(meta))];

    let ch = 0;
    for (const tr of song.tracks) {
      let c;
      if (tr.drums) c = 9; // GM percussion channel (channel 10)
      else {
        if (ch % 16 === 9) ch++; // keep the drum channel free for melodic layers
        c = ch++ % 16;
      }
      const ev = [];
      const name = str(tr.name || 'Layer');
      ev.push({ tick: 0, order: 0, bytes: [0xff, 0x03, name.length, ...name] });
      ev.push({ tick: 0, order: 1, bytes: [0xb0 | c, 7, Math.round(Math.max(0, Math.min(1, tr.volume == null ? 0.8 : tr.volume)) * 127)] });
      if (!tr.drums) ev.push({ tick: 0, order: 1, bytes: [0xc0 | c, (tr.program || 0) & 127] });
      for (const n of tr.notes) {
        const on = Math.max(0, Math.round(n.start * ppq));
        const off = Math.max(on + 1, Math.round((n.start + n.dur) * ppq));
        const p = Math.max(0, Math.min(127, Math.round(n.pitch)));
        const v = Math.max(1, Math.min(127, Math.round(n.vel || 96)));
        ev.push({ tick: on, order: 2, bytes: [0x90 | c, p, v] });
        ev.push({ tick: off, order: 0, bytes: [0x80 | c, p, 0] });
      }
      chunks.push(chunk('MTrk', trackBytes(ev)));
    }
    const header = chunk('MThd', [...u16(1), ...u16(chunks.length), ...u16(ppq)]);
    return new Uint8Array([...header, ...chunks.flat()]);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
