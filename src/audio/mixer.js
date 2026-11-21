/**
 * One bus per layer, keyed by layer id:  voices → gain (volume) → [effects → reverb] → master.
 * Knows nothing about tracks beyond id, gain and an optional effect chain description.
 */
import { getCtx, getMaster } from './context.js';
import { createFxChain, fxSignature } from './fxChain.js';

const buses = new Map(); // id → { gain, chain }

/**
 * The bus voices for layer `id` play into.
 * @param fx  the layer's chain { effects, reverb } (null = none) — see audio/fxChain.js
 */
export function busFor(id, gain, fx = null) {
  let b = buses.get(id);
  if (!b) {
    b = { gain: getCtx().createGain(), chain: null };
    b.gain.connect(getMaster());
    buses.set(id, b);
  }
  b.gain.gain.value = gain;
  const sig = fxSignature(fx);
  if (sig !== (b.chain?.signature ?? '')) { // the chain's shape changed: rebuild it
    b.gain.disconnect();
    b.chain?.dispose();
    b.chain = fx ? createFxChain(getCtx(), fx) : null;
    if (b.chain) { b.gain.connect(b.chain.input); b.chain.output.connect(getMaster()); } else b.gain.connect(getMaster());
  } else if (b.chain) b.chain.update(fx);
  return b.gain;
}

/** Cut every sounding/scheduled voice (and effect tails) instantly by dropping the buses. */
export function silenceAll() {
  for (const b of buses.values()) {
    try {
      b.gain.gain.cancelScheduledValues(0);
      b.gain.gain.value = 0;
      b.gain.disconnect();
      b.chain?.dispose();
    } catch { /* already gone */ }
  }
  buses.clear();
}

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
