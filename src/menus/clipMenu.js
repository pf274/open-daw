/** Right-click menu for clips in the Song view (rendered by MenuList.vue; see noteMenu.js for item shapes). */
import { project } from '../stores/project.js';
import { ui } from '../stores/ui.js';
import { editPattern, makeClipUnique, duplicateSelectedClips, deleteSelectedClips, selectAllClips, copySelectedClips, cutSelectedClips, pasteClips, untrimSelectedClips, isTrimmed } from '../engine/song.js';
import { orderedTracks } from '../stores/project.js';

const selected = () => project.song.clips.filter((c) => ui.songSel.has(c.id));
const one = () => selected().length === 1;
const has = () => selected().length > 0;
const onePattern = () => one() && selected()[0].soundId == null; // sound clips have no pattern to edit

export function buildClipMenu() {
  return [
    { header: () => (ui.songSel.size === 0 ? 'No clips selected' : ui.songSel.size === 1 ? '1 clip selected' : `${ui.songSel.size} clips selected`) },
    { label: 'Copy', keys: 'Ctrl+C', run: copySelectedClips, enabled: has },
    { label: 'Cut', keys: 'Ctrl+X', run: cutSelectedClips, enabled: has },
    { label: 'Paste here', keys: 'Ctrl+V', enabled: () => !!ui.clipClipboard?.clips.length,
      title: () => 'Paste the copied clips at this spot, starting on this track',
      run: () => pasteClips({ at: ui.ctxMenu.beat, lane: Math.max(0, orderedTracks().findIndex((t) => t.id === ui.ctxMenu.trackId)) }) },
    null,
    { label: 'Edit pattern', keys: 'double-click', run: () => editPattern(selected()[0].patternId), enabled: onePattern },
    { label: 'Make unique', run: () => makeClipUnique(selected()[0].id), enabled: onePattern,
      title: () => 'Give this clip its own copy of the pattern, so you can change it without affecting the others' },
    { label: 'Restore full length', run: untrimSelectedClips, enabled: () => selected().some(isTrimmed),
      title: () => 'Undo truncating: play the whole pattern or sound again' },
    null,
    { label: 'Duplicate', keys: 'Ctrl+D', run: duplicateSelectedClips, enabled: has },
    { label: 'Delete', keys: 'Del', run: deleteSelectedClips, enabled: has },
    null,
    { label: 'Select all clips', keys: 'Ctrl+A', run: selectAllClips, enabled: () => project.song.clips.length > 0 },
  ];
}
