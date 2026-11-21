/**
 * Turning a track's notes into voices — shared by live playback (transport),
 * previews and offline rendering (audio export). Handles slide chains and tremor.
 */
import { playVoice } from '../audio/synth.js';
import { specFor } from '../audio/instruments.js';
import { slideLinks, buildChain, glideSegments } from '../core/slides.js';
import { tremorSegments } from '../core/tremor.js';
import { isDrum, soundPitch } from '../stores/project.js';

/**
 * Schedule every note of `tr` that starts in [b0, b1).
 * @param tr        anything with { inst, synth?, notes } (a track, or a preview stand-in)
 * @param at        beat → context seconds
 * @param segStart  beat where this playback segment began (play start / loop start).
 *                  A slide target whose source started before it becomes a chain head,
 *                  so starting playback mid-chain still sounds.
 */
export function scheduleTrack(tr, b0, b1, at, spb, dest, segStart = -Infinity) {
  const drums = isDrum(tr);
  const links = drums ? null : slideLinks(tr.notes);
  for (const n of tr.notes) {
    if (n.start < b0 || n.start >= b1) continue;
    if (drums) {
      playVoice(dest, tr.inst, n.pitch, at(n.start), n.dur * spb, n.vel);
      continue;
    }
    const p = links.prev.get(n.id);
    if (p && p.start >= segStart - 1e-9) continue; // sounded as part of p's chain
    playChain(tr, links.next.size ? buildChain(n, links.next) : [n], at, spb, dest);
  }
}

/** One voice for a note, or for a whole slide chain. */
function playChain(tr, chain, at, spb, dest) {
  const head = chain[0], last = chain[chain.length - 1];
  const glides = chain.length > 1
    ? glideSegments(chain, at, spb).map((g) => ({ from: g.from, to: g.to, midi: soundPitch(tr, g.pitch) }))
    : null;
  playVoice(dest, specFor(tr), soundPitch(tr, head.pitch), at(head.start), (last.start + last.dur - head.start) * spb, head.vel, {
    glides,
    tremor: tremorSegments(chain, at),
  });
}
