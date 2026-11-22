import { describe, it, expect, vi, beforeEach } from 'vitest';

// capture voices instead of making sound; a controllable audio clock
const voices = [];
const clock = { t: 0 };
vi.mock('../src/audio/synth.js', () => ({ playVoice: (...a) => voices.push(a), click: vi.fn() }));
vi.mock('../src/audio/mixer.js', () => ({ busFor: (id) => ({ id }), silenceAll: vi.fn() }));
const audio = {}; // the fake context + master, shared with tests that inspect the song graph
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

const P = await import('../src/stores/project.js');
const { project, resetProject, curPattern, setCurPattern, patternLength, songLength, serialize, loadProjectData, addTrack } = P;
const { ui } = await import('../src/stores/ui.js');
const { undo, redo, clearHistory } = await import('../src/stores/history.js');
const S = await import('../src/engine/song.js');
const { startTransport, stopTransport, schedule, transport } = await import('../src/engine/transport.js');
const { buildSong, playedLayers, exportFileName } = await import('../src/engine/files.js');

const note = (id, start, dur, pitch) => ({ id, start, dur, pitch, vel: 90 });

beforeEach(() => {
  stopTransport();
  resetProject();
  clearHistory();
  ui.view = 'pattern';
  ui.songSel = new Set();
  voices.length = 0;
  project.bpm = 120; // 0.5 s per beat
});

describe('project model', () => {
  it('starts with one pattern placed at bar 1 of a 4-track song', () => {
    expect(project.patterns).toHaveLength(1);
    expect(project.song.tracks.map((t) => t.name)).toEqual(['Track 1', 'Track 2', 'Track 3', 'Track 4']);
    expect(project.song.clips).toEqual([{ id: expect.any(Number), trackId: project.song.tracks[0].id, patternId: project.patterns[0].id, start: 0 }]);
    expect(new Set(project.song.tracks.map((t) => t.color)).size).toBe(4); // distinct colours
  });

  it('project.tracks is the open pattern’s layers; switching remembers each pattern’s selected layer', () => {
    const a = curPattern();
    addTrack('Bass', 'bass');
    const bassId = project.sel;
    const b = S.newPattern();
    expect(b.layers.map((l) => l.name)).toEqual(['Melody', 'Bass']); // same instruments…
    expect(b.layers.every((l) => l.notes.length === 0)).toBe(true); // …no notes
    expect(b.layers[0].id).not.toBe(a.layers[0].id); // fresh ids
    setCurPattern(b.id);
    expect(project.tracks).toBe(curPattern().layers);
    expect(project.tracks.map((l) => l.id)).toEqual(b.layers.map((l) => l.id));
    project.tracks.push({ ...b.layers[0], id: P.nid() }); // writes go to the open pattern
    expect(curPattern().layers).toHaveLength(3);
    expect(a.layers).toHaveLength(2);
    setCurPattern(a.id);
    expect(project.sel).toBe(bassId);
  });

  it('pattern length is its notes rounded up to whole bars (min 1 bar); song length spans the clips', () => {
    const p = curPattern();
    expect(patternLength(p)).toBe(4);
    p.layers[0].notes = [note(1, 0, 1, 60), note(2, 4.5, 1, 62)];
    expect(patternLength(p)).toBe(8);
    S.addClip(project.song.tracks[1].id, p.id, 16);
    expect(songLength()).toBe(24);
  });
});

