import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizePatch, patchToSpec, presetPatch, PRESETS, DEFAULT_PATCH } from '../src/audio/customSynth.js';
import { specFor, gmProgramFor } from '../src/audio/instruments.js';
import { withContext } from '../src/audio/context.js';
import { playVoice } from '../src/audio/synth.js';
import { GM_PROGRAMS } from '../src/core/gm.js';
import { fakeCtx } from './helpers/fake-audio.js';

vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));
const { project, resetProject, curTrack, addTrack, serialize, loadProjectData } = await import('../src/stores/project.js');
const { ui } = await import('../src/stores/ui.js');
const { undo, clearHistory } = await import('../src/stores/history.js');
const { setInstrument, openSynthEditor, loadPreset, applySynth, closeSynthEditor, previewMaterial, TEST_PHRASE } = await import('../src/engine/synthEditor.js');
const { buildSong } = await import('../src/engine/files.js');

const stripIds = (p) => ({ ...p, filters: p.filters.map(({ id, ...f }) => f) });

describe('patches (pure)', () => {
  it('fills defaults, clamps ranges and rejects unknown values', () => {
    const p = normalizePatch({ wave: 'noise', attack: 99, sustain: -1, osc2Octave: 1.6, gm: 300, volume: 'loud',
      filters: [{ type: 'comb', freq: 5, env: { mode: 'gain' } }] });
    expect(p.wave).toBe(DEFAULT_PATCH.wave);
    expect([p.attack, p.sustain, p.osc2Octave, p.gm, p.volume]).toEqual([4, 0, 2, 128, DEFAULT_PATCH.volume]);
    expect(p.filters[0]).toMatchObject({ type: 'lowpass', freq: 20, env: { mode: 'off' } }); // 'gain' needs an amplifier
    const n = normalizePatch();
    expect(n.filters).toHaveLength(1);
    expect(n.filters[0]).toMatchObject({ type: 'lowpass', freq: 3000, resonance: 1, enabled: true });
    expect(normalizePatch(n)).toEqual(n); // idempotent (ids kept)
  });

  it('turns a patch into a voice spec', () => {
    const solo = patchToSpec({ wave: 'square', osc2Level: 0, attack: 0.1, decay: 0.6, sustain: 0.5, release: 0.4,
      filters: [{ type: 'lowpass', freq: 900, resonance: 3 }], vibDepth: 12, vibRate: 4, volume: 0.5, gm: 81 });
    expect(solo.partials).toEqual([['square', 1, 1, 0]]); // oscillator 2 off at level 0
    expect(solo).toMatchObject({ a: 0.1, s: 0.5, r: 0.4, vib: 12, vibRate: 4, gain: 0.5, gm: 80 });
    expect(solo.dt).toBeCloseTo(0.2, 9); // decay 0.6 s → time-constant 0.2
    expect(solo.filters).toEqual([{ type: 'lowpass', freq: 900, q: 3, gain: 0, env: null }]);

    const dual = patchToSpec({ wave: 'sine', osc2Wave: 'sawtooth', osc2Level: 0.5, osc2Octave: -1, osc2Detune: 7, filters: [] });
    expect(dual.partials[1]).toEqual(['sawtooth', 0.5, 0.5, 7]);
    expect(dual.filters).toEqual([]);
  });

  it('every preset is a valid patch with a named GM program', () => {
    for (const name of Object.keys(PRESETS)) {
      const p = presetPatch(name);
      expect(normalizePatch(p)).toEqual(p);
      expect(GM_PROGRAMS[p.gm - 1]).toBeTruthy();
      expect(patchToSpec(p).partials.length).toBeGreaterThan(0);
    }
    expect(GM_PROGRAMS).toHaveLength(128);
  });

  it('layers resolve to their patch (custom) or built-in instrument', () => {
    expect(specFor({ inst: 'custom', synth: { wave: 'triangle' } }).partials[0][0]).toBe('triangle');
    expect(specFor({ inst: 'flute' }).name).toBe('Flute');
    expect(gmProgramFor({ inst: 'custom', synth: { gm: 40 } })).toBe(39);
    expect(gmProgramFor({ inst: 'flute' })).toBe(73);
  });
});

