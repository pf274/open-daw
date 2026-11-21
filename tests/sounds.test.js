import { describe, it, expect, vi, beforeEach } from 'vitest';

// a controllable audio clock and a fake context that records the graph
const clock = { t: 0 };
vi.mock('../src/audio/synth.js', () => ({ playVoice: vi.fn(), click: vi.fn() }));
vi.mock('../src/audio/mixer.js', () => ({ busFor: (id, gain) => ({ id, gain, kind: 'bus' }), silenceAll: vi.fn() }));
const audio = {};
vi.mock('../src/audio/context.js', async () => {
  const { fakeCtx } = await import('./helpers/fake-audio.js');
  const ctx = fakeCtx();
  Object.defineProperty(ctx, 'currentTime', { get: () => clock.t });
  Object.assign(audio, { ctx, master: ctx.createGain() });
  return {
    ensureAudio: () => ctx, getCtx: () => ctx, getMaster: () => audio.master,
    outLat: () => 0, perfAtCtx: (t) => t * 1000, ctxAtPerf: (p) => p / 1000,
    setMasterVolume: vi.fn(), withContext: (c, m, fn) => fn(), buildMasterChain: vi.fn(),
  };
});

const { project, resetProject, songLength, clipLength, serialize, loadProjectData, soundById } = await import('../src/stores/project.js');
const { ui } = await import('../src/stores/ui.js');
const { undo, redo, clearHistory } = await import('../src/stores/history.js');
const S = await import('../src/engine/song.js');
const { startTransport, stopTransport, schedule } = await import('../src/engine/transport.js');
const { playedLayers, buildSong } = await import('../src/engine/files.js');
const SND = await import('../src/engine/sounds.js');
const { computePeaks, scheduleSoundClips } = await import('../src/audio/soundBank.js');
const { getSoundBytes } = await import('../src/stores/soundStore.js');

/** A fake audio "file": n bytes (decodes to n ms of audio in the fake context). */
const audioFile = (name, n = 1500, first = 200) => {
  const u8 = new Uint8Array(n).fill(128);
  u8[0] = first;
  u8[Math.floor(n / 2)] = 255; // a peak in the middle
  return { name, size: n, type: 'audio/wav', arrayBuffer: async () => u8.buffer.slice(0) };
};
const sources = () => audio.ctx.nodes.filter((n) => n.kind === 'noise' && n.buffer && n.started);

beforeEach(() => {
  stopTransport();
  resetProject();
  clearHistory();
  ui.view = 'song';
  ui.songSel = new Set();
  ui.songSnap = 1;
  project.bpm = 120; // 0.5 s per beat
  audio.ctx.nodes.length = 0;
});

async function importOne(name = 'boom.wav', n = 1500) {
  const [s] = await SND.importSoundFiles([audioFile(name, n)]);
  return s;
}

describe('importing sounds', () => {
  it('decodes, stores and lists the sound (one undo step)', async () => {
    const s = await importOne('door-slam.wav');
    expect(project.sounds).toHaveLength(1);
    expect(s).toMatchObject({ name: 'door-slam', vol: 0.8, mime: 'audio/wav', size: 1500 });
    expect(s.duration).toBeCloseTo(1.5);
    expect(typeof s.key).toBe('string');
    expect(SND.soundState.ready[s.id]).toBe(true);
    expect(await getSoundBytes(s.key)).toBeTruthy();
    undo();
    expect(project.sounds).toHaveLength(0);
    redo();
    expect(project.sounds[0].name).toBe('door-slam');
  });

  it('reports files it cannot decode and keeps the rest', async () => {
    const added = await SND.importSoundFiles([audioFile('notes.txt', 10, 0), audioFile('ok.wav')]);
    expect(added.map((s) => s.name)).toEqual(['ok']);
    expect(ui.status.msg).toMatch(/notes\.txt/);
    expect(ui.status.warn).toBe(true);
  });

  it('computes normalised waveform peaks', async () => {
    const s = await importOne();
    const pk = SND.soundPeaks(s.id);
    expect(pk.length).toBe(400);
    expect(Math.max(...pk)).toBeCloseTo(1);
    const b = audio.ctx.createBuffer(1, 4, 1000);
    b.getChannelData(0).set([0, 0.5, -0.25, 0]);
    expect([...computePeaks(b, 2)]).toEqual([1, 0.5]);
  });
});

