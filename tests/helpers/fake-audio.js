/** Fake Web Audio graph that records connections and AudioParam automation. */
export function fakeCtx() {
  const nodes = [];
  const param = (name) => {
    const p = { name, value: 0, events: [] };
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'setValueCurveAtTime']) {
      p[m] = (v, t, d) => p.events.push(d === undefined ? [m, v, t] : [m, v, t, d]);
    }
    return p;
  };
  const node = (kind) => {
    const n = { kind, out: [], connect(d) { n.out.push(d); }, disconnect() {}, start(when, offset, dur) { n.started = dur === undefined ? [when, offset] : [when, offset, dur]; }, stop(t) { n.stopped = t ?? true; } };
    for (const k of ['gain', 'frequency', 'detune', 'Q', 'playbackRate', 'pan', 'delayTime']) n[k] = param(k);
    nodes.push(n);
    return n;
  };
  return {
    nodes, currentTime: 0, sampleRate: 48000, destination: node('dest'),
    createGain: () => node('gain'), createOscillator: () => node('osc'), createBiquadFilter: () => node('filter'),
    createBufferSource: () => node('noise'),
    createStereoPanner: () => node('panner'),
    createDelay: () => node('delay'),
    createConstantSource: () => { const n = node('constant'); n.offset = param('offset'); return n; },
    createWaveShaper: () => node('shaper'),
    createConvolver: () => node('convolver'),
    createBuffer: (ch, len, rate) => { const data = Array.from({ length: ch }, () => new Float32Array(len)); return { length: len, sampleRate: rate, duration: len / rate, numberOfChannels: ch, getChannelData: (c) => data[c] }; },
    /** Fake decoding: every byte becomes one sample at 1 kHz (so 1500 bytes = 1.5 s); bytes starting with 0 are "not audio". */
    decodeAudioData(bytes) {
      const u8 = new Uint8Array(bytes);
      if (!u8.length || u8[0] === 0) return Promise.reject(new Error('Unable to decode audio data'));
      const b = this.createBuffer(1, u8.length, 1000);
      const d = b.getChannelData(0);
      for (let i = 0; i < u8.length; i++) d[i] = (u8[i] - 128) / 128;
      return Promise.resolve(b);
    },
  };
}

