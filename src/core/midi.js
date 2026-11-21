/**
 * Standard MIDI File writer (format 1).
 * song: { bpm, timeSig?: { num, den }, tracks:[{ name, program, drums?, volume(0-1), reverb?(0-1), notes:[{start,dur,pitch,vel}] }] }
 * `reverb` / `chorus` (0–1) are written as CC91 / CC93 (General MIDI reverb / chorus depth) when above 0.
 * Drum tracks go on channel 10 (index 9); melodic tracks skip it.
 */
const vlq = (n) => {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
const str = (s) => Array.from(s).map((c) => c.charCodeAt(0) & 127);
const chunk = (tag, bytes) => [...str(tag), ...u32(bytes.length), ...bytes];

function trackBytes(events) {
  // note-offs (order 0) before control (1) before note-ons (2) at the same tick
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

export function writeMidi(song, ppq = 480) {
  const mpqn = Math.round(60000000 / song.bpm);
  const ts = song.timeSig || { num: 4, den: 4 };
  const title = str('Whistle MIDI');
  const meta = [
    { tick: 0, order: 0, bytes: [0xff, 0x51, 3, (mpqn >> 16) & 255, (mpqn >> 8) & 255, mpqn & 255] },
    // time signature: numerator, log2(denominator), 24 MIDI clocks per click, 8 32nds per quarter
    { tick: 0, order: 0, bytes: [0xff, 0x58, 4, ts.num, Math.round(Math.log2(ts.den)), 24, 8] },
    { tick: 0, order: 0, bytes: [0xff, 0x03, title.length, ...title] },
  ];
  const chunks = [chunk('MTrk', trackBytes(meta))];

  let ch = 0;
  for (const tr of song.tracks) {
    let c;
    if (tr.drums) c = 9;
    else {
      if (ch % 16 === 9) ch++;
      c = ch++ % 16;
    }
    const name = str(tr.name || 'Layer');
    const vol = Math.round(Math.max(0, Math.min(1, tr.volume == null ? 0.8 : tr.volume)) * 127);
    const ev = [
      { tick: 0, order: 0, bytes: [0xff, 0x03, name.length, ...name] },
      { tick: 0, order: 1, bytes: [0xb0 | c, 7, vol] },
    ];
    if (!tr.drums) ev.push({ tick: 0, order: 1, bytes: [0xc0 | c, (tr.program || 0) & 127] });
    if (tr.reverb > 0) ev.push({ tick: 0, order: 1, bytes: [0xb0 | c, 91, Math.round(Math.min(1, tr.reverb) * 127)] });
    if (tr.chorus > 0) ev.push({ tick: 0, order: 1, bytes: [0xb0 | c, 93, Math.round(Math.min(1, tr.chorus) * 127)] }); // GM chorus depth
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
}
