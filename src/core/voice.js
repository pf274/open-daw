/**
 * What you record with ● Rec: whistling or humming / singing. They differ in pitch range
 * (what the detector listens for) and in how recorded pitches are transposed into notes:
 * whistling sounds about an octave above the note you mean (so it drops 12 by default),
 * a hum is already where you mean it.
 */
export const INPUT_MODES = {
  whistle: { label: 'Whistle', minFreq: 400, maxFreq: 4500 },
  hum: { label: 'Hum or sing', minFreq: 65, maxFreq: 1000 },
};

/** The mode of a take (recorded with its mode), else the current setting. */
export const inputMode = (s, take = null) => ((take?.mode || s.inputMode) === 'hum' ? 'hum' : 'whistle');

/** Semitones added to recorded pitches: each mode has its own transpose setting. */
export const pitchShift = (s, take = null) => +(inputMode(s, take) === 'hum' ? s.humTranspose : s.transpose) || 0;

/** The settings key holding the current mode's transpose. */
export const transposeKey = (s) => (inputMode(s) === 'hum' ? 'humTranspose' : 'transpose');
