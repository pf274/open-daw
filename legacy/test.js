// node test.js — synthesizes a whistled melody + taps and checks the pipeline.
const Core = require('./core.js');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  ', m); };

// pitch detection on pure tones
const sr = 48000;
for (const midi of [72, 79, 84, 91, 96]) {
  const f = Core.midiToFreq(midi), buf = new Float32Array(2048);
  for (let i = 0; i < buf.length; i++) buf[i] = 0.3 * Math.sin(2 * Math.PI * f * i / sr) + 0.01 * (Math.random() - 0.5);
  const r = Core.detectPitch(buf, sr);
  assert(Math.abs(Core.freqToMidi(r.freq) - midi) < 0.1, `detect midi ${midi} -> ${Core.freqToMidi(r.freq).toFixed(2)}`);
}
assert(Core.detectPitch(new Float32Array(2048), sr).freq === 0, 'silence is unvoiced');

// synth a melody: whistle starts ~30ms before each tap, slightly sharp/flat, with vibrato
const melody = [76, 74, 72, 74, 76, 76, 76, 79];
const tapTimes = melody.map((_, i) => 0.5 * i + (Math.random() - 0.5) * 0.04);
const total = 4.3, audio = new Float32Array(Math.ceil(total * sr));
let phase = 0;
for (let i = 0; i < audio.length; i++) {
  const t = i / sr;
  let k = -1;
  for (let j = 0; j < tapTimes.length; j++) if (t >= tapTimes[j] - 0.03) k = j;
  if (k < 0) continue;
  const gapEnd = (k + 1 < tapTimes.length ? tapTimes[k + 1] - 0.03 : total) - 0.04; // brief breath between notes
  if (t > gapEnd) continue;
  const m = melody[k] + 0.25 * Math.sin(2 * Math.PI * 5 * t) + (k % 2 ? 0.15 : -0.15);
  phase += 2 * Math.PI * Core.midiToFreq(m) / sr;
  audio[i] = 0.2 * Math.sin(phase);
}
const frames = [];
for (let s = 0; s + 2048 <= audio.length; s += 480) {
  const r = Core.detectPitch(audio.subarray(s, s + 2048), sr);
  frames.push({ t: (s + 1024) / sr, midi: r.freq ? Core.freqToMidi(r.freq) : 0, c: r.clarity });
}
const take = { bpm: 120, startBeat: 4, endT: total, frames, taps: tapTimes.map((d) => ({ down: d, up: d + 0.08 })) };
const settings = { winStart: -50, winLen: 300, tapShift: 0, durMode: 'legato', fixedBeats: 0.5, gapMs: 20, transpose: -12, scaleRoot: 0, scale: 'chromatic', minClarity: 0.7, vel: 96 };
const { notes, skipped } = Core.alignTake(take, settings);
assert(skipped === 0, 'no skipped taps');
assert(JSON.stringify(notes.map((n) => n.pitch)) === JSON.stringify(melody.map((m) => m - 12)), 'pitches: ' + notes.map((n) => n.pitch).join(','));
assert(Math.abs(notes[2].start - (4 + tapTimes[2] * 2)) < 1e-9, 'start beat mapping');
assert(Math.abs(notes[0].dur - ((tapTimes[1] - tapTimes[0] - 0.02) * 2)) < 1e-6, 'legato duration');
const held = Core.alignTake(take, { ...settings, durMode: 'hold' }).notes;
assert(Math.abs(held[0].dur - 0.16) < 1e-6, 'hold duration');
assert(Core.snapToScale(73.4, 0, 'major') === 74 && Core.snapToScale(73.4, 0, 'chromatic') === 73, 'scale snap');

// quantize
const q = [{ start: 1.1, dur: 0.4 }];
Core.quantizeNotes(q, 0.5, 1, true);
assert(Math.abs(q[0].start - 1) < 1e-9 && Math.abs(q[0].dur - 0.5) < 1e-9, 'quantize');

// MIDI round trip
const bytes = Core.writeMidi({ bpm: 120, tracks: [{ name: 'Lead', program: 73, volume: 1, notes }, { name: 'B', program: 33, notes: [] }] });
function parse(b) {
  let p = 0;
  const rd = (n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p++]; return v; };
  const tag = () => String.fromCharCode(...b.slice(p, (p += 4)));
  assert(tag() === 'MThd', 'header tag'); rd(4);
  const fmt = rd(2), nt = rd(2), ppq = rd(2);
  const tracks = [];
  for (let t = 0; t < nt; t++) {
    assert(tag() === 'MTrk', 'track tag ' + t);
    const end = rd(4) + p, ev = [];
    let tick = 0, status = 0;
    while (p < end) {
      let d = 0, c; do { c = b[p++]; d = (d << 7) | (c & 127); } while (c & 128);
      tick += d; status = b[p++];
      if (status === 0xff) { const type = b[p++], len = b[p++]; ev.push({ tick, meta: type, data: b.slice(p, p + len) }); p += len; }
      else if ((status & 0xf0) === 0xc0) ev.push({ tick, status, d1: b[p++] });
      else ev.push({ tick, status, d1: b[p++], d2: b[p++] });
    }
    tracks.push(ev);
  }
  return { fmt, ppq, tracks };
}
const m = parse(bytes);
assert(m.fmt === 1 && m.tracks.length === 3 && m.ppq === 480, 'format 1, 3 tracks');
const ons = m.tracks[1].filter((e) => (e.status & 0xf0) === 0x90);
assert(ons.length === melody.length && ons[0].d1 === 64, 'note-ons written');
assert(m.tracks[1].some((e) => (e.status & 0xf0) === 0xc0 && e.d1 === 73), 'program change');

// rhythm-only slots
const rh = Core.rhythmFromTaps({ bpm: 120, startBeat: 2, endT: 2, taps: [{ down: 0, up: 0.1 }, { down: 0.5, up: 0.6 }, { down: 1, up: 1.9 }] }, settings);
assert(rh.length === 3 && rh[1].start === 3 && Math.abs(rh[0].dur - 0.96) < 1e-9 && Math.abs(rh[2].dur - 1.8) < 1e-9, 'rhythm slots');

// drum layer goes to channel 10 (index 9) with no program change; melodic layers skip channel 9
const dm = parse(Core.writeMidi({ bpm: 100, tracks: [{ name: 'Drums', drums: true, notes: [{ start: 0, dur: 0.25, pitch: 36, vel: 100 }] },
  ...Array.from({ length: 10 }, (_, i) => ({ name: 'M' + i, program: 0, notes: [{ start: 0, dur: 1, pitch: 60, vel: 90 }] }))] }));
const drumOn = dm.tracks[1].find((e) => (e.status & 0xf0) === 0x90);
assert(drumOn.status === 0x99 && drumOn.d1 === 36, 'drum note on channel 10');
assert(!dm.tracks[1].some((e) => (e.status & 0xf0) === 0xc0), 'no program change on drum track');
const melodicChans = dm.tracks.slice(2).map((t) => t.find((e) => (e.status & 0xf0) === 0x90).status & 15);
assert(!melodicChans.includes(9), 'melodic layers avoid channel 10: ' + melodicChans.join(','));
