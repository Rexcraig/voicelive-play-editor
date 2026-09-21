// Where the singer's data lives in the browser build. The Python server keeps these as files next to
// server.py; here they are localStorage (small, synchronous, survives a browser restart) and, for preset
// backups, a real folder the singer picks once.
const KEYS = { sets: "vlp.sets", saves: "vlp.saves", cache: "vlp.pedalCache", backups: "vlp.backupFolder" };

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;  // private window, or something else wrote nonsense there
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const readSets = () => {
  const data = load(KEYS.sets, {});
  return { sets: data.sets || [], revision: data.revision || 0 };
};

export const writeSets = (sets, revision) => save(KEYS.sets, { revision, sets });

export const slotLog = () => load(KEYS.saves, {});

export function noteSlot(slot, preset, kind) {
  const log = slotLog();
  log[slot] = { time: Date.now() / 1000, kind, preset: preset ? { name: preset.name, params: preset.params, tags: preset.tags } : null };
  save(KEYS.saves, log);
  const cache = pedalCache();
  if (cache) {
    cache.presets = cache.presets.filter((p) => p.slot !== slot).concat(preset ? [{ ...preset, slot }] : []);
    save(KEYS.cache, cache);
  }
}

export const pedalCache = () => load(KEYS.cache, null);
export const writePedalCache = (presets) => save(KEYS.cache, { time: Date.now() / 1000, source: "pedal", presets });

// Preset backups. The rule from the desktop version holds: nothing is ever written over a preset unless a
// backup of it was stored first. The singer picks a folder once and the browser remembers it; if the
// browser has no folder picker, or permission is refused, each backup is downloaded instead.
const DB = "vlp", STORE = "handles";

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function handle(write) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, write === undefined ? "readonly" : "readwrite");
      const store = tx.objectStore(STORE);
      const req = write === undefined ? store.get(KEYS.backups) : store.put(write, KEYS.backups);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export const backupFolderName = async () => (await handle())?.name || null;

// Asks for the folder. Must be called from a click: browsers refuse a picker otherwise.
export async function chooseBackupFolder() {
  if (!window.showDirectoryPicker) return null;
  const dir = await window.showDirectoryPicker({ id: "vlp-backups", mode: "readwrite" });
  await handle(dir);
  return dir.name;
}

async function folder() {
  const dir = await handle();
  if (!dir) return null;
  const permission = await dir.queryPermission?.({ mode: "readwrite" });
  if (permission === "granted") return dir;
  return (await dir.requestPermission?.({ mode: "readwrite" })) === "granted" ? dir : null;
}

function download(name, bytes) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Stores one backup and says where it went, or throws: a save that can't be backed up must not happen.
export async function backupPreset(path, bytes) {
  const parts = path.split("/");
  const name = parts.pop();
  let dir = await folder();
  if (dir) {
    try {
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const file = await dir.getFileHandle(await freeName(dir, name), { create: true });
      const stream = await file.createWritable();
      await stream.write(bytes);
      await stream.close();
      return `${parts.join("/")}${parts.length ? "/" : ""}${name}`;
    } catch {
      /* fall through to a download, rather than leave the preset unprotected */
    }
  }
  download(parts.concat(name).join(" "), bytes);
  return `your Downloads folder (${parts.concat(name).join(" ")})`;
}

// "name", then "name 2", "name 3"... so a backup never lands on top of an older one.
async function freeName(dir, name) {
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem} ${n}${ext}`;
    try {
      await dir.getFileHandle(candidate);
    } catch {
      return candidate;  // nothing there yet
    }
  }
}

export { download };
