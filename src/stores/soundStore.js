/**
 * Raw bytes of imported sound files, kept in IndexedDB (audio is far too big for the
 * localStorage autosave; the project itself only stores each sound's metadata).
 * A memory copy makes this session's reads instant, and is the only store where IndexedDB
 * isn't available (tests, some private modes).
 */
const DB = 'whistle-midi-sounds', STORE = 'sounds';
const memory = new Map();
let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined' || !indexedDB) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}

/** Run one IndexedDB request; resolves with its result (undefined on failure or without IndexedDB). */
async function request(mode, make) {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const req = make(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

/** Store `bytes` (ArrayBuffer) under a sound's storage key `id`. */
export async function putSoundBytes(id, bytes) {
  memory.set(id, bytes);
  await request('readwrite', (s) => s.put(bytes, id));
}
/** The stored bytes for sound `id`, or null. */
export async function getSoundBytes(id) {
  if (memory.has(id)) return memory.get(id);
  const v = await request('readonly', (s) => s.get(id));
  if (v) memory.set(id, v);
  return v || null;
}
/** Every stored id (for pruning files no project uses any more). */
export async function storedSoundIds() {
  const keys = await request('readonly', (s) => s.getAllKeys());
  return [...new Set([...(Array.isArray(keys) ? keys : []), ...memory.keys()])];
}
export async function deleteSoundBytes(id) {
  memory.delete(id);
  await request('readwrite', (s) => s.delete(id));
}