describe('patterns, tracks and clips (all undoable)', () => {
  it('duplicate copies notes with fresh ids and keeps slides inside the copy', () => {
    const p = curPattern();
    p.layers[0].notes = [{ ...note(1, 0, 1, 60), slideTo: 2 }, note(2, 1, 1, 64)];
    const d = S.duplicatePattern(p.id);
    expect(d.name).toBe('Pattern 1 copy');
    const [n1, n2] = d.layers[0].notes;
    expect(n1.slideTo).toBe(n2.id);
    expect(n1.id).not.toBe(1);
    d.layers[0].notes[0].pitch = 70;
    expect(p.layers[0].notes[0].pitch).toBe(60); // independent
  });

  it('custom synth patches are copied, not shared, between patterns', () => {
    const l = curPattern().layers[0];
    l.inst = 'custom';
    l.synth = { wave: 'square', filters: [{ type: 'lowpass', freq: 500, env: { mode: 'off' } }] };
    const b = S.newPattern();
    b.layers[0].synth.filters[0].freq = 900;
    expect(l.synth.filters[0].freq).toBe(500);
  });

  it('deleting a pattern removes its clips; the last pattern cannot be deleted', () => {
    const a = curPattern();
    expect(S.deletePattern(a.id)).toBe(false);
    const b = S.newPattern();
    S.addClip(project.song.tracks[0].id, b.id, 8);
    S.addClip(project.song.tracks[1].id, b.id, 0);
    expect(S.clipCount(b.id)).toBe(2);
    S.deletePattern(b.id);
    expect(project.patterns.map((p) => p.id)).toEqual([a.id]);
    expect(project.song.clips.every((c) => c.patternId === a.id)).toBe(true);
    undo();
    expect(S.clipCount(b.id)).toBe(2);
  });

  it('clips snap down to the song grid (1 beat by default); duplicate goes right after the selection; delete; undo/redo', () => {
    const t = project.song.tracks[2].id, p = project.patterns[0].id;
    expect(ui.songSnap).toBe(1);
    expect(S.addClip(t, p, 9.4).start).toBe(9); // 1 beat
    ui.songSnap = 0.5;
    expect(S.addClip(t, p, 9.4).start).toBe(9); // ½ beat
    ui.songSnap = 0.25;
    expect(S.addClip(t, p, 9.6).start).toBe(9.5); // ¼ beat
    ui.songSnap = 0;
    expect(S.addClip(t, p, 9.4).start).toBeCloseTo(9.375, 9); // off: 1/32-beat resolution
    ui.songSnap = 'bar';
    const c = S.addClip(t, p, 9.4);
    expect(c.start).toBe(8);
    ui.songSnap = 1;
    expect([...ui.songSel]).toEqual([c.id]);
    S.duplicateSelectedClips();
    const copy = project.song.clips.at(-1);
    expect(copy).toMatchObject({ trackId: t, patternId: p, start: 12 }); // whole bars after
    S.deleteSelectedClips();
    expect(project.song.clips.some((x) => x.id === copy.id)).toBe(false);
    undo();
    expect(project.song.clips.some((x) => x.id === copy.id)).toBe(true);
    redo();
    expect(project.song.clips.some((x) => x.id === copy.id)).toBe(false);
  });

  it('removing a song track removes its clips (but never the last track)', () => {
    const [t1] = project.song.tracks;
    S.removeSongTrack(t1.id);
    expect(project.song.clips).toHaveLength(0);
    while (project.song.tracks.length > 1) S.removeSongTrack(project.song.tracks[0].id);
    expect(S.removeSongTrack(project.song.tracks[0].id)).toBe(false);
  });

  it('“Make unique” gives one clip its own copy of the pattern', () => {
    const p = curPattern();
    p.layers[0].notes = [note(1, 0, 1, 60)];
    const second = S.addClip(project.song.tracks[1].id, p.id, 4);
    const v = S.makeClipUnique(second.id);
    expect(second.patternId).toBe(v.id);
    expect(project.song.clips[0].patternId).toBe(p.id);
    v.layers[0].notes[0].pitch = 72;
    expect(p.layers[0].notes[0].pitch).toBe(60);
  });

  it('edits in any pattern are undoable from anywhere', () => {
    const a = curPattern();
    const b = S.newPattern();
    S.editPattern(b.id);
    expect(ui.view).toBe('pattern');
    expect(curPattern().id).toBe(b.id);
    undo(); // undoes creating b
    expect(project.patterns.map((p) => p.id)).toEqual([a.id]);
    expect(curPattern().id).toBe(a.id);
  });
});

