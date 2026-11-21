/**
 * Imported sound effects: import (decode + store), the decoded-buffer cache with waveform
 * peaks, preview, delete, and restoring the audio of a saved project.
 * The project keeps metadata only; bytes live in IndexedDB (stores/soundStore.js).
 */
import { ensureAudio, getCtx } from '../audio/context.js';
import { busFor, silenceAll } from '../audio/mixer.js';
import { project, nid, soundById, newSoundKey } from '../stores/project.js';
import { status } from '../stores/ui.js';
import { pushUndo } from '../stores/history.js';
import { putSoundBytes, getSoundBytes, storedSoundIds, deleteSoundBytes } from '../stores/soundStore.js';
import { stopTransport } from './transport.js';
import { soundState, soundBuffer, cacheSound, forgetSound } from '../audio/soundBank.js';

export { soundState, soundBuffer, soundPeaks } from '../audio/soundBank.js';

export const MAX_SOUND_BYTES = 50 * 1024 * 1024;

let decoder = null;
function decodeContext() {
  const live = getCtx();
  if (live) return live;
  if (!decoder && typeof OfflineAudioContext !== 'undefined') decoder = new OfflineAudioContext(2, 1, 44100);
  return decoder;
}
/** Decode file bytes (copied: decodeAudioData detaches the buffer it's given). */
export async function decodeBytes(bytes) {
  const ctx = decodeContext();
  if (!ctx) throw new Error('Audio decoding is not available');
  return ctx.decodeAudioData(bytes.slice(0));
}

const baseName = (n) => n.replace(/\.[^.]+$/, '') || 'Sound';

/** Import audio files into the project. Returns the new sounds (files that fail to decode are reported, not thrown). */
export async function importSoundFiles(files) {
  const list = [...files];
  const added = [], failed = [];
  soundState.importing += list.length;
  try {
    for (const f of list) {
      try {
        if (f.size > MAX_SOUND_BYTES) throw new Error(`larger than ${MAX_SOUND_BYTES / 1024 / 1024} MB`);
        const bytes = await f.arrayBuffer();
        const buffer = await decodeBytes(bytes);
        const id = nid(), key = newSoundKey();
        await putSoundBytes(key, bytes);
        if (!added.length) pushUndo(); // one undo step for the whole import
        project.sounds.push({ id, key, name: baseName(f.name), duration: buffer.duration, vol: 0.8, mime: f.type || '', size: f.size });
        cacheSound(id, buffer);
        added.push(soundById(id));
      } catch (e) {
        failed.push(`${f.name} (${e?.message || 'not an audio file this browser can read'})`);
      }
    }
  } finally {
    soundState.importing -= list.length;
  }
  if (failed.length) status(`Couldn’t import ${failed.join(', ')}.`, true);
  else if (added.length) status(`Imported ${added.map((s) => `"${s.name}"`).join(', ')}. Drag ${added.length === 1 ? 'it' : 'them'} onto a track.`);
  return added;
}

/** Delete a sound and every clip of it (undoable — the audio stays stored until no project uses it). */
export function deleteSound(id) {
  const s = soundById(id);
  if (!s) return;
  pushUndo();
  const n = project.song.clips.filter((c) => c.soundId === id).length;
  project.song.clips = project.song.clips.filter((c) => c.soundId !== id);
  project.sounds = project.sounds.filter((x) => x.id !== id);
  status(`Deleted "${s.name}"${n ? ` and its ${n} clip${n === 1 ? '' : 's'}` : ''}.`);
}
export const soundClipCount = (id) => project.song.clips.filter((c) => c.soundId === id).length;

/** Decode every sound of the loaded project from storage. Sounds whose audio is missing are flagged. */
export async function restoreSounds() {
  await Promise.all(project.sounds.map(async (s) => {
    if (soundState.ready[s.id]) return;
    try {
      const bytes = await getSoundBytes(s.key);
      if (!bytes) { soundState.missing[s.id] = true; return; }
      cacheSound(s.id, await decodeBytes(bytes));
    } catch { soundState.missing[s.id] = true; }
  }));
}

/** Forget stored audio that no sound in the project uses any more (call after loading a project). */
export async function pruneStoredSounds() {
  const used = new Set(project.sounds.map((s) => s.key));
  for (const id of await storedSoundIds()) if (!used.has(id)) await deleteSoundBytes(id);
}

/** Play a sound now (sidebar ▶). Returns its length in seconds. */
export function previewSound(id) {
  const s = soundById(id), buf = soundBuffer(id);
  if (!s || !buf) return 0;
  stopTransport();
  const actx = ensureAudio();
  silenceAll();
  const src = actx.createBufferSource();
  src.buffer = buf;
  src.connect(busFor(`sound-${id}`, s.vol));
  src.start(actx.currentTime + 0.02);
  return buf.duration;
}

/* ---------------- embedding audio in saved project files ---------------- */
export function toBase64(bytes) {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64) {
  const s = atob(b64), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8.buffer;
}
/** { key: base64 } for every sound in the project that has stored audio. */
export async function soundDataForSave() {
  const out = {};
  for (const s of project.sounds) { const b = await getSoundBytes(s.key); if (b) out[s.key] = toBase64(b); }
  return out;
}
/** Store audio embedded in a loaded project file, then decode. */
export async function storeEmbeddedSounds(data) {
  const keys = new Set(project.sounds.map((s) => s.key));
  for (const [key, b64] of Object.entries(data || {})) {
    if (!keys.has(key) || typeof b64 !== 'string') continue;
    try { await putSoundBytes(key, fromBase64(b64)); } catch { /* bad data: that sound shows as missing */ }
  }
  for (const s of project.sounds) forgetSound(s.id);
  await restoreSounds();
}
