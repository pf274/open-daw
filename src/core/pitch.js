/** Pitch conversion + YIN pitch detection tuned for whistling (~400–4500 Hz). */
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

/**
 * @param {Float32Array} buf  time-domain samples
 * @param {number} sr         sample rate
 * @returns {{freq:number, clarity:number, rms:number}} freq 0 = unvoiced
 */
export function detectPitch(buf, sr, opts = {}) {
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
  // parabolic interpolation around the minimum
  const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (a - c) / (2 * den) : 0;
  const refined = tau + Math.max(-1, Math.min(1, shift));
  return { freq: sr / refined, clarity: 1 - b, rms };
}
