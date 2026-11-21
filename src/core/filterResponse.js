/**
 * Biquad filter maths — the exact coefficient formulas the Web Audio spec uses for
 * BiquadFilterNode (Audio EQ Cookbook), so the response graph matches what you hear.
 *
 * Note the spec's quirk: for lowpass/highpass, Q is in dB (resonance);
 * for bandpass/notch/peaking it is a linear Q.
 */
export const GRAPH_RANGE = { fMin: 20, fMax: 20000, dbMin: -36, dbMax: 24 };

/** Bandwidth in octaves → linear Q (for bandpass, notch, peaking). */
export function widthToQ(octaves) {
  const p = 2 ** octaves;
  return Math.sqrt(p) / (p - 1);
}

/** @param type Web Audio type: lowpass | highpass | bandpass | notch | peaking */
export function biquadCoefficients(type, freq, q, gainDb = 0, fs = 48000) {
  const w0 = (2 * Math.PI * Math.min(freq, fs / 2 - 1)) / fs;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  switch (type) {
    case 'lowpass':
    case 'highpass': {
      const alpha = sin / (2 * 10 ** (q / 20));
      const k = type === 'lowpass' ? 1 - cos : 1 + cos;
      const sign = type === 'lowpass' ? 1 : -1;
      return { b0: k / 2, b1: sign * k, b2: k / 2, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha };
    }
    case 'bandpass': {
      const alpha = sin / (2 * q);
      return { b0: alpha, b1: 0, b2: -alpha, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha };
    }
    case 'notch': {
      const alpha = sin / (2 * q);
      return { b0: 1, b1: -2 * cos, b2: 1, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha };
    }
    case 'peaking': {
      const alpha = sin / (2 * q), A = 10 ** (gainDb / 40);
      return { b0: 1 + alpha * A, b1: -2 * cos, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cos, a2: 1 - alpha / A };
    }
    default:
      return { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 };
  }
}

/** |H(f)| in dB for one biquad. */
export function magnitudeDb(c, f, fs = 48000) {
  const w = (2 * Math.PI * f) / fs;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2, ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = c.a0 + c.a1 * c1 + c.a2 * c2, di = -(c.a1 * s1 + c.a2 * s2);
  const mag2 = (nr * nr + ni * ni) / (dr * dr + di * di);
  return 10 * Math.log10(Math.max(mag2, 1e-12));
}

/** Combined response (dB) of a chain of { type, freq, q, gain } filters at frequency f. */
export function chainDb(filters, f, fs = 48000) {
  let db = 0;
  for (const x of filters) db += magnitudeDb(biquadCoefficients(x.type, x.freq, x.q, x.gain, fs), f, fs);
  return db;
}

/** n log-spaced frequencies across the graph range. */
export function logFrequencies(n = 160, { fMin, fMax } = GRAPH_RANGE) {
  return Array.from({ length: n }, (_, i) => fMin * (fMax / fMin) ** (i / (n - 1)));
}
