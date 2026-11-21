/**
 * AudioWorklet processors, loaded from inline source (no extra files to serve).
 * Loading is asynchronous: effects check workletReady(ctx) and fall back if it isn't yet.
 */
const CRUSHER = `
class Crusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16 },
      { name: 'downsample', defaultValue: 1, minValue: 1, maxValue: 64 },
    ];
  }
  constructor() { super(); this.hold = []; this.count = []; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    for (let c = 0; c < out.length; c++) {
      const x = inp[c] || inp[0], y = out[c];
      let hold = this.hold[c] || 0, count = this.count[c] || 0;
      for (let n = 0; n < y.length; n++) {
        const bits = p.bits.length > 1 ? p.bits[n] : p.bits[0];
        const ds = p.downsample.length > 1 ? p.downsample[n] : p.downsample[0];
        if (count <= 0) { const step = 2 / Math.pow(2, bits); hold = Math.round(x[n] / step) * step; count += ds; }
        count -= 1;
        y[n] = hold;
      }
      this.hold[c] = hold; this.count[c] = count;
    }
    return true;
  }
}
registerProcessor('od-crusher', Crusher);
`;

const ready = new WeakSet();
const loading = new WeakMap();

/** Start loading the worklets into `ctx` (once); resolves when ready, or false if unsupported. */
export function loadWorklets(ctx) {
  if (!ctx?.audioWorklet || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') return Promise.resolve(false);
  if (!loading.has(ctx)) {
    const url = URL.createObjectURL(new Blob([CRUSHER], { type: 'application/javascript' }));
    loading.set(ctx, ctx.audioWorklet.addModule(url).then(() => { ready.add(ctx); return true; }, () => false));
  }
  return loading.get(ctx);
}
export const workletReady = (ctx) => ready.has(ctx);