describe('playVoice with a custom spec', () => {
  it('applies waveform, filter, gain and vibrato rate', () => {
    const ctx = fakeCtx(), out = ctx.createGain();
    const spec = patchToSpec({ wave: 'square', osc2Level: 0.4, osc2Octave: 1, filters: [{ type: 'highpass', freq: 1200, resonance: 5 }], vibDepth: 20, vibRate: 3, volume: 0.5 });
    withContext(ctx, out, () => playVoice(out, spec, 69, 0, 1, 127));
    const filter = ctx.nodes.find((n) => n.kind === 'filter');
    expect([filter.type, filter.frequency.value, filter.Q.value]).toEqual(['highpass', 1200, 5]);
    const oscs = ctx.nodes.filter((n) => n.kind === 'osc');
    expect(oscs.map((o) => o.type)).toEqual([undefined, 'square', 'square']); // vibrato LFO + 2 oscillators
    expect(oscs[0].frequency.value).toBe(3);
    expect(oscs[2].frequency.value).toBeCloseTo(880, 6); // osc 2 an octave up
    const fullPeak = ctx.nodes.find((n) => n.kind === 'gain' && n.gain.events.some(([m]) => m === 'linearRampToValueAtTime'));
    const peak = fullPeak.gain.events.find(([m]) => m === 'linearRampToValueAtTime')[1];
    expect(peak).toBeCloseTo((0.35 / Math.max(1, 1.4 * 0.8)) * 0.5, 9);
  });
});

describe('synth editor', () => {
  beforeEach(() => {
    resetProject();
    clearHistory();
    ui.synthModal.open = false;
  });

  it('switching to Custom synth gives the layer a default patch', () => {
    const t = curTrack();
    expect(t.synth).toBeUndefined();
    setInstrument(t, 'custom');
    expect(stripIds(t.synth)).toEqual(stripIds(normalizePatch()));
    t.synth.wave = 'sine';
    setInstrument(t, 'piano');
    setInstrument(t, 'custom');
    expect(t.synth.wave).toBe('sine'); // keeps the patch when switching back
  });

  it('edits a working copy; Cancel leaves the layer alone, Apply commits (undoable)', () => {
    const t = curTrack();
    setInstrument(t, 'custom');
    openSynthEditor(t.id);
    ui.synthModal.patch.wave = 'triangle';
    expect(t.synth.wave).toBe('sawtooth');
    closeSynthEditor();
    expect(t.synth.wave).toBe('sawtooth');

    openSynthEditor(t.id);
    loadPreset('Fat bass');
    expect(ui.synthModal.patch.osc2Octave).toBe(-1);
    applySynth();
    expect(curTrack().synth.osc2Octave).toBe(-1);
    undo();
    expect(curTrack().synth.osc2Octave).toBe(0);
  });

  it('previews the selection on the edited layer, otherwise a test phrase', () => {
    const t = curTrack();
    setInstrument(t, 'custom');
    t.notes = [{ id: 5, start: 0, dur: 1, pitch: 60, vel: 90 }];
    openSynthEditor(t.id);
    ui.sel = new Set();
    expect(previewMaterial().notes).toBe(TEST_PHRASE);
    ui.sel = new Set([5]);
    expect(previewMaterial().notes.map((n) => n.id)).toEqual([5]);
    const other = addTrack('Other', 'custom');
    openSynthEditor(other.id);
    expect(previewMaterial().notes).toBe(TEST_PHRASE);
  });

  it('exports the chosen GM program and survives save/load', () => {
    const t = curTrack();
    setInstrument(t, 'custom');
    t.synth = { ...t.synth, gm: 39, wave: 'square' };
    t.notes = [{ id: 1, start: 0, dur: 1, pitch: 60, vel: 90 }];
    expect(buildSong().tracks[0].program).toBe(38);
    const json = JSON.parse(serialize());
    json.patterns[0].layers[0].synth = { wave: 'square' }; // older/partial patch
    loadProjectData(json);
    expect(stripIds(curTrack().synth)).toEqual(stripIds(normalizePatch({ wave: 'square' })));
    expect(project.tracks[0].inst).toBe('custom');
  });
});

describe('preset groups', () => {
  it('list every preset exactly once', async () => {
    const { PRESET_GROUPS } = await import('../src/audio/customSynth.js');
    const listed = PRESET_GROUPS.flatMap(([, names]) => names);
    expect([...listed].sort()).toEqual(Object.keys(PRESETS).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });
});
