/** Minimal SMF reader for tests. */
export function parseMidi(b) {
  let p = 0;
  const rd = (n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p++]; return v; };
  const tag = () => String.fromCharCode(...b.slice(p, (p += 4)));
  if (tag() !== 'MThd') throw new Error('bad header');
  rd(4);
  const fmt = rd(2), nt = rd(2), ppq = rd(2);
  const tracks = [];
  for (let t = 0; t < nt; t++) {
    if (tag() !== 'MTrk') throw new Error('bad track ' + t);
    const end = rd(4) + p, ev = [];
    let tick = 0;
    while (p < end) {
      let d = 0, c;
      do { c = b[p++]; d = (d << 7) | (c & 127); } while (c & 128);
      tick += d;
      const status = b[p++];
      if (status === 0xff) { const type = b[p++], len = b[p++]; ev.push({ tick, meta: type, data: b.slice(p, p + len) }); p += len; }
      else if ((status & 0xf0) === 0xc0) ev.push({ tick, status, d1: b[p++] });
      else ev.push({ tick, status, d1: b[p++], d2: b[p++] });
    }
    tracks.push(ev);
  }
  return { fmt, ppq, tracks };
}

export const noteOns = (track) => track.filter((e) => (e.status & 0xf0) === 0x90);
