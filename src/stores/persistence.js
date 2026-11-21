/** Autosave to localStorage (debounced) and restore on startup. */
import { watch } from 'vue';
import { project, serialize, loadProjectData } from './project.js';
import { ui } from './ui.js';

const KEY = 'open-daw-project';
let timer = null;

function save() {
  try {
    localStorage.setItem(KEY, serialize());
  } catch {
    try { localStorage.setItem(KEY, serialize({ withTakes: false })); } // over quota: drop raw takes
    catch { /* storage unavailable */ }
  }
}

export function installAutosave() {
  watch(project, () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  }, { deep: true });
}

/** Per-browser preferences (not part of the project): remembered whenever they change. */
const PREFS = { metronome: 'whistle-midi-metronome' };
export function installPrefs() {
  for (const [field, key] of Object.entries(PREFS)) {
    watch(() => ui[field], (v) => { try { localStorage.setItem(key, String(v)); } catch { /* storage unavailable */ } });
  }
}

/** @returns {boolean} whether a saved session was restored */
export function restoreSaved() {
  try {
    const saved = localStorage.getItem(KEY);
    if (!saved) return false;
    loadProjectData(JSON.parse(saved));
    return true;
  } catch {
    return false;
  }
}
