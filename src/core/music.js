/** Small music/number helpers shared everywhere. Pure — no DOM, no audio. */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

export const mod12 = (m) => ((m % 12) + 12) % 12;
export const noteName = (m) => NOTE_NAMES[mod12(m)] + (Math.floor(m / 12) - 1);
export const keyName = (pc) => FLAT_NAMES[mod12(pc)];
export const isBlack = (m) => [1, 3, 6, 8, 10].includes(mod12(m));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** e.g. transposeLabel(3, 0) → "+3  (C → E♭)" */
export const transposeLabel = (t, root) => `${t > 0 ? '+' : ''}${t}  (${keyName(root)} → ${keyName(root + t)})`;
