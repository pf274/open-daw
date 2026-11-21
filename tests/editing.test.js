import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// no Web Audio in node: stub the bridge that makes sound
vi.mock('../src/engine/mix.js', () => ({ audition: vi.fn(), applyMix: vi.fn(), trackBus: vi.fn() }));

const { project, resetProject, curTrack, addTrack, serialize, loadProjectData } = await import('../src/stores/project.js');
const { ui } = await import('../src/stores/ui.js');
const { undo, redo, clearHistory } = await import('../src/stores/history.js');
const { ACTIONS, paste, moveSelTo } = await import('../src/engine/editing.js');
const { pick, pickKeyDown, pickKeyUp } = await import('../src/engine/pick.js');
const { buildSong, exportFileName } = await import('../src/engine/files.js');

const key = (code, k = '') => ({ code, key: k, repeat: false, preventDefault() {} });
const pitches = () => curTrack().notes.map((n) => n.pitch);

function seed() {
  resetProject();
  clearHistory();
  ui.sel = new Set();
  ui.clipboard = null;
  ui.snap = 0.25;
  ui.playhead = 0;
  const tr = curTrack();
  tr.notes = [60, 62, 64, 65].map((p, i) => ({ id: 100 + i, start: i, dur: 1, pitch: p, vel: 90 }));
  return tr;
}

describe('editing actions', () => {
  beforeEach(seed);

  it('transposes the selection and undoes/redoes it', () => {
    ACTIONS.selAll();
    ACTIONS.transposeUp12();
    expect(pitches()).toEqual([72, 74, 76, 77]);
    undo();
    expect(pitches()).toEqual([60, 62, 64, 65]);
    redo();
    expect(pitches()).toEqual([72, 74, 76, 77]);
  });

  it('refuses to edit with nothing selected', () => {
    ACTIONS.transposeUp1();
    expect(pitches()).toEqual([60, 62, 64, 65]);
    expect(ui.status.warn).toBe(true);
  });

  it('duplicates after the selection, snapped to the grid', () => {
    ui.sel = new Set([100, 101]);
    ACTIONS.duplicate();
    expect(curTrack().notes.map((n) => n.start)).toEqual([0, 1, 2, 2, 3, 3]);
    expect(ui.sel.size).toBe(2);
  });

  it('cut + paste at a beat', () => {
    ui.sel = new Set([102, 103]);
    ACTIONS.cut();
    expect(pitches()).toEqual([60, 62]);
    paste(8);
    expect(curTrack().notes.slice(-2).map((n) => [n.start, n.pitch])).toEqual([[8, 64], [9, 65]]);
  });

  it('quantizes and stretches', () => {
    curTrack().notes[1].start = 1.1;
    ACTIONS.selAll();
    ACTIONS.quantize();
    expect(curTrack().notes[1].start).toBeCloseTo(1, 9);
    ACTIONS.double();
    expect(curTrack().notes.map((n) => n.start)).toEqual([0, 2, 4, 6]);
  });

  it('moves notes to another layer', () => {
    const other = addTrack('Bass', 'bass');
    project.sel = project.tracks[0].id;
    ui.sel = new Set([100]);
    moveSelTo(other.id);
    expect(pitches()).toEqual([62, 64, 65]);
    expect(project.tracks[1].notes.map((n) => n.pitch)).toEqual([60]);
  });
});

describe('pick mode ("change notes")', () => {
  beforeEach(() => { seed(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('keeps the rhythm; short press previews, hold confirms and advances', () => {
    ui.sel = new Set([100, 101]);
    ACTIONS.pick();
    expect(pick.active).toBe(true);
    expect(pick.base).toBe(60);

    pickKeyDown(key('KeyG', 'g')); // G4, released quickly → preview only
    pickKeyUp(key('KeyG'));
    vi.advanceTimersByTime(1000);
    expect(pick.i).toBe(0);
    expect(pitches()[0]).toBe(67);

    pickKeyDown(key('KeyD', 'd')); // E4 held → confirm
    vi.advanceTimersByTime(800);
    expect(pick.i).toBe(1);
    expect(pitches()[0]).toBe(64);

    pickKeyDown(key('KeyX', 'x')); // octave up
    pickKeyDown(key('KeyA', 'a')); // C5
    pickKeyDown(key('', 'Enter'));
    expect(pick.active).toBe(false);
    expect(pitches()).toEqual([64, 72, 64, 65]);
    expect(curTrack().notes.map((n) => n.start)).toEqual([0, 1, 2, 3]);

    undo(); // the whole session is one undo step
    expect(pitches()).toEqual([60, 62, 64, 65]);
  });

  it('uses drum pads on drum layers', () => {
    const drums = addTrack('Drums', 'drums');
    drums.notes = [{ id: 500, start: 0, dur: 0.25, pitch: 36, vel: 90 }];
    ui.sel = new Set([500]);
    ACTIONS.pick();
    pickKeyDown(key('KeyS', 's'));
    pickKeyDown(key('', 'Enter'));
    expect(project.tracks[1].notes[0].pitch).toBe(38);
  });
});

describe('transpose, export and persistence', () => {
  beforeEach(seed);

  it('exports transposed pitches but leaves notes and drums alone', () => {
    const drums = addTrack('Drums', 'drums');
    drums.notes = [{ id: 600, start: 0, dur: 0.25, pitch: 36, vel: 90 }];
    project.transpose = 3;
    const song = buildSong();
    expect(song.tracks[0].notes.map((n) => n.pitch)).toEqual([63, 65, 67, 68]);
    expect(song.tracks[1].notes[0].pitch).toBe(36);
    expect(song.tracks[1].drums).toBe(true);
    expect(project.tracks[0].notes.map((n) => n.pitch)).toEqual([60, 62, 64, 65]);
    expect(exportFileName()).toBe('whistle-melody-Eb.mid');
  });

  it('skips muted layers on export', () => {
    curTrack().mute = true;
    expect(buildSong().tracks).toHaveLength(0);
  });

  it('round-trips through serialize/load', () => {
    project.transpose = -2;
    project.settings.holdMs = 900;
    const json = serialize();
    resetProject();
    loadProjectData(JSON.parse(json));
    expect(project.transpose).toBe(-2);
    expect(project.settings.holdMs).toBe(900);
    expect(pitches()).toEqual([60, 62, 64, 65]);
  });
});