describe('save / load', () => {
  it('round-trips patterns and the song', () => {
    const b = S.duplicatePattern(project.patterns[0].id);
    b.name = 'Chorus';
    S.addClip(project.song.tracks[1].id, b.id, 8);
    project.song.tracks[1].name = 'Lead';
    project.song.tracks[1].color = '#123456';
    const json = serialize();
    resetProject();
    loadProjectData(JSON.parse(json));
    expect(project.patterns.map((p) => p.name)).toEqual(['Pattern 1', 'Chorus']);
    expect(project.song.tracks[1]).toMatchObject({ name: 'Lead', color: '#123456' });
    expect(project.song.clips.find((c) => c.start === 8).patternId).toBe(project.patterns[1].id);
  });

  it('loads an old single-pattern file into a pattern placed at bar 1', () => {
    loadProjectData({ version: 2, bpm: 90, sel: 7, uid: 20, tracks: [{ id: 7, name: 'Old lead', inst: 'piano', vol: 1, mute: false, solo: false, color: '#fff', notes: [note(8, 0, 1, 60)] }] });
    expect(project.patterns).toHaveLength(1);
    expect(project.tracks[0].name).toBe('Old lead');
    expect(project.song.clips).toEqual([expect.objectContaining({ patternId: project.patterns[0].id, start: 0 })]);
    expect(project.sel).toBe(7);
    expect(P.nid()).toBeGreaterThan(20); // never reuses ids from the file
  });

  it('drops clips that point at missing tracks or patterns', () => {
    const data = JSON.parse(serialize());
    data.song.clips.push({ id: 999, trackId: 123456, patternId: data.patterns[0].id, start: 0 });
    data.song.clips.push({ id: 998, trackId: data.song.tracks[0].id, patternId: 654321, start: 0 });
    loadProjectData(data);
    expect(project.song.clips).toHaveLength(1);
  });
});