describe('sound clips on the song', () => {
  it('places a sound on a track; its length follows the tempo', async () => {
    const s = await importOne(); // 1.5 s
    const t = project.song.tracks[0];
    const c = S.addSoundClip(t.id, s.id, 8.6);
    expect(c).toMatchObject({ trackId: t.id, soundId: s.id, start: 8 }); // snapped down to the beat
    expect(clipLength(c)).toBeCloseTo(3); // 1.5 s at 120 bpm
    project.bpm = 60;
    expect(clipLength(c)).toBeCloseTo(1.5);
    expect(songLength()).toBeGreaterThanOrEqual(9.5);
    expect(ui.songSel.has(c.id)).toBe(true);
  });

  it('copies, pastes and duplicates sound clips as sound clips', async () => {
    const s = await importOne();
    const c = S.addSoundClip(project.song.tracks[0].id, s.id, 0);
    S.duplicateSelectedClips();
    const dup = project.song.clips.find((x) => x.soundId === s.id && x.id !== c.id);
    expect(dup.start).toBe(4); // after the 3-beat clip, rounded up to the next bar
    ui.songSel = new Set([c.id]);
    S.copySelectedClips();
    const made = S.pasteClips({ at: 16, lane: 0 });
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ soundId: s.id, start: 16 });
    expect(made[0].patternId).toBeUndefined();
  });

  it('deleting a sound removes its clips (undoable)', async () => {
    const s = await importOne();
    S.addSoundClip(project.song.tracks[0].id, s.id, 0);
    SND.deleteSound(s.id);
    expect(project.sounds).toHaveLength(0);
    expect(project.song.clips.some((c) => c.soundId === s.id)).toBe(false);
    undo();
    expect(soundById(s.id)).toBeTruthy();
    expect(project.song.clips.some((c) => c.soundId === s.id)).toBe(true);
  });

  it('is left out of MIDI', async () => {
    const s = await importOne();
    project.song.clips = [];
    S.addSoundClip(project.song.tracks[0].id, s.id, 0);
    expect(playedLayers('song')).toEqual([]);
    expect(buildSong('song').tracks).toEqual([]);
  });
});

