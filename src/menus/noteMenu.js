/**
 * The piano-roll right-click menu, as data. MenuList.vue renders it.
 *
 * Item shapes:
 *   { label, keys?, run, enabled?, title? }        action (enabled/title are functions)
 *   { label, children, enabled? }                  submenu (children: array or function → array)
 *   { stepper: true, label, value, dec, inc, reset?, title? }   inline −/+ control (menu stays open)
 *   null                                           separator
 *   { header }                                     section caption (string or function)
 */
import { transposeLabel } from '../core/music.js';
import { project, curTrack } from '../stores/project.js';
import { ui, selNotes } from '../stores/ui.js';
import {
  ACTIONS, paste, transposeSel, moveSelTo, setVelocity, adjustVelocity, setSongTranspose,
  canConnectSel, hasSlidesSel, connectReason, canTremorSel,
} from '../engine/editing.js';

const hasSel = () => ui.sel.size > 0;
const hasNotes = () => curTrack().notes.length > 0;
const VELOCITIES = [['pp', 32], ['p', 48], ['mp', 64], ['mf', 80], ['f', 96], ['ff', 112], ['fff', 127]];

export function buildNoteMenu() {
  return [
    { header: () => (ui.sel.size ? `${ui.sel.size} note${ui.sel.size > 1 ? 's' : ''} selected` : 'No selection') },
    { label: 'Copy', keys: 'Ctrl+C', run: () => ACTIONS.copy(), enabled: hasSel },
    { label: 'Cut', keys: 'Ctrl+X', run: () => ACTIONS.cut(), enabled: hasSel },
    { label: 'Paste here', keys: 'Ctrl+V', run: () => paste(ui.ctxMenu.beat), enabled: () => !!ui.clipboard },
    { label: 'Duplicate', keys: 'Ctrl+D', run: () => ACTIONS.duplicate(), enabled: hasSel },
    { label: 'Delete', keys: 'Del', run: () => ACTIONS.delete(), enabled: hasSel },
    null,
    {
      label: 'Select',
      children: [
        { label: 'All', keys: 'Ctrl+A', run: () => ACTIONS.selAll(), enabled: hasNotes },
        { label: 'In loop region', run: () => ACTIONS.selLoop(), enabled: hasNotes },
        { label: 'From playhead', run: () => ACTIONS.selAfter(), enabled: hasNotes },
        { label: 'None', keys: 'Esc', run: () => ACTIONS.selNone(), enabled: hasSel },
      ],
    },
    {
      label: 'Transpose',
      children: () => [
        { header: 'Selected notes' },
        { label: 'Up a semitone', keys: '↑', run: () => transposeSel(1), enabled: hasSel },
        { label: 'Down a semitone', keys: '↓', run: () => transposeSel(-1), enabled: hasSel },
        { label: 'Up an octave', keys: 'Shift+↑', run: () => transposeSel(12), enabled: hasSel },
        { label: 'Down an octave', keys: 'Shift+↓', run: () => transposeSel(-12), enabled: hasSel },
        { label: 'Snap to scale', run: () => ACTIONS.scaleSnap(), enabled: hasSel, title: () => 'Uses Key + Scale lock from Settings' },
        null,
        { header: 'Whole song (playback & export only)' },
        {
          stepper: true,
          label: 'Song key',
          value: () => (project.transpose ? transposeLabel(project.transpose, +project.settings.scaleRoot || 0) : 'off'),
          dec: () => setSongTranspose(project.transpose - 1),
          inc: () => setSongTranspose(project.transpose + 1),
          reset: () => setSongTranspose(0),
          title: () => 'Notes stay as written; what you hear and export is shifted. Drums are never transposed.',
        },
      ],
    },
    {
      label: 'Timing',
      children: [
        { label: 'Quantize…', keys: 'Q repeats', run: () => ACTIONS.quantizeDialog(), enabled: hasSel },
        { label: 'Nudge earlier', keys: '←', run: () => ACTIONS.nudgeLeft(), enabled: hasSel },
        { label: 'Nudge later', keys: '→', run: () => ACTIONS.nudgeRight(), enabled: hasSel },
        null,
        { label: 'Length = snap', run: () => ACTIONS.lenGrid(), enabled: hasSel },
        { label: 'Legato (fill gaps)', run: () => ACTIONS.legato(), enabled: hasSel },
        { label: 'Stretch ×2', run: () => ACTIONS.double(), enabled: hasSel },
        { label: 'Stretch ×½', run: () => ACTIONS.half(), enabled: hasSel },
      ],
    },
    {
      label: 'Velocity',
      enabled: hasSel,
      children: () => [
        { header: () => { const v = selNotes().map((n) => n.vel); return v.length ? `Now ${Math.min(...v)}${Math.max(...v) !== Math.min(...v) ? '–' + Math.max(...v) : ''}` : ''; } },
        { label: 'Louder (+10)', run: () => adjustVelocity(10), enabled: hasSel },
        { label: 'Softer (−10)', run: () => adjustVelocity(-10), enabled: hasSel },
        null,
        ...VELOCITIES.map(([name, v]) => ({ label: name, keys: String(v), run: () => setVelocity(v), enabled: hasSel })),
      ],
    },
    {
      label: 'Move to layer',
      enabled: () => hasSel() && project.tracks.length > 1,
      children: () => project.tracks.filter((t) => t.id !== project.sel)
        .map((t) => ({ label: t.name, run: () => moveSelTo(t.id), enabled: hasSel })),
    },
    null,
    { label: 'Change notes…', keys: 'P', run: () => ACTIONS.pick(), enabled: hasSel, title: () => 'Keep the rhythm; choose new pitches on the keyboard' },
    { label: 'Connect', keys: 'slide', run: () => ACTIONS.connect(), enabled: canConnectSel, title: connectReason },
    { label: 'Disconnect', run: () => ACTIONS.disconnect(), enabled: hasSlidesSel, title: () => 'Remove slides from the selected notes' },
    { label: 'Tremor…', keys: 'wobble', run: () => ACTIONS.tremor(), enabled: canTremorSel,
      title: () => (canTremorSel() ? 'Add a pitch wobble to the selected notes' : 'Not available on drum layers') },
  ];
}