describe('song playback', () => {
  function playSong() {
    clock.t = 0;
    startTransport(0, { song: true });
    clock.t = 60; // jump ahead so one schedule() pass covers the whole song
    schedule();
    stopTransport();
  }

  it('plays each clip’s pattern at the clip’s position', () => {
    const p = curPattern();
    p.layers[0].notes = [note(1, 0, 1, 60), note(2, 2, 1, 64)];
    S.addClip(project.song.tracks[1].id, p.id, 8);
    playSong();
    expect(transport.mode).toBe('song');
    // t0 = 0.15 s; 0.5 s per beat; clips at beats 0 and 8
    expect(voices.map((v) => [v[2], +v[3].toFixed(3)]).sort((a, b) => a[1] - b[1])).toEqual([[60, 0.15], [64, 1.15], [60, 4.15], [64, 5.15]]);
  });

  it('respects song-track mute/solo and pattern layer mute', () => {
    const p = curPattern();
    p.layers[0].notes = [note(1, 0, 1, 60)];
    addTrack('Bass', 'bass').notes = [note(2, 0, 1, 36)];
    S.addClip(project.song.tracks[1].id, p.id, 4);
    project.song.tracks[0].mute = true;
    playSong();
    expect(voices.map((v) => +v[3].toFixed(2))).toEqual([2.15, 2.15]); // only the bar-2 clip
    voices.length = 0;
    project.song.tracks[0].mute = false;
    project.song.tracks[1].solo = true;
    p.layers[1].mute = true;
    playSong();
    expect(voices.map((v) => v[2])).toEqual([60]);
  });

  it('truncated clips play only their visible part, in place; untrim restores; saved and loaded', () => {
    const p = curPattern();
    p.layers[0].notes = [note(1, 0, 1, 60), note(2, 2, 1, 62), note(3, 4, 1, 64), note(4, 6, 1, 65)]; // 2 bars
    project.song.clips = [];
    const c = S.addClip(project.song.tracks[0].id, p.id, 8);
    S.setClipEdges(c, 10, 14); // cut 2 beats off the start and 2 off the end
    expect(c).toMatchObject({ start: 10, trim: 2, len: 4 });
    expect(P.clipLength(c)).toBe(4);
    expect(songLength()).toBe(14);
    playSong();
    expect(voices.map((v) => [v[2], +v[3].toFixed(2)]).sort((a, b) => a[1] - b[1])).toEqual([[62, 5.15], [64, 6.15]]); // beats 10, 12: same place as before
    expect(buildSong('song').tracks[0].notes.map((n) => [n.start, n.pitch])).toEqual([[10, 62], [12, 64]]);

    S.setClipEdges(c, 0, 99); // can't grow past the pattern itself
    expect(c).toMatchObject({ start: 8 });
    expect(c.trim).toBeUndefined();
    expect(c.len).toBeUndefined();
    S.setClipEdges(c, 8, 12);
    loadProjectData(JSON.parse(serialize()));
    expect(project.song.clips[0]).toMatchObject({ start: 8, len: 4 });
    expect(project.song.clips[0].trim).toBeUndefined();
    ui.songSel = new Set([project.song.clips[0].id]);
    S.untrimSelectedClips();
    expect(P.clipLength(project.song.clips[0])).toBe(8);
    undo();
    expect(P.clipLength(project.song.clips[0])).toBe(4);
  });

  it('copy/paste and duplicate keep a clip’s truncation', () => {
    project.song.clips = [];
    curPattern().layers[0].notes = [note(1, 0, 1, 60), note(2, 6, 1, 62)];
    const c = S.addClip(project.song.tracks[0].id, curPattern().id, 0);
    S.setClipEdges(c, 1, 5);
    S.copySelectedClips();
    const [pasted] = S.pasteClips({ at: 16 });
    expect(pasted).toMatchObject({ start: 16, trim: 1, len: 4 });
    S.duplicateSelectedClips();
    expect(project.song.clips.at(-1)).toMatchObject({ trim: 1, len: 4 });
  });

  it('song sections fit into free space, are saved, and undo', () => {
    const a = S.addSection(0, 16);
    expect(a).toMatchObject({ name: 'Intro', start: 0, end: 16 });
    const b = S.addSection(8, 40); // starts inside "Intro": refused
    expect(b).toBeNull();
    const v = S.addSection(16, 48);
    expect(v.name).toBe('Verse');
    S.addSection(60, 64);
    expect(S.addSection(50, 80)).toMatchObject({ start: 50, end: 60 }); // clipped to the next section
    loadProjectData(JSON.parse(serialize()));
    expect(project.song.sections.map((x) => [x.name, x.start, x.end])).toEqual([['Intro', 0, 16], ['Verse', 16, 48], ['Chorus', 60, 64], ['Verse', 50, 60]]);
    S.removeSection(project.song.sections[0].id);
    expect(project.song.sections).toHaveLength(3);
    undo();
    expect(project.song.sections).toHaveLength(4);
  });

  it('Restart puts the open view’s playhead at the beginning; while playing it plays on from there', async () => {
    const { restartTransport } = await import('../src/engine/transport.js');
    ui.view = 'song';
    ui.songPlayhead = 12;
    ui.playhead = 5;
    restartTransport();
    expect(ui.songPlayhead).toBe(0);
    expect(ui.playhead).toBe(5); // the pattern's own playhead is left alone
    expect(transport.playing).toBe(false); // stopped stays stopped

    curPattern().layers[0].notes = [note(1, 0, 1, 60)];
    clock.t = 0;
    startTransport(6, { song: true });
    clock.t = 1;
    voices.length = 0;
    restartTransport();
    expect(transport.playing).toBe(true);
    clock.t = 60;
    schedule();
    expect(voices.map((v) => v[2])).toContain(60); // the clip at beat 0 plays again
    stopTransport();
    expect(ui.songPlayhead).toBe(0); // and stopping returns to the start, not to beat 6

    ui.view = 'pattern';
    ui.playhead = 7;
    ui.scrollX = 3;
    restartTransport();
    expect([ui.playhead, ui.scrollX]).toEqual([0, 0]);
  });

  it('starting mid-song only plays what’s ahead; the song playhead is separate from the pattern’s', () => {
    curPattern().layers[0].notes = [note(1, 0, 1, 60)];
    S.addClip(project.song.tracks[1].id, curPattern().id, 8);
    ui.playhead = 3;
    clock.t = 0;
    startTransport(6, { song: true });
    clock.t = 60;
    schedule();
    stopTransport();
    expect(voices.map((v) => +v[3].toFixed(2))).toEqual([1.15]); // beat 8 → (8 - 6) × 0.5 + 0.15
    expect(ui.songPlayhead).toBe(6);
    expect(ui.playhead).toBe(3);
  });
});

