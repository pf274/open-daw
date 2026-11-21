import { describe, it, expect, vi } from 'vitest';
import { withContext } from '../src/audio/context.js';
import { playDrum, DRUMS, DRUM_BANKS, METAL_HZ, PAD_KEY_ORDER, keyLabel, drumForKey, padList, bankRange } from '../src/audio/drums.js';
import { fakeCtx } from './helpers/fake-audio.js';

const hit = (pitch) => {
  const ctx = fakeCtx(), out = ctx.createGain();
  withContext(ctx, out, () => playDrum(out, pitch, 0, 100));
  return ctx;
};

describe('ride cymbal', () => {
  it.each([51, 59])('note %i has no pitched tone, only noise + high-passed metallic partials', (pitch) => {
    const ctx = hit(pitch);
    const oscs = ctx.nodes.filter((n) => n.kind === 'osc');
    // the old sound had a 480 Hz square "ping" wired straight to the output
    expect(oscs.map((o) => o.frequency.value).sort((a, b) => a - b)).toEqual([...METAL_HZ].sort((a, b) => a - b));
    for (const o of oscs) {
      expect(o.type).toBe('square');
      const [hp] = o.out;
      expect(hp.kind).toBe('filter');
      expect(hp.type).toBe('highpass');
      expect(hp.frequency.value).toBeGreaterThanOrEqual(7000); // fundamentals (≤ 800 Hz) are removed
    }
    expect(ctx.nodes.some((n) => n.kind === 'noise')).toBe(true);
  });

  it('the shimmer frequencies are inharmonic (no shared fundamental above 20 Hz)', () => {
    const ratios = METAL_HZ.map((f) => f / METAL_HZ[0]);
    expect(ratios.some((r) => Math.abs(r - Math.round(r)) > 0.05)).toBe(true);
  });
});

describe('pad keys and banks', () => {
  it('covers the whole GM percussion map (35–81) exactly once across the banks', () => {
    const all = DRUM_BANKS.flatMap((b) => b.notes).sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 47 }, (_, i) => 35 + i));
    expect(Object.keys(DRUMS).map(Number).sort((a, b) => a - b)).toEqual(all);
    for (const b of DRUM_BANKS) expect(b.notes.length).toBeLessThanOrEqual(PAD_KEY_ORDER.length);
  });
  it('within each bank, keys run left to right in note order (strip reads in order)', () => {
    DRUM_BANKS.forEach((b, i) => {
      const notes = [...b.notes].sort((x, y) => x - y);
      expect(notes).toEqual(b.notes);
      expect(padList(i).map((d) => d.key)).toEqual(PAD_KEY_ORDER.slice(0, b.notes.length).map(keyLabel));
    });
    expect(padList(0).map((d) => d.key).join(' ')).toBe("A W S E D F T G Y H U J K O L P ; '");
  });
  it('kick on A, snare on S in bank 1; Space is the kick in every bank; banks are separate', () => {
    expect([drumForKey('KeyA', 0), drumForKey('KeyS', 0)]).toEqual([36, 38]);
    expect([0, 1, 2].map((b) => drumForKey('Space', b))).toEqual([36, 36, 36]);
    expect(drumForKey('KeyA', 1)).toBe(54); // tambourine
    expect(drumForKey('KeyA', 2)).toBe(35); // bass drum 2
    expect(drumForKey('Quote', 2)).toBeUndefined(); // bank 3 has 11 pads
    expect(bankRange(1)).toEqual([54, 71]);
  });
  it('uses the same key order as the pick-mode piano', async () => {
    const { PIANO_KEYS } = await import('../src/engine/pick.js');
    const pianoOrder = Object.entries(PIANO_KEYS).sort((a, b) => a[1] - b[1]).map(([code]) => code);
    expect(PAD_KEY_ORDER).toEqual(pianoOrder);
  });
});

describe('new sounds', () => {
  it('vibraslap and guiros are trains of noise bursts', () => {
    const count = (pitch) => hit(pitch).nodes.filter((n) => n.kind === 'noise').length;
    expect(count(58)).toBe(18);
    expect(count(74)).toBeGreaterThan(count(73));
  });
  it('the open cuica rises in pitch; the mute one falls', () => {
    const ramp = (pitch) => hit(pitch).nodes.find((n) => n.kind === 'osc').frequency.events;
    const [open0, open1] = ramp(79), [mute0, mute1] = ramp(78);
    expect(open1[1]).toBeGreaterThan(open0[1]);
    expect(mute1[1]).toBeLessThan(mute0[1]);
  });
  it('open triangle rings much longer than the muted one', () => {
    const decay = (pitch) => Math.max(...hit(pitch).nodes.flatMap((n) => n.gain.events.map((e) => e[2] ?? 0)));
    expect(decay(81)).toBeGreaterThan(decay(80) * 5);
  });
});

describe('every mapped drum still plays', () => {
  it.each(Object.keys(DRUMS).map(Number))('drum %i schedules sound without throwing', (pitch) => {
    const ctx = hit(pitch);
    expect(ctx.nodes.length).toBeGreaterThan(2);
  });
});

describe('bank switching', () => {
  it('Z / X move between banks (clamped) and pick mode on a drum layer uses the bank', async () => {
    vi.resetModules();
    vi.doMock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));
    const { resetProject, addTrack, curTrack } = await import('../src/stores/project.js');
    const { ui } = await import('../src/stores/ui.js');
    const { shiftDrumBank } = await import('../src/engine/drumPads.js');
    const { enterPick, pickKeyDown, pick } = await import('../src/engine/pick.js');
    resetProject();
    const tr = addTrack('Drums', 'drums');
    tr.notes = [{ id: 1, start: 0, dur: 0.25, pitch: 63, vel: 90 }, { id: 2, start: 1, dur: 0.25, pitch: 36, vel: 90 }];
    ui.drumBank = 0;
    expect(shiftDrumBank(-1)).toBe(false); // already the first bank
    enterPick([1, 2], 63, false);
    expect(ui.drumBank).toBe(1); // opened the first note's bank (conga high)
    const key = (code, k) => ({ code, key: k, repeat: false, preventDefault() {} });
    pickKeyDown(key('KeyX', 'x'));
    expect(ui.drumBank).toBe(2);
    pickKeyDown(key('KeyX', 'x'));
    expect(ui.drumBank).toBe(2); // clamped at the last bank
    pickKeyDown(key('KeyD', 'd')); // bank 3: A=35, W=72, S=73, E=74, D=75 claves
    pickKeyDown(key('', 'Enter'));
    expect(curTrack().notes.find((n) => n.id === 1).pitch).toBe(75);
    pickKeyDown(key('KeyZ', 'z'));
    pickKeyDown(key('KeyZ', 'z'));
    expect(ui.drumBank).toBe(0);
    pickKeyDown(key('KeyS', 's'));
    pickKeyDown(key('', 'Enter'));
    expect(curTrack().notes.find((n) => n.id === 2).pitch).toBe(38);
    expect(pick.active).toBe(false);
  });
});