describe('playing sound clips', () => {
  it('starts the buffer at the clip, through the track’s chain at the sound’s volume', async () => {
    const s = await importOne();
    s.vol = 0.5;
    project.song.clips = [];
    S.addSoundClip(project.song.tracks[0].id, s.id, 4);
    clock.t = 0;
    startTransport(0, { song: true });
    clock.t = 60;
    schedule();
    const [src] = sources();
    expect(src.buffer.duration).toBeCloseTo(1.5);
    expect(src.started[0]).toBeCloseTo(0.15 + 4 * 0.5); // t0 + 4 beats
    expect(src.started[1]).toBe(0);
    const gain = src.out[0];
    expect(gain.gain.value).toBe(0.5);
  });

  it('a truncated sound clip starts later in the audio and stops early', async () => {
    const s = await importOne(); // 3 beats long
    project.song.clips = [];
    const c = S.addSoundClip(project.song.tracks[0].id, s.id, 2);
    S.setClipEdges(c, 3, 4); // play beat 1→2 of the sound, at song beat 3
    clock.t = 0;
    startTransport(0, { song: true });
    clock.t = 60;
    schedule();
    const [src] = sources();
    expect(src.started[0]).toBeCloseTo(0.15 + 3 * 0.5);
    expect(src.started[1]).toBeCloseTo(0.5); // 1 beat into the audio
    expect(src.started[2]).toBeCloseTo(0.5); // for 1 beat
  });

  it('starting part-way through a sound plays it from that point', async () => {
    const s = await importOne(); // 3 beats long
    project.song.clips = [];
    S.addSoundClip(project.song.tracks[0].id, s.id, 2);
    clock.t = 0;
    startTransport(3, { song: true });
    const [src] = sources();
    expect(src.started[0]).toBeCloseTo(0.15);
    expect(src.started[1]).toBeCloseTo(0.5); // one beat in = 0.5 s
    clock.t = 60;
    schedule();
    expect(sources()).toHaveLength(1); // not started twice
  });

  it('muted tracks and sounds without audio stay silent', async () => {
    const s = await importOne();
    project.song.clips = [];
    S.addSoundClip(project.song.tracks[0].id, s.id, 0);
    project.song.tracks[0].mute = true;
    startTransport(0, { song: true });
    clock.t = 60;
    schedule();
    expect(sources()).toHaveLength(0);
  });

  it('schedules every clip for a whole-song render', async () => {
    const s = await importOne();
    project.song.clips = [];
    S.addSoundClip(project.song.tracks[0].id, s.id, 0);
    S.addSoundClip(project.song.tracks[0].id, s.id, 8);
    const dests = [];
    const graph = { soundDest: (st, snd) => { const g = audio.ctx.createGain(); dests.push([st.id, snd.id]); return g; } };
    const started = scheduleSoundClips(audio.ctx, graph, -Infinity, Infinity, (b) => 1 + b * 0.5, 0.5);
    expect(started.map((x) => x.started[0])).toEqual([1, 5]);
  });
});

describe('saving and loading sounds', () => {
  it('keeps sound metadata in the project and drops clips of unknown sounds', async () => {
    const s = await importOne();
    S.addSoundClip(project.song.tracks[0].id, s.id, 0);
    const data = JSON.parse(serialize());
    expect(data.sounds[0]).toMatchObject({ id: s.id, key: s.key, name: 'boom' });
    data.song.clips.push({ id: 999, trackId: project.song.tracks[0].id, soundId: 12345, start: 0 });
    loadProjectData(data);
    expect(project.sounds[0].key).toBe(s.key);
    expect(project.song.clips.some((c) => c.soundId === s.id)).toBe(true);
    expect(project.song.clips.some((c) => c.soundId === 12345)).toBe(false);
  });

  it('embeds the audio as base64 and restores it from a saved file', async () => {
    const s = await importOne('x.wav', 900);
    const embedded = await SND.soundDataForSave();
    expect(Object.keys(embedded)).toEqual([s.key]);
    const bytes = new Uint8Array(SND.fromBase64(embedded[s.key]));
    expect(bytes.length).toBe(900);
    expect(bytes[0]).toBe(200);
    // a file from elsewhere: a sound this browser has never seen
    const data = JSON.parse(serialize());
    data.sounds[0].key = 'from-another-browser';
    loadProjectData(data);
    await SND.storeEmbeddedSounds({ 'from-another-browser': embedded[s.key], 'not-in-project': 'AAAA' });
    expect(SND.soundState.ready[s.id]).toBe(true);
    expect(SND.soundBuffer(s.id).duration).toBeCloseTo(0.9);
    expect(await getSoundBytes('not-in-project')).toBeNull();
  });

  it('flags sounds whose audio is missing', async () => {
    const s = await importOne();
    const data = JSON.parse(serialize());
    data.sounds[0].key = 'nowhere';
    loadProjectData(data);
    await SND.storeEmbeddedSounds(undefined);
    expect(SND.soundState.missing[s.id]).toBe(true);
    expect(SND.soundState.ready[s.id]).toBeUndefined();
  });

  it('base64 round-trips large binary data', () => {
    const u8 = new Uint8Array(100000).map((_, i) => (i * 7) % 256);
    expect(new Uint8Array(SND.fromBase64(SND.toBase64(u8.buffer)))).toEqual(u8);
  });
});