describe('song export', () => {
  it('MIDI groups layers by instrument across patterns and offsets notes by clip position', () => {
    const a = curPattern();
    a.layers[0].notes = [note(1, 0, 1, 60)]; // flute
    const drums = addTrack('Beat', 'drums');
    drums.notes = [note(2, 0, 0.25, 36)];
    const b = S.duplicatePattern(a.id);
    b.layers[0].notes[0].pitch = 67;
    S.addClip(project.song.tracks[1].id, b.id, 4);
    const song = buildSong('song');
    expect(song.tracks.map((t) => [t.name, t.drums, t.notes.length])).toEqual([['Melody', false, 2], ['Drums', true, 2]]);
    expect(song.tracks[0].notes.map((n) => [n.start, n.pitch])).toEqual([[0, 60], [4, 67]]);
    expect(exportFileName('song')).toBe('whistle-song.mid');
    expect(buildSong('pattern').tracks.map((t) => t.name)).toEqual(['Melody', 'Beat']); // pattern export unchanged
  });

  it('scope follows the open view', () => {
    S.addClip(project.song.tracks[1].id, curPattern().id, 4);
    curPattern().layers[0].notes = [note(1, 0, 1, 60)];
    ui.view = 'song';
    expect(playedLayers().map((x) => x.offset)).toEqual([0, 4]);
    ui.view = 'pattern';
    expect(playedLayers().map((x) => x.offset)).toEqual([0]);
  });
});

describe('views', () => {
  it('switching views stops playback; recording is refused in the Song view', async () => {
    const { startRecording } = await import('../src/engine/recorder.js');
    S.setView('song');
    clock.t = 0;
    startTransport(0, { song: true });
    S.setView('pattern');
    expect(transport.playing).toBe(false);
    S.setView('song');
    await startRecording(true);
    expect(transport.recording).toBe(false);
    expect(ui.status.msg).toMatch(/Recording goes into a pattern/);
  });
});

describe('tapping rhythm', () => {
  const tapAt = async (ms) => {
    const { onTapDown, onTapUp } = await import('../src/engine/recorder.js');
    onTapDown({ key: 'j', code: 'KeyJ', timeStamp: ms, repeat: false });
    onTapUp({ key: 'j', code: 'KeyJ', timeStamp: ms + 100 });
  };
  // 100 BPM: 600 ms per beat; recording starts 150 ms after the clock, then a 4-beat count-in
  const T0 = 150 + 4 * 600;

  it('adds the tapped notes to the layer (existing notes stay, and play along), counting taps in the count-in', async () => {
    const { startRecording } = await import('../src/engine/recorder.js');
    const { pick, exitPick } = await import('../src/engine/pick.js');
    const tr = curPattern().layers[0];
    tr.notes = [note(1, 1, 1, 64), note(2, 4.5, 0.5, 67)];
    ui.view = 'pattern';
    project.bpm = 100;
    ui.countIn = 4;
    ui.playhead = 4;
    clock.t = 0;
    await startRecording(true);
    expect(transport.recording).toBe(true);
    voices.length = 0;
    clock.t = 3.4;
    schedule();
    expect(voices.some((v) => v[2] === 67)).toBe(true); // the layer's own notes still play while tapping
    await tapAt(T0 - 600); // in the count-in, one beat early: a pickup at beat 3
    await tapAt(T0);       // beat 4
    await tapAt(T0 + 600); // beat 5
    stopTransport();
    const starts = tr.notes.map((n) => +n.start.toFixed(3));
    expect(starts).toEqual([1, 3, 4, 4.5, 5]);
    expect(tr.notes.find((n) => n.id === 2)).toMatchObject({ start: 4.5, pitch: 67 }); // untouched
    expect(pick.active).toBe(true); // then choose the new notes' pitches
    exitPick();
    undo();
    expect(curPattern().layers[0].notes.map((n) => n.id)).toEqual([1, 2]); // one undo step (undo restores fresh layer objects)
  });

  it('a recording tempo slows the count-in and playback, and the notes still land on the song\'s beats', async () => {
    const { startRecording } = await import('../src/engine/recorder.js');
    const { exitPick } = await import('../src/engine/pick.js');
    const tr = curPattern().layers[0];
    tr.notes = [note(1, 6, 1, 67)];
    ui.view = 'pattern';
    project.bpm = 100;
    project.settings.recTempo = 50; // half speed: 1200 ms per beat
    ui.countIn = 4;
    ui.playhead = 4;
    clock.t = 0;
    await startRecording(true);
    expect(ui.status.msg).toMatch(/^50 BPM \(song: 100\)/);
    voices.length = 0;
    clock.t = 0.15 + 4 * 1.2 + 2 * 1.2 - 0.1; // just before beat 6, at half speed
    schedule();
    expect(voices.find((v) => v[2] === 67)?.[3]).toBeCloseTo(0.15 + 6 * 1.2, 3); // the layer plays at the slower tempo
    const T0 = 150 + 4 * 1200;
    await tapAt(T0); await tapAt(T0 + 1200); await tapAt(T0 + 1800); // beats 4, 5, 5.5
    stopTransport();
    expect(tr.notes.map((n) => +n.start.toFixed(3))).toEqual([4, 5, 5.5, 6]);
    expect(project.bpm).toBe(100); // the song's tempo is untouched
    exitPick();
    project.settings.recTempo = 0;
    clock.t = 0;
    startTransport(0);
    stopTransport();
  });

  it('count-in taps before the start of the pattern are left out, with a note saying so', async () => {
    const { startRecording } = await import('../src/engine/recorder.js');
    const { exitPick } = await import('../src/engine/pick.js');
    const tr = curPattern().layers[0];
    tr.notes = [];
    ui.view = 'pattern';
    project.bpm = 100;
    ui.countIn = 4;
    ui.playhead = 0;
    clock.t = 0;
    await startRecording(true);
    await tapAt(T0 - 1200); // two beats before beat 0
    await tapAt(T0);
    stopTransport();
    expect(tr.notes.map((n) => n.start)).toEqual([0]);
    expect(ui.status.msg).toMatch(/1 tap before the start of the pattern was left out/);
    exitPick();
  });
});

