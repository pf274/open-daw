/** Pitch modulation shared by every voice type (oscillator synths and sampled instruments). */
import { midiToFreq } from '../core/pitch.js';

/**
 * Apply pitch glides to an AudioParam that tracks frequency × ratio.
 * glides: [{ from, to, midi }] in context seconds, ascending.
 */
export function automateGlides(param, startHz, glides, map) {
  let hz = startHz;
  for (const g of glides) {
    const target = midiToFreq(g.midi);
    param.setValueAtTime(map(hz), g.from);
    param.exponentialRampToValueAtTime(map(target), g.to);
    hz = target;
  }
}

/**
 * Pitch LFO (cents, for a detune param) whose depth/rate switch at each segment.
 * segments: [{ from, depth, rate }] ascending in time. Returns the depth gain node to connect.
 */
export function makeTremor(actx, segments, when, stop) {
  const lfo = actx.createOscillator();
  const depth = actx.createGain();
  lfo.frequency.setValueAtTime(segments[0].rate, when);
  depth.gain.setValueAtTime(segments[0].depth, when);
  for (const s of segments) {
    lfo.frequency.setValueAtTime(s.rate, Math.max(when, s.from));
    depth.gain.setValueAtTime(s.depth, Math.max(when, s.from));
  }
  lfo.connect(depth);
  lfo.start(when);
  lfo.stop(stop);
  return depth;
}
