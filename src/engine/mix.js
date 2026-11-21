/** Bridges tracks → audio buses, and note previews. */
import { ensureAudio, getCtx } from '../audio/context.js';
import { busFor } from '../audio/mixer.js';
import { playVoice } from '../audio/synth.js';
import { specFor, fxFor } from '../audio/instruments.js';
import { project, audible, soundPitch } from '../stores/project.js';

export const trackBus = (tr) => busFor(tr.id, audible(tr) ? tr.vol : 0, fxFor(tr));

/** Push current volume/mute/solo to the buses (every layer of every pattern — the song plays them all). */
export function applyMix() {
  if (!getCtx()) return;
  for (const p of project.patterns) for (const tr of p.layers) trackBus(tr);
}

/** Preview one (written) pitch on a track — sounds transposed, like playback. */
export function audition(tr, pitch, vel) {
  const actx = ensureAudio();
  playVoice(trackBus(tr), specFor(tr), soundPitch(tr, pitch), actx.currentTime + 0.01, 0.25, vel || 96);
}