describe('time signature', () => {
  it('regroups bars without moving notes: pattern lengths, snap, duplicates, undo', async () => {
    const { setTimeSig } = await import('../src/engine/editing.js');
    const p = curPattern();
    p.layers[0].notes = [note(1, 0, 1, 60), note(2, 3, 2, 62)]; // ends at beat 5
    expect(patternLength(p)).toBe(8); // 2 bars of 4/4
    setTimeSig({ num: 3, den: 4 });
    expect(patternLength(p)).toBe(6); // 2 bars of 3/4
    expect(p.layers[0].notes.map((n) => n.start)).toEqual([0, 3]); // notes untouched
    setTimeSig({ num: 7, den: 8 });
    expect(P.barLen()).toBe(3.5);
    expect(patternLength(p)).toBe(7);
    ui.songSnap = 1; // one counted beat = an eighth note in 7/8
    expect(S.addClip(project.song.tracks[1].id, p.id, 4.3).start).toBeCloseTo(4, 9);
    ui.songSnap = 'bar';
    expect(S.addClip(project.song.tracks[1].id, p.id, 4.3).start).toBeCloseTo(3.5, 9);
    S.duplicateSelectedClips();
    expect(project.song.clips.at(-1).start).toBeCloseTo(10.5, 9); // 2 whole bars later: same beat of the bar
    ui.songSnap = 1;
    undo(); undo(); undo(); undo(); // duplicate, two clips, 7/8
    expect(project.timeSig).toEqual({ num: 3, den: 4 });
  });

  it('metronome clicks each counted beat and accents bar lines; count-in counts those beats', async () => {
    const { setTimeSig } = await import('../src/engine/editing.js');
    const synth = await import('../src/audio/synth.js');
    setTimeSig({ num: 6, den: 8 });
    ui.metronome = true;
    synth.click.mockClear(); // ignore clicks from earlier tests
    clock.t = 0;
    startTransport(0);
    clock.t = 1.6; // 0.5 s per quarter → beats 0 … 3.6 scheduled
    schedule();
    stopTransport();
    const clicks = synth.click.mock.calls.map(([t, accent]) => [+((t - 0.15) / 0.5).toFixed(3), accent]);
    expect(clicks.slice(0, 7)).toEqual([[0, true], [0.5, false], [1, false], [1.5, false], [2, false], [2.5, false], [3, true]]);
  });

  it('is saved, loaded, written to MIDI and defaults to 4/4 for old files', async () => {
    const { setTimeSig } = await import('../src/engine/editing.js');
    const { writeMidi } = await import('../src/core/midi.js');
    setTimeSig({ num: 6, den: 8 });
    const json = serialize();
    resetProject();
    expect(project.timeSig).toEqual({ num: 4, den: 4 });
    loadProjectData(JSON.parse(json));
    expect(project.timeSig).toEqual({ num: 6, den: 8 });
    curPattern().layers[0].notes = [note(1, 0, 1, 60)];
    const bytes = writeMidi(buildSong('pattern'));
    const at = [...bytes].findIndex((b, i) => b === 0xff && bytes[i + 1] === 0x58);
    expect([...bytes.slice(at, at + 7)]).toEqual([0xff, 0x58, 4, 6, 3, 24, 8]); // 6/8 = 6, log2(8)
    const old = JSON.parse(json);
    delete old.timeSig;
    loadProjectData(old);
    expect(project.timeSig).toEqual({ num: 4, den: 4 });
  });
});

