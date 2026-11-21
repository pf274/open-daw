/** The shared AudioContext, master chain, and clock conversions. */
import { loadWorklets } from './worklets.js';

let actx = null;
let master = null;
let masterVolume = 0.8;

export function ensureAudio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    master = buildMasterChain(actx, masterVolume);
    loadWorklets(actx); // async; effects fall back until ready
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

export const getCtx = () => actx;
export const getMaster = () => master;

/**
 * Run `fn` with another context (e.g. an OfflineAudioContext) standing in for the live one,
 * so every synth/drum function schedules into it. Scheduling is synchronous, so a swap is safe.
 */
export function withContext(ctx, masterNode, fn) {
  const prev = [actx, master];
  actx = ctx;
  master = masterNode;
  try { return fn(); } finally { [actx, master] = prev; }
}

/** The master chain (gain → compressor → destination) built on any context. */
export function buildMasterChain(ctx, volume) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 4;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(comp);
  comp.connect(ctx.destination);
  return gain;
}

export function setMasterVolume(v) {
  masterVolume = v;
  if (master) master.gain.value = v;
}

/** Seconds between scheduling a sound and it reaching the speakers. */
export const outLat = () => (actx ? actx.outputLatency || actx.baseLatency || 0 : 0);

/** AudioContext time → performance.now() time (ms). */
export function perfAtCtx(t) {
  if (actx.getOutputTimestamp) {
    const ts = actx.getOutputTimestamp();
    if (ts && ts.performanceTime) return ts.performanceTime + (t - ts.contextTime) * 1000;
  }
  return performance.now() + (t - actx.currentTime) * 1000;
}

/** performance.now() time (ms) → AudioContext time. */
export function ctxAtPerf(p) {
  if (actx.getOutputTimestamp) {
    const ts = actx.getOutputTimestamp();
    if (ts && ts.performanceTime) return ts.contextTime + (p - ts.performanceTime) / 1000;
  }
  return actx.currentTime + (p - performance.now()) / 1000;
}

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
