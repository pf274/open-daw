/**
 * A layer's effect chain: its insert effects in order, then its reverb.
 *   fx = { effects: [{ type, …settings }], reverb: settings | null }   (null fx = no chain)
 * Rebuilt when the shape (types/order/reverb on-off) changes; otherwise updated in place.
 */
import { createFx, FX, normalizeFxSettings } from './fx.js';
import { createReverb } from './reverb.js';

export const fxSignature = (fx) => (fx ? [...fx.effects.map((e) => e.type), fx.reverb ? 'reverb' : ''].join('>') : '');

export function createFxChain(ctx, fx) {
  const units = fx.effects.map((e) => createFx(ctx, e.type, e));
  const rv = fx.reverb ? createReverb(ctx, fx.reverb) : null;
  const stages = rv ? [...units, rv] : units;
  for (let i = 1; i < stages.length; i++) stages[i - 1].output.connect(stages[i].input);
  return {
    input: stages[0].input,
    output: stages[stages.length - 1].output,
    signature: fxSignature(fx),
    update(next) {
      next.effects.forEach((e, i) => units[i].update(normalizeFxSettings(e.type, e)));
      if (rv && next.reverb) rv.update(next.reverb);
    },
    dispose() {
      for (const u of units) u.dispose();
      for (const s of stages) { try { s.output.disconnect(); } catch { /* gone */ } }
    },
  };
}

/** Seconds a chain keeps sounding after its input stops (reverb decay, echo repeats). */
export function fxTail(fx) {
  if (!fx) return 0;
  let t = fx.reverb?.decay ?? 0;
  for (const e of fx.effects) t = Math.max(t, FX[e.type].tail?.(normalizeFxSettings(e.type, e)) ?? 0);
  return t;
}