describe('song playback with automation', () => {
  it('voices on an automated track play through its effect chain; other tracks bypass it', async () => {
    const A = await import('../src/engine/automation.js');
    const p = curPattern();
    p.layers[0].notes = [note(1, 0, 1, 60)];
    S.addClip(project.song.tracks[1].id, p.id, 4);
    const lp = A.addAutomation('lowpass'); // targets track 1 only
    A.addPoint(lp, 0, 1);
    A.addPoint(lp, 4, 0.2);
    clock.t = 0;
    startTransport(0, { song: true });
    clock.t = 60;
    schedule();
    const [v1, v2] = voices.sort((a, b) => a[3] - b[3]);
    const pathTo = (dest) => { const out = []; let n = dest; while (n && n !== audio.master) { out.push(n.kind === 'filter' ? n.type : n.kind); n = n.out[0]; } return out; };
    expect(pathTo(v1[0])).toEqual(['gain', 'gain', 'lowpass']); // layer gain → track input → lowpass → master
    expect(pathTo(v2[0])).toEqual(['gain', 'gain']); // track 2: no automation
    const filter = audio.ctx.nodes.filter((n) => n.kind === 'filter' && n.type === 'lowpass').at(-1);
    expect(filter.frequency.events.some(([m]) => m === 'setValueCurveAtTime')).toBe(true);
    stopTransport();
    expect(filter.out).toBeDefined(); // disposed graph no longer needed
  });
});

describe('clip clipboard', () => {
  it('copy keeps the arrangement; paste lands at the playhead on the same tracks and moves the playhead on', () => {
    const p = curPattern(); // 1 bar long
    const [t1, t2] = project.song.tracks;
    const second = S.addClip(t2.id, p.id, 4); // Track 1 @0, Track 2 @4
    ui.songSel = new Set([project.song.clips[0].id, second.id]);
    S.copySelectedClips();
    ui.songPlayhead = 16;
    const made = S.pasteClips();
    expect(made.map((c) => [c.trackId, c.start])).toEqual([[t1.id, 16], [t2.id, 20]]);
    expect(ui.songPlayhead).toBe(24); // end of the pasted block (8 beats long)
    expect([...ui.songSel]).toEqual(made.map((c) => c.id));
    const again = S.pasteClips();
    expect(again.map((c) => c.start)).toEqual([24, 28]); // laid end to end
    undo();
    expect(project.song.clips).toHaveLength(4);
  });

  it('cut removes the originals; paste can target another track; blocks stay on existing tracks', () => {
    const p = curPattern();
    const tracks = project.song.tracks;
    S.addClip(tracks[1].id, p.id, 4);
    ui.songSel = new Set(project.song.clips.map((c) => c.id)); // Track 1 + Track 2
    S.cutSelectedClips();
    expect(project.song.clips).toHaveLength(0);
    const made = S.pasteClips({ at: 8, lane: 3 }); // top would be Track 4: shifted up so both fit
    expect(made.map((c) => c.trackId)).toEqual([tracks[2].id, tracks[3].id]);
    expect(made.map((c) => c.start)).toEqual([8, 12]);
  });

  it('copied clips whose pattern was deleted are skipped; nothing copied = nothing pasted', () => {
    ui.clipClipboard = null;
    expect(S.pasteClips()).toEqual([]);
    const b = S.newPattern();
    const c = S.addClip(project.song.tracks[0].id, b.id, 8);
    ui.songSel = new Set([c.id]);
    S.copySelectedClips();
    S.deletePattern(b.id);
    expect(S.pasteClips()).toEqual([]);
    expect(ui.status.msg).toMatch(/no longer exist/);
  });
});
